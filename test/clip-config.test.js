"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { loadClipConfig } = require("../lib/clip-config");

test("empty legacy review config does not suppress the completed default", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "destokpet-clips-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const petDir = path.join(root, "pet");
  fs.mkdirSync(petDir);
  fs.writeFileSync(path.join(petDir, "completed.webm"), "placeholder");
  fs.writeFileSync(
    path.join(petDir, "manifest.json"),
    JSON.stringify({ clips: { completed: { file: "completed.webm", loop: true } } }),
  );
  const userConfigPath = path.join(root, "clip-config.json");
  fs.writeFileSync(
    userConfigPath,
    JSON.stringify({ clips: { review: { files: [], loop: false } } }),
  );

  const config = loadClipConfig({ petDir, userConfigPath });
  assert.equal(config.files.completed.length, 1);
  assert.equal(config.clips.completed.loop, true);
});
