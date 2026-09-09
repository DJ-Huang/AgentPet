"use strict";

const PRIORITY = ["failed", "waiting", "working", "thinking", "review", "idle"];
const PRIORITY_RANK = Object.fromEntries(PRIORITY.map((name, index) => [name, index]));
const { LIST_LIMIT } = require("./session-catalog");

const HOOK_EVENT_STATE = {
  UserPromptSubmit: "thinking",
  PreToolUse: "working",
  PostToolUse: "working",
  PermissionRequest: "waiting",
  Stop: "review",
  Interrupt: "idle",
  SessionEnd: "idle",
  SubagentStop: "review",
};

const JSONL_NO_DOWNGRADE = {
  thinking: new Set(["working", "waiting", "failed"]),
  review: new Set(["waiting", "failed"]),
  idle: new Set(["waiting", "failed", "working", "thinking"]),
};

const ONE_SHOT = new Set(["review", "failed"]);
const RUNNING = new Set(["thinking", "working", "waiting"]);
const SESSION_TTL_MS = 2 * 60 * 60 * 1000;
const UNREAD_MAX_MS = 2 * 60 * 60 * 1000;
const STALE_MS = {
  thinking: 90 * 1000,
  working: 10 * 60 * 1000,
  waiting: 10 * 60 * 1000,
};

function eventTime(record) {
  const parsed = Date.parse(record?.timestamp);
  return Number.isFinite(parsed) ? parsed : Date.now();
}

function isState(value) {
  return Object.prototype.hasOwnProperty.call(PRIORITY_RANK, value);
}

function looksFailed(payload) {
  if (!payload || typeof payload !== "object") return false;
  const response = payload.tool_response ?? payload.toolResponse;
  if (!response || typeof response !== "object") return false;
  if (response.is_error === true || response.isError === true) return true;
  if (response.success === false) return true;
  const exitCode = response.exit_code ?? response.exitCode;
  return typeof exitCode === "number" && exitCode !== 0;
}

function stateFromHookEvent(event, payload) {
  if (event === "PostToolUse" && looksFailed(payload)) return "failed";
  return HOOK_EVENT_STATE[event] || null;
}

function stateFromJsonl(record) {
  const payload = record?.payload;
  if (!payload || typeof payload !== "object") return null;
  const type = payload.type;
  if (type === "task_started") return "thinking";
  if (type === "task_complete") return "review";
  if (type === "error" || type === "stream_error") return "failed";
  if (type === "item_completed" || type === "item_started") {
    const itemType = payload.item?.type;
    if (itemType === "Reasoning") return "thinking";
    if (itemType === "CommandExecution" || itemType === "McpToolCall" || itemType === "FileChange") {
      if (payload.item?.status && payload.item.status !== "completed" && payload.item.status !== "in_progress") {
        return "failed";
      }
      return "working";
    }
  }
  return null;
}

function runningLabel(state, unread = false) {
  if (unread && (state === "review" || state === "failed")) return state === "failed" ? "失败" : "做好了";
  if (state === "idle") return "空闲";
  if (state === "review") return "做好了";
  if (state === "failed") return "失败";
  return "跑着";
}

class PetStateMachine {
  constructor({ onChange, onReadChange, reviewHoldMs = 8000, readAt = {} } = {}) {
    this.onChange = onChange;
    this.onReadChange = onReadChange;
    this.reviewHoldMs = reviewHoldMs;
    this.sessions = new Map();
    this.titles = [];
    this.pinnedId = null;
    this.readAt = new Map(
      Object.entries(readAt || {}).map(([id, value]) => [id, Number(value) || 0]),
    );
    this.timers = new Map();
    this.visible = "idle";
    this.lastKey = "";
    this.heartbeat = setInterval(() => {
      this.prune();
      this.emitIfChanged();
    }, 2000);
  }

  setReviewHoldMs(ms) {
    if (Number.isFinite(ms) && ms > 0) this.reviewHoldMs = ms;
  }

  setTitles(threads) {
    this.titles = Array.isArray(threads) ? threads : [];
    for (const meta of this.titles) {
      const current = this.sessions.get(meta.id);
      if (current) {
        this.sessions.set(meta.id, { ...current, title: meta.title });
      } else {
        this.sessions.set(meta.id, {
          state: "idle",
          source: "index",
          event: "index",
          title: meta.title,
          updatedAt: meta.indexUpdatedAt || Date.now(),
          unreadComplete: false,
          completeState: null,
          completedAt: 0,
        });
      }
    }
    this.emitIfChanged();
  }

  setPinned(id) {
    this.pinnedId = id || null;
    this.emitIfChanged();
    return this.snapshot();
  }

