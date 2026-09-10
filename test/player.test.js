"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

class FakeClassList {
  constructor() {
    this.values = new Set();
  }

  add(value) {
    this.values.add(value);
  }

  remove(value) {
    this.values.delete(value);
  }

  contains(value) {
    return this.values.has(value);
  }

  toggle(value, force) {
    if (force) this.values.add(value);
    else this.values.delete(value);
  }
}

class FakeElement {
  constructor() {
    this.attributes = new Map();
    this.dataset = {};
    this.classList = new FakeClassList();
    this.listeners = new Map();
    this.style = {
      setProperty() {},
      removeProperty() {},
    };
    this.src = "";
    this.readyState = 0;
    this.ended = false;
    this.videoWidth = 100;
    this.videoHeight = 100;
    this.offsetHeight = 0;
    this.children = [];
  }

  addEventListener(type, handler) {
    const handlers = this.listeners.get(type) || [];
    handlers.push(handler);
    this.listeners.set(type, handlers);
  }

  removeEventListener(type, handler) {
    this.listeners.set(type, (this.listeners.get(type) || []).filter((item) => item !== handler));
  }

  dispatch(type, event = {}) {
    for (const handler of [...(this.listeners.get(type) || [])]) handler(event);
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  getAttribute(name) {
    return this.attributes.get(name) || null;
  }

  removeAttribute(name) {
    this.attributes.delete(name);
    if (name === "src") this.src = "";
  }

  getBoundingClientRect() {
    return { left: 0, top: 0, right: 100, bottom: 100, width: 100, height: 100 };
  }

  load() {}

  play() {
    return Promise.resolve();
  }

  pause() {}

  replaceChildren(...children) { this.children = children; }

  append() {}
}

function createPlayer({ pick, random = () => 0, threads = [] }) {
  const elements = {
    root: new FakeElement(),
    "video-a": new FakeElement(),
    "video-b": new FakeElement(),
    stage: new FakeElement(),
    sessions: new FakeElement(),
    "session-list": new FakeElement(),
    "activity-title": new FakeElement(),
  };
  let init;
  let panelPlacement;
  let videoVisibility;
  let videoMenuCalls = 0;
  const dragStarts = [];
  const openedThreads = [];
  const petBridge = {
    onInit(handler) { init = handler; },
    onState() {},
    onEffects() {},
    onLanguage() {},
    onPanelPlacement(handler) { panelPlacement = handler; },
    onVideoVisibility(handler) { videoVisibility = handler; },
    videoContextMenu() { videoMenuCalls += 1; },
    openThread(id) { openedThreads.push(id); },
    dragStart(point) { dragStarts.push(point); },
    setIgnoreMouse() {},
    setPanelHeight() {},
  };
  const document = {
    documentElement: {},
    body: new FakeElement(),
    getElementById(id) { return elements[id]; },
    createElement() {
      const element = new FakeElement();
      element.getContext = () => ({ clearRect() {}, drawImage() {}, getImageData() { return { data: [0, 0, 0, 255] }; } });
      return element;
    },
  };
  const context = {
    document,
    window: { petBridge, addEventListener() {}, clearTimeout() {}, setTimeout },
    Image: class {},
    Math: Object.assign(Object.create(Math), { random }),
    requestAnimationFrame(handler) { handler(); return 1; },
    ResizeObserver: undefined,
    Set,
    Map,
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "..", "player.js"), "utf8"), context);
  init({
    state: "idle",
    threads,
    clips: { idle: { loop: true, pick } },
    files: { idle: ["file:///one.mp4", "file:///two.mp4", "file:///three.mp4"] },
  });
  return {
    videoA: elements["video-a"],
    videoB: elements["video-b"],
    root: elements.root,
    sessions: elements.sessions,
    panelPlacement,
    videoVisibility,
    videoMenuCalls: () => videoMenuCalls,
    dragStarts,
    sessionRows: elements["session-list"].children,
    openedThreads,
  };
}

async function settlePlayback(video) {
  video.dispatch("canplay");
  await Promise.resolve();
}

test("sequence playback advances through the configured list", async () => {
  const { videoA, videoB } = createPlayer({ pick: "sequence" });
  assert.equal(videoB.src, "file:///one.mp4");
  await settlePlayback(videoB);

  videoB.onended();
  assert.equal(videoA.src, "file:///two.mp4");
  await settlePlayback(videoA);

  videoA.onended();
  assert.equal(videoB.src, "file:///three.mp4");
});

test("random playback chooses another clip when the current clip ends", async () => {
  const { videoA, videoB } = createPlayer({ pick: "random", random: () => 0 });
  assert.equal(videoB.src, "file:///one.mp4");
  await settlePlayback(videoB);

  videoB.onended();
  assert.equal(videoA.src, "file:///two.mp4");
  assert.equal(videoB.loop, false);
});

test("activity panel can be placed above the pet", () => {
  const { root, panelPlacement } = createPlayer({ pick: "random" });
  panelPlacement({ above: true });
  assert.equal(root.classList.contains("panel-above"), true);
  panelPlacement({ above: false });
  assert.equal(root.classList.contains("panel-above"), false);
});

test("video visibility can switch the pet into list-only mode", () => {
  const { root, videoVisibility } = createPlayer({ pick: "random" });
  videoVisibility({ visible: false });
  assert.equal(root.classList.contains("video-hidden"), true);
  videoVisibility({ visible: true });
  assert.equal(root.classList.contains("video-hidden"), false);
});

test("blank activity-panel space opens the video visibility menu", () => {
  const { sessions, videoMenuCalls } = createPlayer({ pick: "random" });
  let prevented = false;
  sessions.dispatch("contextmenu", {
    target: { closest() { return null; } },
    preventDefault() { prevented = true; },
  });
  assert.equal(prevented, true);
  assert.equal(videoMenuCalls(), 1);
});

test("blank activity-panel space can drag the list-only window", () => {
  const { sessions, dragStarts } = createPlayer({ pick: "random" });
  sessions.dispatch("pointerdown", {
    button: 0,
    pointerId: 1,
    screenX: 321,
    screenY: 654,
    target: { closest() { return null; } },
    preventDefault() {},
  });
  assert.equal(dragStarts.length, 1);
  assert.equal(dragStarts[0].x, 321);
  assert.equal(dragStarts[0].y, 654);
});

test("Cursor activity is not clickable while Codex activity still opens", () => {
  const { sessionRows, openedThreads } = createPlayer({
    pick: "random",
    threads: [
      { id: "cursor:one", agent: "cursor", state: "working", title: "Cursor" },
      { id: "codex-one", agent: "codex", state: "completed", title: "Codex" },
    ],
  });
  const click = { button: 0, stopPropagation() {} };

  sessionRows[0].dispatch("click", click);
  sessionRows[1].dispatch("click", click);

  assert.deepEqual(openedThreads, ["codex-one"]);
  assert.equal(sessionRows[0].classList.contains("noninteractive"), true);
});
