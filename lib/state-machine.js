"use strict";

const PRIORITY = ["failed", "waiting", "working", "thinking", "review", "idle"];
const PRIORITY_RANK = Object.fromEntries(PRIORITY.map((name, index) => [name, index]));

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

class PetStateMachine {
  constructor({ onChange, reviewHoldMs = 8000 } = {}) {
    this.onChange = onChange;
    this.reviewHoldMs = reviewHoldMs;
    this.sessions = new Map();
    this.timers = new Map();
    this.visible = "idle";
    this.heartbeat = setInterval(() => {
      this.prune();
      this.emitIfChanged();
    }, 2000);
  }

  setReviewHoldMs(ms) {
    if (Number.isFinite(ms) && ms > 0) this.reviewHoldMs = ms;
  }

  apply({ sessionId, state, source = "hook", event = null, payload = null }) {
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

    this.sessions.set(id, {
      state: next,
      source,
      event,
      updatedAt: Date.now(),
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
    });
  }

  setManual(state) {
    return this.apply({ sessionId: "__manual__", state, source: "manual", event: "manual" });
  }

  reset() {
    for (const id of [...this.timers.keys()]) this.clearTimer(id);
    this.sessions.clear();
    this.visible = "idle";
    if (typeof this.onChange === "function") this.onChange(this.snapshot());
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
      if (now - session.updatedAt > SESSION_TTL_MS) {
        this.sessions.delete(id);
        this.clearTimer(id);
      }
    }
  }

  aggregate() {
    this.prune();
    let best = "idle";
    let bestRank = PRIORITY_RANK.idle;
    for (const session of this.sessions.values()) {
      const rank = PRIORITY_RANK[session.state] ?? PRIORITY_RANK.idle;
      if (rank < bestRank) {
        best = session.state;
        bestRank = rank;
      }
    }
    return best;
  }

  snapshot() {
    const sessions = {};
    for (const [id, session] of this.sessions) {
      sessions[id] = { ...session };
    }
    return {
      state: this.aggregate(),
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
    const next = this.aggregate();
    if (next === this.visible) return;
    this.visible = next;
    if (typeof this.onChange === "function") this.onChange(this.snapshot());
  }
}

module.exports = {
  PRIORITY,
  HOOK_EVENT_STATE,
  PetStateMachine,
  stateFromHookEvent,
  stateFromJsonl,
};
