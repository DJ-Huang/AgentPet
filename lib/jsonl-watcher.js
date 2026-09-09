"use strict";

const fs = require("node:fs");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

function sessionsRoot() {
  const home = process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
  return path.join(home, "sessions");
}

function sessionIdFromFile(filePath) {
  const base = path.basename(filePath, ".jsonl");
  const match = base.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi);
  return match ? match[match.length - 1] : base;
}

async function listJsonlFiles(root) {
  const out = [];
  async function walk(dir, depth) {
    if (depth > 5) return;
    let entries;
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(full, depth + 1);
      else if (entry.isFile() && entry.name.endsWith(".jsonl")) out.push(full);
    }
  }
  await walk(root, 0);
  return out;
}

function createJsonlWatcher({ machine, intervalMs = 700 }) {
  const offsets = new Map();
  let timer = null;
  let stopped = false;
  const root = sessionsRoot();

  async function ingestFile(filePath, fromStart) {
    let stat;
    try {
      stat = await fsp.stat(filePath);
    } catch {
      offsets.delete(filePath);
      return;
    }

    const prev = offsets.get(filePath) || { size: 0, offset: 0 };
    if (!fromStart && prev.size === 0 && prev.offset === 0) {
      offsets.set(filePath, { size: stat.size, offset: stat.size });
      return;
    }
    if (stat.size < prev.offset) {
      prev.offset = 0;
    }
    if (stat.size === prev.offset) {
      prev.size = stat.size;
      offsets.set(filePath, prev);
      return;
    }

    const length = stat.size - prev.offset;
    const handle = await fsp.open(filePath, "r");
    try {
      const buffer = Buffer.alloc(length);
      await handle.read(buffer, 0, length, prev.offset);
      const text = buffer.toString("utf8");
      const lines = text.split(/\r?\n/);
      const sessionId = sessionIdFromFile(filePath);
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          machine.applyJsonl(JSON.parse(trimmed), sessionId);
        } catch {
          // incomplete or non-event line
        }
      }
      offsets.set(filePath, { size: stat.size, offset: stat.size });
    } finally {
      await handle.close();
    }
  }

  async function tick() {
    if (stopped) return;
    if (!fs.existsSync(root)) return;
    const files = await listJsonlFiles(root);
    const recent = files.sort((a, b) => {
      try {
        return fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs;
      } catch {
        return 0;
      }
    }).slice(0, 24);
    const seen = new Set(recent);
    for (const filePath of recent) {
      await ingestFile(filePath, false);
    }
    for (const key of offsets.keys()) {
      if (!seen.has(key)) offsets.delete(key);
    }
  }

  function start() {
    if (timer) return;
    stopped = false;
    timer = setInterval(() => {
      tick().catch((error) => console.error("[jsonl]", error));
    }, intervalMs);
    tick().catch((error) => console.error("[jsonl]", error));
  }

  function stop() {
    stopped = true;
    if (timer) clearInterval(timer);
    timer = null;
  }

  return { start, stop, root };
}

module.exports = { createJsonlWatcher, sessionsRoot };