  togglePin(id) {
    if (!id) return this.snapshot();
    this.pinnedId = this.pinnedId === id ? null : id;
    this.emitIfChanged();
    return this.snapshot();
  }

  persistRead() {
    if (typeof this.onReadChange === "function") {
      this.onReadChange(Object.fromEntries(this.readAt));
    }
  }

  markRead(id) {
    if (!id || id === "__manual__") return this.snapshot();
    const session = this.sessions.get(id);
    const stamp = Math.max(session?.completedAt || 0, session?.updatedAt || 0, Date.now());
    this.readAt.set(id, stamp);
    if (session) {
      this.sessions.set(id, { ...session, unreadComplete: false });
    }
    this.persistRead();
    this.emitIfChanged();
    return this.snapshot();
  }

  isUnread(id, completedAt) {
    if (!completedAt) return false;
    return (this.readAt.get(id) || 0) < completedAt;
  }

  apply({ sessionId, state, source = "hook", event = null, payload = null, title = null }) {
    const id = sessionId || "unknown";
    if (event === "SessionStart") {
      return this.markRead(id);
    }

    let next = state;
    if (!next && event) next = stateFromHookEvent(event, payload);
    if (!next) return this.snapshot();
    if (!isState(next)) return this.snapshot();

    const current = this.sessions.get(id);
    if (source === "jsonl" && current) {
      const blocked = JSONL_NO_DOWNGRADE[next];
      if (blocked && blocked.has(current.state)) return this.snapshot();
    }

    const indexTitle = this.titles.find((row) => row.id === id)?.title;
    const now = Date.now();
    let updatedAt = now;
    if (source === "jsonl" && payload && payload.timestamp) {
      updatedAt = eventTime(payload);
    }
    const staleAfter = STALE_MS[next];
    if (source === "jsonl" && staleAfter && now - updatedAt > staleAfter) {
      next = "idle";
    }

    if (RUNNING.has(next) || next === "idle") {
      this.sessions.set(id, {
        state: next,
        source,
        event,
        title: title || current?.title || indexTitle || "",
        updatedAt,
        unreadComplete: false,
        completeState: current?.completeState || null,
        completedAt: current?.completedAt || 0,
      });
      this.clearTimer(id);
      this.emitIfChanged();
      return this.snapshot();
    }

    let unreadComplete = false;
    let completeState = current?.completeState || null;
    let completedAt = current?.completedAt || 0;
    if (ONE_SHOT.has(next)) {
      completedAt = updatedAt;
      completeState = next;
      unreadComplete = now - updatedAt <= UNREAD_MAX_MS && this.isUnread(id, completedAt);
      if (source === "jsonl" && now - updatedAt > this.reviewHoldMs) {
        next = "idle";
      }
    }

    this.sessions.set(id, {
      state: next,
      source,
      event,
      title: title || current?.title || indexTitle || "",
      updatedAt,
      unreadComplete,
      completeState,
      completedAt,
    });

    if (ONE_SHOT.has(this.sessions.get(id).state)) this.armOneShot(id, this.sessions.get(id).state);
    else this.clearTimer(id);

    this.emitIfChanged();
    return this.snapshot();
  }

  applyJsonl(record, sessionId) {
    const state = stateFromJsonl(record);
    if (!state) return this.snapshot();
    return this.apply({
      sessionId: sessionId || record?.payload?.thread_id || "jsonl",
      state,
      source: "jsonl",
      event: record?.payload?.type || "jsonl",
      payload: record,
    });
  }

  setManual(state) {
    return this.apply({ sessionId: "__manual__", state, source: "manual", event: "manual", title: "手动" });
  }

  reset() {
    for (const id of [...this.timers.keys()]) this.clearTimer(id);
    this.sessions.clear();
    this.pinnedId = null;
    this.visible = "idle";
    this.lastKey = "";
    this.setTitles(this.titles);
    return this.snapshot();
  }

  clipEnded(state) {
    for (const [id, session] of this.sessions) {
      if (session.state === state && ONE_SHOT.has(state)) {
        this.sessions.set(id, {
          ...session,
          state: "idle",
          source: "clip-ended",
          event: "clip-ended",
          updatedAt: Date.now(),
        });
        this.clearTimer(id);
      }
    }
    this.emitIfChanged();
    return this.snapshot();
  }

