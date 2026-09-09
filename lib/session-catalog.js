"use strict";

const fs = require("node:fs");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const LIST_LIMIT = 8;
const TITLE_LIMIT = 32;

function codexHome() {
  return process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
}

function indexPath() {
  return path.join(codexHome(), "session_index.jsonl");
}

function threadIdFromFile(filePath) {
  const base = path.basename(filePath, ".jsonl");
  const match = base.match(UUID_RE);
  return match ? match[0] : base;
}

function threadIdFromRecord(record, filePath) {
  const payload = record?.payload;
  return payload?.thread_id || payload?.threadId || threadIdFromFile(filePath);
}

function parseIndex(text) {
  const map = new Map();
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const row = JSON.parse(trimmed);
      const id = row.id || row.thread_id;
      if (!id) continue;
      map.set(id, {
        id,
        title: row.thread_name || row.title || "",
        indexUpdatedAt: Date.parse(row.updated_at || row.updatedAt) || 0,
      });
    } catch {
      // skip bad line
    }
  }
  return [...map.values()].sort((a, b) => b.indexUpdatedAt - a.indexUpdatedAt);
}

function createSessionCatalog({ onChange, limit = TITLE_LIMIT, intervalMs = 1000 } = {}) {
  let timer = null;
  let stopped = false;
  let lastSize = -1;
  let lastMtime = 0;
  let threads = [];

  async function refresh(force = false) {
    const file = indexPath();
    let stat;
    try {
      stat = await fsp.stat(file);
    } catch {
      threads = [];
      if (force && typeof onChange === "function") onChange(threads);
      return threads;
    }
    if (!force && stat.size === lastSize && stat.mtimeMs === lastMtime) return threads;
    lastSize = stat.size;
    lastMtime = stat.mtimeMs;
    const text = await fsp.readFile(file, "utf8");
    threads = parseIndex(text).slice(0, limit);
    if (typeof onChange === "function") onChange(threads);
    return threads;
  }

  function start() {
    if (timer) return;
    stopped = false;
    timer = setInterval(() => {
      if (stopped) return;
      refresh().catch((error) => console.error("[sessions]", error));
    }, intervalMs);
  }

  function stop() {
    stopped = true;
    if (timer) clearInterval(timer);
    timer = null;
  }

  return {
    start,
    stop,
    refresh,
    list: () => threads,
    path: indexPath(),
  };
}

module.exports = {
  LIST_LIMIT,
  TITLE_LIMIT,
  codexHome,
  indexPath,
  threadIdFromFile,
  threadIdFromRecord,
  parseIndex,
  createSessionCatalog,
};
