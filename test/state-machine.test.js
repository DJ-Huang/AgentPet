"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  PetStateMachine,
  stateFromHookEvent,
  stateFromJsonl,
} = require("../lib/state-machine");

const machines = [];
test.after(() => machines.forEach((value) => clearInterval(value.heartbeat)));

function machine() {
  const value = new PetStateMachine();
  machines.push(value);
  return value;
}

test("thinking and tool activity both map to working", () => {
  assert.equal(stateFromHookEvent("UserPromptSubmit"), "working");
  assert.equal(stateFromHookEvent("PreToolUse"), "working");
  assert.equal(
    stateFromJsonl({ payload: { type: "item_started", item: { type: "Reasoning" } } }),
    "working",
  );
});

test("task completion maps to completed", () => {
  assert.equal(stateFromHookEvent("Stop"), "completed");
  assert.equal(stateFromHookEvent("StopFailure"), "completed");
  assert.equal(stateFromJsonl({ payload: { type: "task_complete" } }), "completed");
});

test("working has priority over a newer completed activity", () => {
  const state = machine();
  state.apply({ sessionId: "working-task", state: "working" });
  state.apply({ sessionId: "done-task", state: "completed" });

  assert.equal(state.snapshot().state, "working");
  assert.equal(state.snapshot().drivingId, "working-task");
});

test("a pinned completed activity cannot override a working activity", () => {
  const state = machine();
  state.apply({ sessionId: "done-task", state: "completed" });
  state.setPinned("done-task");
  state.apply({ sessionId: "working-task", state: "working" });

  assert.equal(state.snapshot().state, "working");
  assert.equal(state.snapshot().drivingId, "working-task");
});

test("completed remains visible until no completed activity remains", () => {
  const state = machine();
  state.apply({ sessionId: "done-task", state: "completed" });

  assert.equal(state.snapshot().state, "completed");
  state.clipEnded("completed");
  assert.equal(state.snapshot().state, "completed");

  state.apply({ sessionId: "done-task", event: "SessionEnd" });
  assert.equal(state.snapshot().state, "completed");

  state.markRead("done-task");
  assert.equal(state.snapshot().state, "idle");
});

test("legacy runtime states collapse into the three presentation states", () => {
  const state = machine();
  state.apply({ sessionId: "legacy-thinking", state: "thinking" });
  assert.equal(state.snapshot().state, "working");

  state.apply({ sessionId: "legacy-thinking", state: "review" });
  assert.equal(state.snapshot().state, "completed");
});