  prune(now = Date.now()) {
    for (const [id, session] of this.sessions) {
      if (id === "__manual__" || session.source === "manual") continue;
      const staleAfter = STALE_MS[session.state];
      if (staleAfter && now - session.updatedAt > staleAfter) {
        this.sessions.set(id, {
          ...session,
          state: "idle",
          source: "stale",
          event: "stale",
          updatedAt: now,
          unreadComplete: false,
        });
        this.clearTimer(id);
        continue;
      }
      const inIndex = this.titles.some((row) => row.id === id);
      if (!inIndex && !session.unreadComplete && now - session.updatedAt > SESSION_TTL_MS) {
        this.sessions.delete(id);
        this.clearTimer(id);
      }
    }
  }

  drivingSession() {
    this.prune();
    if (this.pinnedId) {
      const pinned = this.sessions.get(this.pinnedId);
      if (pinned) return { id: this.pinnedId, ...pinned };
    }
    let best = null;
    for (const [id, session] of this.sessions) {
      if (session.state === "idle") continue;
      if (!best) {
        best = { id, ...session };
        continue;
      }
      const rank = PRIORITY_RANK[session.state] ?? 99;
      const bestRank = PRIORITY_RANK[best.state] ?? 99;
      if (session.updatedAt > best.updatedAt) {
        best = { id, ...session };
      } else if (session.updatedAt === best.updatedAt && rank < bestRank) {
        best = { id, ...session };
      }
    }
    return best;
  }

  aggregate() {
    return this.drivingSession()?.state || "idle";
  }

  threadList() {
    const driving = this.drivingSession();
    const rows = [];
    const seen = new Set();
    const candidates = [];
    for (const [id, session] of this.sessions) {
      if (id === "__manual__") continue;
      const unread = Boolean(session.unreadComplete);
      const running = RUNNING.has(session.state);
      if (!running && !unread) continue;
      const listState = running ? session.state : session.completeState || session.state || "review";
      const meta = this.titles.find((row) => row.id === id);
      candidates.push({
        id,
        title: session.title || meta?.title || "未命名",
        state: listState,
        unread,
        label: runningLabel(listState, unread),
        updatedAt: session.updatedAt || meta?.indexUpdatedAt || 0,
        pinned: this.pinnedId === id,
        driving: driving?.id === id,
      });
      seen.add(id);
    }
    if (this.pinnedId && !seen.has(this.pinnedId)) {
      const live = this.sessions.get(this.pinnedId);
      if (live && (RUNNING.has(live.state) || live.unreadComplete)) {
        const listState = RUNNING.has(live.state) ? live.state : live.completeState || "review";
        candidates.unshift({
          id: this.pinnedId,
          title: live.title || this.pinnedId.slice(0, 8),
          state: listState,
          unread: Boolean(live.unreadComplete),
          label: runningLabel(listState, live.unreadComplete),
          updatedAt: live.updatedAt || 0,
          pinned: true,
          driving: driving?.id === this.pinnedId,
        });
      }
    }
    candidates.sort((a, b) => b.updatedAt - a.updatedAt);
    return candidates.slice(0, LIST_LIMIT);
  }

  snapshot() {
    const driving = this.drivingSession();
    const sessions = {};
    for (const [id, session] of this.sessions) {
      sessions[id] = { ...session };
    }
    return {
      state: driving?.state || "idle",
      drivingId: driving?.id || null,
      pinnedId: this.pinnedId,
      threads: this.threadList(),
      sessions,
    };
  }

  armOneShot(sessionId, state) {
    this.clearTimer(sessionId);
    const timer = setTimeout(() => {
      this.timers.delete(sessionId);
      const session = this.sessions.get(sessionId);
      if (!session || session.state !== state) return;
      this.sessions.set(sessionId, {
        ...session,
        state: "idle",
        source: "timeout",
        event: "hold-elapsed",
        updatedAt: Date.now(),
      });
      this.emitIfChanged();
    }, this.reviewHoldMs);
    this.timers.set(sessionId, timer);
  }

  clearTimer(sessionId) {
    const timer = this.timers.get(sessionId);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(sessionId);
    }
  }

  emitIfChanged() {
    const snap = this.snapshot();
    const key = JSON.stringify({
      state: snap.state,
      drivingId: snap.drivingId,
      pinnedId: snap.pinnedId,
      threads: snap.threads.map((row) => [row.id, row.state, row.title, row.pinned, row.driving, row.unread]),
    });
    if (key === this.lastKey) return;
    this.lastKey = key;
    this.visible = snap.state;
    if (typeof this.onChange === "function") this.onChange(snap);
  }
}

module.exports = {
  PRIORITY,
  HOOK_EVENT_STATE,
  PetStateMachine,
  stateFromHookEvent,
  stateFromJsonl,
  runningLabel,
  RUNNING,
};
