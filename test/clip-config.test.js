"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { loadClipConfig, restoreClipState } = require("../lib/clip-config");

test("bundled Hana defaults discover every video in its four state directories", () => {
  const petDir = path.join(__dirname, "..", "assets", "hana");
  const videoCount = (directory) => fs.readdirSync(path.join(petDir, "Videos", directory))
    .filter((file) => [".mp4", ".webm", ".mov", ".m4v", ".ogv"].includes(path.extname(file).toLowerCase()))
    .length;
  const config = loadClipConfig({
    petDir,
    userConfigPath: path.join(os.tmpdir(), `destokpet-no-user-config-${Date.now()}.json`),
  });

  assert.deepEqual(config.missing, { idle: [], waiting: [], working: [], completed: [] });
  assert.equal(config.files.idle.length, videoCount("Idle"));
  assert.equal(config.files.working.length, videoCount("Work"));
  assert.equal(config.files.waiting.length, videoCount("Waitting"));
  assert.equal(config.files.completed.length, videoCount("Done"));
  assert.match(config.files.waiting[0], /Videos\/Waitting\/01\.mp4$/);
  assert.ok(config.files.completed.every((file) => file.includes("/Videos/Done/")));
  assert.equal(config.clips.completed.pick, "random");
});

test("discovered defaults remain dynamic until the user customizes that state", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "destokpet-clips-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const petDir = path.join(root, "hana");
  const idleDir = path.join(petDir, "Videos", "Idle");
  fs.mkdirSync(idleDir, { recursive: true });
  fs.writeFileSync(path.join(idleDir, "01.mp4"), "placeholder");
  fs.writeFileSync(path.join(idleDir, "02.webm"), "placeholder");
  fs.writeFileSync(path.join(idleDir, "notes.txt"), "not a video");
  fs.writeFileSync(
    path.join(petDir, "manifest.json"),
    JSON.stringify({ clips: { idle: { files: ["old-default.mp4"] } } }),
  );
  const userConfigPath = path.join(root, "clip-config.json");

  let config = loadClipConfig({ petDir, userConfigPath });
  assert.deepEqual(config.clips.idle.files, ["Videos/Idle/01.mp4", "Videos/Idle/02.webm"]);

  fs.writeFileSync(
    userConfigPath,
    JSON.stringify({ clips: { idle: { files: [path.join(root, "custom.mp4")] } } }),
  );
  config = loadClipConfig({ petDir, userConfigPath });
  assert.deepEqual(config.clips.idle.files, [path.join(root, "custom.mp4")]);

  config = restoreClipState(petDir, userConfigPath, "idle");
  assert.deepEqual(config.clips.idle.files, ["Videos/Idle/01.mp4", "Videos/Idle/02.webm"]);
});

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
