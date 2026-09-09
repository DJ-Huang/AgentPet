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
const SESSION_TTL_MS = 2 * 60 * 60 * 1000;
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

function runningLabel(state) {
  if (state === "idle") return "空闲";
  if (state === "review") return "回顾";
  if (state === "failed") return "失败";
  return "跑着";
}

class PetStateMachine {
  constructor({ onChange, reviewHoldMs = 8000 } = {}) {
    this.onChange = onChange;
    this.reviewHoldMs = reviewHoldMs;
    this.sessions = new Map();
    this.titles = [];
    this.pinnedId = null;
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

  apply({ sessionId, state, source = "hook", event = null, payload = null, title = null }) {
    const id = sessionId || "unknown";
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
    if (source === "jsonl" && ONE_SHOT.has(next) && now - updatedAt > this.reviewHoldMs) {
      next = "idle";
    }
    this.sessions.set(id, {
      state: next,
      source,
      event,
      title: title || current?.title || indexTitle || "",
      updatedAt,
    });

    if (ONE_SHOT.has(next)) this.armOneShot(id, next);
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
        });
        this.clearTimer(id);
        continue;
      }
      const inIndex = this.titles.some((row) => row.id === id);
      if (!inIndex && now - session.updatedAt > SESSION_TTL_MS) {
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
    const allow = new Set(this.titles.map((row) => row.id));
    allow.add("__manual__");
    let best = null;
    for (const [id, session] of this.sessions) {
      if (!allow.has(id)) continue;
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
    const source = [...this.titles];
    if (this.pinnedId && !source.some((row) => row.id === this.pinnedId)) {
      const live = this.sessions.get(this.pinnedId);
      source.unshift({
        id: this.pinnedId,
        title: live?.title || this.pinnedId.slice(0, 8),
        indexUpdatedAt: live?.updatedAt || 0,
      });
    }
    for (const meta of source.slice(0, LIST_LIMIT)) {
      const live = this.sessions.get(meta.id);
      const state = live?.state || "idle";
      rows.push({
        id: meta.id,
        title: live?.title || meta.title || "未命名",
        state,
        label: runningLabel(state),
        updatedAt: live?.updatedAt || meta.indexUpdatedAt || 0,
        pinned: this.pinnedId === meta.id,
        driving: driving?.id === meta.id,
      });
      seen.add(meta.id);
    }
    return rows;
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
      threads: snap.threads.map((row) => [row.id, row.state, row.title, row.pinned, row.driving]),
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
};
