"use strict";

const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const { threadIdFromFile, threadIdFromRecord, codexHome } = require("./session-catalog");

const TAIL_BYTES = 64 * 1024;

function sessionsRoot() {
  return path.join(codexHome(), "sessions");
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

  function applyLines(text, filePath, skipPartial) {
    let body = text;
    if (skipPartial) {
      const nl = body.indexOf("\n");
      if (nl >= 0) body = body.slice(nl + 1);
    }
    const fallbackId = threadIdFromFile(filePath);
    for (const line of body.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const record = JSON.parse(trimmed);
        machine.applyJsonl(record, threadIdFromRecord(record, filePath) || fallbackId);
      } catch {
        // incomplete or non-event line
      }
    }
  }

  async function ingestFile(filePath) {
    let stat;
    try {
      stat = await fsp.stat(filePath);
    } catch {
      offsets.delete(filePath);
      return;
    }

    const prev = offsets.get(filePath);
    if (!prev) {
      const seedFrom = Math.max(0, stat.size - TAIL_BYTES);
      const handle = await fsp.open(filePath, "r");
      try {
        const length = stat.size - seedFrom;
        if (length > 0) {
          const buffer = Buffer.alloc(length);
          await handle.read(buffer, 0, length, seedFrom);
          applyLines(buffer.toString("utf8"), filePath, seedFrom > 0);
        }
      } finally {
        await handle.close();
      }
      offsets.set(filePath, { size: stat.size, offset: stat.size });
      return;
    }

    if (stat.size < prev.offset) prev.offset = 0;
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
      applyLines(buffer.toString("utf8"), filePath, false);
      offsets.set(filePath, { size: stat.size, offset: stat.size });
    } finally {
      await handle.close();
    }
  }

  async function tick() {
    if (stopped) return;
    if (!fs.existsSync(root)) return;
    const files = await listJsonlFiles(root);
    const recent = files
      .sort((a, b) => {
        try {
          return fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs;
        } catch {
          return 0;
        }
      })
      .slice(0, 24);
    const seen = new Set(recent);
    for (const filePath of recent) {
      await ingestFile(filePath);
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

module.exports = { createJsonlWatcher, sessionsRoot, threadIdFromFile };
