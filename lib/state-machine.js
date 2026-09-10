"use strict";

const PRIORITY = ["waiting", "working", "completed", "idle"];
const PRIORITY_RANK = Object.fromEntries(PRIORITY.map((name, index) => [name, index]));
const { LIST_LIMIT } = require("./session-catalog");
const { repairUtf8Mojibake } = require("./text-encoding");

const HOOK_EVENT_STATE = {
  UserPromptSubmit: "working",
  PreToolUse: "working",
  PostToolUse: "working",
  PostToolUseFailure: "working",
  PermissionRequest: "waiting",
  Stop: "completed",
  StopFailure: "completed",
  Interrupt: "idle",
  SessionEnd: "idle",
  SubagentStop: "completed",
};

const LEGACY_STATE_MAP = {
  thinking: "working",
  awaiting_input: "waiting",
  needs_input: "waiting",
  review: "completed",
  failed: "completed",
};
const RUNNING = new Set(["waiting", "working"]);
const SESSION_TTL_MS = 2 * 60 * 60 * 1000;
const UNREAD_MAX_MS = 2 * 60 * 60 * 1000;
const STALE_MS = {
  working: 10 * 60 * 1000,
};

const USER_INPUT_TOOLS = new Set(["requestuserinput", "askuser", "askuserquestion"]);

function eventTime(record) {
  const parsed = Date.parse(record?.timestamp);
  return Number.isFinite(parsed) ? parsed : Date.now();
}

function isState(value) {
  return Object.prototype.hasOwnProperty.call(PRIORITY_RANK, value);
}

function normalizeState(value) {
  return LEGACY_STATE_MAP[value] || value;
}

function isUserInputTool(value) {
  if (!value || typeof value !== "object") return false;
  const name = value.tool_name || value.toolName || value.name || value.tool;
  if (typeof name !== "string") return false;
  const leaf = name.split(/[.:/]/).pop().replace(/[^a-z]/gi, "").toLowerCase();
  return USER_INPUT_TOOLS.has(leaf);
}

function stateFromHookEvent(event, payload) {
  if (event === "PreToolUse" && isUserInputTool(payload)) return "waiting";
  return HOOK_EVENT_STATE[event] || null;
}

function stateFromJsonl(record) {
  const payload = record?.payload;
  if (!payload || typeof payload !== "object") return null;
  const type = payload.type;
  if ((type === "custom_tool_call" || type === "function_call") && isUserInputTool(payload)) {
    return "waiting";
  }
  if (type === "task_started") return "working";
  if (type === "task_complete") return "completed";
  if (type === "error" || type === "stream_error") return "completed";
  if (type === "item_completed" || type === "item_started") {
    if (isUserInputTool(payload.item)) return type === "item_started" ? "waiting" : "working";
    const itemType = payload.item?.type;
    if (itemType === "Reasoning") return "working";
    if (itemType === "CommandExecution" || itemType === "McpToolCall" || itemType === "FileChange") {
      return "working";
    }
  }
  return null;
}

function runningLabel(state) {
  if (state === "idle") return "空闲";
  if (state === "waiting") return "等待确认";
  if (state === "working") return "工作中";
  if (state === "completed") return "完成";
  return state;
}

const KNOWN_AGENTS = new Set(["codex", "cursor", "codely-cli", "claude-code", "manual"]);

function inferAgent(agent, sessionId) {
  if (agent && KNOWN_AGENTS.has(agent)) return agent;
  const id = String(sessionId || "");
  if (id === "__manual__") return "manual";
  if (id.startsWith("cursor:")) return "cursor";
  if (id.startsWith("claude:")) return "claude-code";
  if (id.startsWith("codely:")) return "codely-cli";
  return "codex";
}

const PLACEHOLDER_TITLES = new Set(["agent", "ask", "edit", "plan", "untitled task", "未命名任务"]);

function repairTitle(value) {
  const str = String(value || "").trim();
  if (!str) return "";
  return repairUtf8Mojibake(str).trim();
}

function isPlaceholderTitle(value) {
  const str = String(value || "").trim();
  if (!str) return true;
  return PLACEHOLDER_TITLES.has(str.toLowerCase());
}

