"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { isPlaceholderTitle, titleFromTranscriptText } = require("../lib/hook-title");

test("treats Cursor's default title as a placeholder", () => {
  assert.equal(isPlaceholderTitle("Untitled Task"), true);
});

test("recovers a Cursor title from the first transcript user query", () => {
  const transcript = JSON.stringify({
    role: "user",
    message: {
      content: [{ type: "text", text: "<timestamp>now</timestamp>\n<user_query>恢复当前 Cursor 会话标题</user_query>" }],
    },
  });

  assert.equal(titleFromTranscriptText(transcript), "恢复当前 Cursor 会话标题");
});
