"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { isAppExcluded, normalizeAppName, normalizeExcludedApps, normalizeVisibleApps } = require("../lib/foreground-app");

test("normalizes executable names for settings storage", () => {
  assert.equal(normalizeAppName("  Code.EXE  "), "code");
  assert.deepEqual(normalizeExcludedApps("Code.exe, chrome\nCODE; Photoshop.exe"), ["code", "chrome", "photoshop"]);
});

test("matches excluded apps exactly and case-insensitively", () => {
  assert.equal(isAppExcluded("Code", ["code.exe", "photoshop"]), true);
  assert.equal(isAppExcluded("Visual Studio Code", ["code"]), false);
  assert.equal(isAppExcluded("", ["code"]), false);
});

test("normalizes and deduplicates visible app choices", () => {
  assert.deepEqual(normalizeVisibleApps([
    { Id: 20, ProcessName: "Photoshop", MainWindowTitle: "image.psd" },
    { Id: 10, ProcessName: "code", MainWindowTitle: "project" },
    { Id: 11, ProcessName: "Code", MainWindowTitle: "another window" },
  ]), [
    { pid: 10, name: "code", title: "project" },
    { pid: 20, name: "Photoshop", title: "image.psd" },
  ]);
});