function pickTitle(incoming, current, indexTitle) {
  const existing = repairTitle(current?.title);
  const next = repairTitle(incoming);
  const fromIndex = repairTitle(indexTitle);
  if (existing && !isPlaceholderTitle(existing)) return existing;
  if (next && !isPlaceholderTitle(next)) return next;
  if (fromIndex && !isPlaceholderTitle(fromIndex)) return fromIndex;
  return existing || next || fromIndex || "";
}

function pickCwd(payload, current) {
  if (payload && typeof payload === "object") {
    if (typeof payload.cwd === "string" && payload.cwd.trim()) return payload.cwd.trim();
    const roots = payload.workspace_roots || payload.workspaceRoots;
    if (Array.isArray(roots) && typeof roots[0] === "string" && roots[0].trim()) {
      return roots[0].trim();
    }
  }
  return current?.cwd || "";
}

class PetStateMachine {
  constructor({ onChange, onReadChange, readAt = {} } = {}) {
    this.onChange = onChange;
    this.onReadChange = onReadChange;
    this.sessions = new Map();
    this.titles = [];
    this.pinnedId = null;
    this.dismissed = new Set();
    this.readAt = new Map(
      Object.entries(readAt || {}).map(([id, value]) => [id, Number(value) || 0]),
    );
    this.visible = "idle";
    this.lastKey = "";
    this.heartbeat = setInterval(() => {
      this.prune();
      this.emitIfChanged();
    }, 2000);
  }

