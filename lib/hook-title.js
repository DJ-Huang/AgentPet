"use strict";

const fs = require("node:fs");

const MODE_TITLES = new Set([
  "agent",
  "ask",
  "edit",
  "plan",
  "untitled task",
  "未命名任务",
]);
const TRANSCRIPT_PREFIX_BYTES = 256 * 1024;

function isPlaceholderTitle(value) {
  const key = String(value || "").trim().toLowerCase();
  return !key || MODE_TITLES.has(key);
}

function firstLineTitle(value) {
  const line = String(value || "")
    .split(/\r?\n/)[0]
    .replace(/\s+/g, " ")
    .trim();
  if (!line || isPlaceholderTitle(line)) return "";
  return line.length > 40 ? `${line.slice(0, 40)}…` : line;
}

function userText(record) {
  if (record?.role !== "user") return "";
  const content = record?.message?.content;
  const text = Array.isArray(content)
    ? content.filter((item) => item?.type === "text").map((item) => item.text || "").join("\n")
    : typeof content === "string"
      ? content
      : "";
  const query = text.match(/<user_query>\s*([\s\S]*?)\s*<\/user_query>/i);
  return query ? query[1] : text.replace(/<timestamp>[\s\S]*?<\/timestamp>/gi, "").trim();
}

function titleFromTranscriptText(text) {
  for (const line of String(text || "").split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const title = firstLineTitle(userText(JSON.parse(line)));
      if (title) return title;
    } catch {
      // A bounded prefix may end in a partial JSONL record.
    }
  }
  return "";
}

function titleFromTranscript(filePath) {
  if (typeof filePath !== "string" || !filePath || !fs.existsSync(filePath)) return "";
  let descriptor;
  try {
    descriptor = fs.openSync(filePath, "r");
    const buffer = Buffer.alloc(TRANSCRIPT_PREFIX_BYTES);
    const length = fs.readSync(descriptor, buffer, 0, buffer.length, 0);
    return titleFromTranscriptText(buffer.subarray(0, length).toString("utf8"));
  } catch {
    return "";
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

function titleFor(agent, payload) {
  const named = firstLineTitle(payload.thread_name || payload.threadName || payload.title || "");
  if (named) return named;
  const prompt = firstLineTitle(payload.prompt || payload.user_prompt || payload.userPrompt || "");
  if (prompt) return prompt;
  if (agent === "cursor") {
    return titleFromTranscript(payload.transcript_path || payload.transcriptPath || "");
  }
  return "";
}

module.exports = { firstLineTitle, isPlaceholderTitle, titleFor, titleFromTranscriptText };
