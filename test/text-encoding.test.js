"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { repairUtf8Mojibake } = require("../lib/text-encoding");

test("repairs UTF-8 decoded through Windows-1252", () => {
  assert.equal(repairUtf8Mojibake("è¿™ä¸ªæµ‹è¯•"), "这个测试");
  assert.equal(
    repairUtf8Mojibake("è¿™ä¸ªå·¥ç¨‹çš„frpï¼ˆhmirpï¼‰çš„JieTuD01…"),
    "这个工程的frp（hmirp）的JieTuD01…",
  );
});

test("keeps valid text unchanged", () => {
  assert.equal(repairUtf8Mojibake("已经正常的标题"), "已经正常的标题");
  assert.equal(repairUtf8Mojibake("Cursor task"), "Cursor task");
});