  setTitles(threads) {
    this.titles = Array.isArray(threads) ? threads : [];
    for (const meta of this.titles) {
      const current = this.sessions.get(meta.id);
      if (current) {
        this.sessions.set(meta.id, {
          ...current,
          title: meta.title,
          agent: current.agent || inferAgent(null, meta.id),
        });
      } else {
        this.sessions.set(meta.id, {
          state: "idle",
          source: "index",
          event: "index",
          agent: inferAgent(null, meta.id),
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

  dismissThread(id) {
    if (!id || id === "__manual__") return this.snapshot();
    this.dismissed.add(id);
    if (this.pinnedId === id) this.pinnedId = null;
    this.emitIfChanged();
    return this.snapshot();
  }

  isDismissed(id) {
    return this.dismissed.has(id);
  }

  markRead(id) {
    if (!id || id === "__manual__") return this.snapshot();
    const session = this.sessions.get(id);
    const stamp = Math.max(session?.completedAt || 0, session?.updatedAt || 0, Date.now());
    this.readAt.set(id, stamp);
    if (session) {
      this.sessions.set(id, {
        ...session,
        state: session.state === "completed" ? "idle" : session.state,
        unreadComplete: false,
      });
    }
    this.persistRead();
    this.emitIfChanged();
    return this.snapshot();
  }

  isUnread(id, completedAt) {
    if (!completedAt) return false;
    return (this.readAt.get(id) || 0) < completedAt;
  }

  apply({ sessionId, state, source = "hook", event = null, payload = null, title = null, agent = null }) {
    const id = sessionId || "unknown";
    if (event === "SessionStart") {
      this.dismissed.delete(id);
      const current = this.sessions.get(id);
      const cwd = pickCwd(payload, current);
      if (current) {
        this.sessions.set(id, { ...current, agent: inferAgent(agent, id), cwd: cwd || current.cwd });
      } else {
        this.sessions.set(id, {
          state: "idle",
          source,
          event,
          agent: inferAgent(agent, id),
          title: title || "",
          cwd,
          updatedAt: Date.now(),
          unreadComplete: false,
          completeState: null,
          completedAt: 0,
        });
      }
      return this.markRead(id);
    }

    let next = normalizeState(state);
    if (!next && event) next = stateFromHookEvent(event, payload);
    next = normalizeState(next);
    if (!next) return this.snapshot();
    if (!isState(next)) return this.snapshot();

    const current = this.sessions.get(id);
    if (source === "jsonl" && current) {
      const incomingAt = eventTime(payload);
      if (incomingAt < current.updatedAt) return this.snapshot();
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

    const nextAgent = inferAgent(agent || current?.agent, id);
    const nextTitle = pickTitle(title, current, indexTitle);
    const nextCwd = pickCwd(payload, current);
    this.dismissed.delete(id);

    if (RUNNING.has(next) || next === "idle") {
      const preserveCompletion = next === "idle" && Boolean(current?.unreadComplete);
      this.sessions.set(id, {
        state: next,
        source,
        event,
        agent: nextAgent,
        title: nextTitle,
        cwd: nextCwd,
        updatedAt,
        unreadComplete: preserveCompletion,
        completeState: current?.completeState || null,
        completedAt: current?.completedAt || 0,
      });
      this.emitIfChanged();
      return this.snapshot();
    }

    let unreadComplete = false;
    let completeState = current?.completeState || null;
    let completedAt = current?.completedAt || 0;
    if (next === "completed") {
      completedAt = updatedAt;
      completeState = next;
      unreadComplete = now - updatedAt <= UNREAD_MAX_MS && this.isUnread(id, completedAt);
    }

    this.sessions.set(id, {
      state: next,
      source,
      event,
      agent: nextAgent,
      title: nextTitle,
      cwd: nextCwd,
      updatedAt,
      unreadComplete,
      completeState,
      completedAt,
    });

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
    this.sessions.clear();
    this.pinnedId = null;
    this.dismissed.clear();
    this.visible = "idle";
    this.lastKey = "";
    this.setTitles(this.titles);
    return this.snapshot();
  }

  clipEnded(state) {
    // Presentation is derived from the activity list. A completed clip ending
    // must not clear completion while completed activities are still unread.
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
        continue;
      }
      const inIndex = this.titles.some((row) => row.id === id);
      if (!inIndex && !session.unreadComplete && now - session.updatedAt > SESSION_TTL_MS) {
        this.sessions.delete(id);
        this.dismissed.delete(id);
      }
    }
  }

  drivingSession() {
    this.prune();
    let best = null;
    for (const [id, session] of this.sessions) {
      if (this.isDismissed(id)) continue;
      const state = RUNNING.has(session.state)
        ? session.state
        : session.unreadComplete
          ? "completed"
          : "idle";
      if (state === "idle") continue;
      const candidate = { id, ...session, state };
      if (!best) {
        best = candidate;
        continue;
      }
      const rank = PRIORITY_RANK[state] ?? 99;
      const bestRank = PRIORITY_RANK[best.state] ?? 99;
      if (rank < bestRank) {
        best = candidate;
      } else if (rank === bestRank) {
        const candidatePinned = this.pinnedId === id;
        const bestPinned = this.pinnedId === best.id;
        if ((candidatePinned && !bestPinned) || (candidatePinned === bestPinned && session.updatedAt > best.updatedAt)) {
          best = candidate;
        }
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
      if (this.isDismissed(id)) continue;
      const unread = Boolean(session.unreadComplete);
      const running = RUNNING.has(session.state);
      if (!running && !unread) continue;
      const listState = running ? session.state : "completed";
      const meta = this.titles.find((row) => row.id === id);
      candidates.push({
        id,
        agent: inferAgent(session.agent, id),
        title: session.title || meta?.title || "",
        cwd: session.cwd || "",
        state: listState,
        unread,
        label: runningLabel(listState),
        updatedAt: session.updatedAt || meta?.indexUpdatedAt || 0,
        pinned: this.pinnedId === id,
        driving: driving?.id === id,
      });
      seen.add(id);
    }
    if (this.pinnedId && !seen.has(this.pinnedId) && !this.isDismissed(this.pinnedId)) {
      const live = this.sessions.get(this.pinnedId);
      if (live && (RUNNING.has(live.state) || live.unreadComplete)) {
        const listState = RUNNING.has(live.state) ? live.state : "completed";
        candidates.unshift({
          id: this.pinnedId,
          agent: inferAgent(live.agent, this.pinnedId),
          title: live.title || this.pinnedId.slice(0, 8),
          state: listState,
          unread: Boolean(live.unreadComplete),
          label: runningLabel(listState),
          updatedAt: live.updatedAt || 0,
          pinned: true,
          driving: driving?.id === this.pinnedId,
        });
      }
    }
    candidates.sort((a, b) => {
      const rank = (PRIORITY_RANK[a.state] ?? 99) - (PRIORITY_RANK[b.state] ?? 99);
      return rank || b.updatedAt - a.updatedAt;
    });
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

  emitIfChanged() {
    const snap = this.snapshot();
    const key = JSON.stringify({
      state: snap.state,
      drivingId: snap.drivingId,
      pinnedId: snap.pinnedId,
      dismissed: [...this.dismissed].sort(),
      threads: snap.threads.map((row) => [row.id, row.agent, row.state, row.title, row.pinned, row.driving, row.unread]),
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
  inferAgent,
  RUNNING,
};
