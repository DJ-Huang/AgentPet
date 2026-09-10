"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { isManualQuit, manualQuitPath, setManualQuit } = require("../lib/launch-control");

test("manual quit marker blocks auto-start until the pet is explicitly opened again", (t) => {
  const appData = fs.mkdtempSync(path.join(os.tmpdir(), "codex-video-pet-"));
  t.after(() => fs.rmSync(appData, { recursive: true, force: true }));
  const options = { appData };

  assert.equal(isManualQuit(options), false);
  setManualQuit(true, options);
  assert.equal(isManualQuit(options), true);
  assert.equal(fs.existsSync(manualQuitPath(options)), true);

  setManualQuit(false, options);
  assert.equal(isManualQuit(options), false);
  assert.equal(fs.existsSync(manualQuitPath(options)), false);
});
