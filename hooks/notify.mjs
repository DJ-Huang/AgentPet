import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import launchControl from "../lib/launch-control.js";
import textEncoding from "../lib/text-encoding.js";
import hookTitle from "../lib/hook-title.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const { isManualQuit } = launchControl;
const { repairUtf8Mojibake } = textEncoding;
const { titleFor } = hookTitle;
const HOST = process.env.CODEX_VIDEO_PET_HOST || "127.0.0.1";
const PORT = Number(process.env.CODEX_VIDEO_PET_PORT || 17331);
const KNOWN_AGENTS = new Set(["codex", "codely-cli", "cursor", "claude-code"]);
const EVENT_ALIASES = {
  sessionstart: "SessionStart",
  sessionend: "SessionEnd",
  userpromptsubmit: "UserPromptSubmit",
  beforesubmitprompt: "UserPromptSubmit",
  beforeagent: "UserPromptSubmit",
  pretooluse: "PreToolUse",
  beforetool: "PreToolUse",
  posttooluse: "PostToolUse",
  aftertool: "PostToolUse",
  posttoolusefailure: "PostToolUseFailure",
  aftertoolfailure: "PostToolUseFailure",
  permissionrequest: "PermissionRequest",
  stop: "Stop",
  afteragent: "Stop",
  stopfailure: "StopFailure",
  interrupt: "Interrupt",
  subagentstop: "SubagentStop",
  afteragentthought: "UserPromptSubmit",
};

function parseArgs(argv) {
  let agent = "codex";
  let event = "";
  for (const raw of argv) {
    const arg = String(raw || "").trim();
    if (!arg || arg === "--pet" || arg === "destokpet") continue;
    if (KNOWN_AGENTS.has(arg)) {
      agent = arg;
      continue;
    }
    event = arg;
  }
  return { agent, event };
}

function normalizeEvent(event, payload) {
  const raw = event || payload?.hook_event_name || payload?.hookEventName || payload?.event || "";
  const key = String(raw).replace(/[^a-zA-Z]/g, "").toLowerCase();
  if (EVENT_ALIASES[key]) return EVENT_ALIASES[key];
  if (!raw) return "";
  return raw[0].toUpperCase() + raw.slice(1);
}

function repairStrings(value) {
  if (typeof value === "string") return repairUtf8Mojibake(value);
  if (Array.isArray(value)) return value.map(repairStrings);
  if (value && typeof value === "object") {
    const next = {};
    for (const [key, item] of Object.entries(value)) next[key] = repairStrings(item);
    return next;
  }
  return value;
}

function parseHookJson(buffer) {
  if (!buffer.length) return {};
  const texts = [buffer.toString("utf8"), buffer.toString("utf16le")];
  for (const text of texts) {
    const raw = text.replace(/^\uFEFF/, "").trim();
    if (!raw) continue;
    try {
      return repairStrings(JSON.parse(raw));
    } catch {
      // try next encoding
    }
  }
  return {};
}

function readStdin() {
  return new Promise((resolve) => {
    const chunks = [];
    const finish = () => {
      clearTimeout(timer);
      process.stdin.removeListener("data", onData);
      process.stdin.removeListener("end", finish);
      resolve(parseHookJson(Buffer.concat(chunks)));
    };
    const onData = (chunk) => chunks.push(Buffer.from(chunk));
    const timer = setTimeout(finish, 400);
    process.stdin.on("data", onData);
    process.stdin.on("end", finish);
    process.stdin.on("error", finish);
  });
}

function post(pathname, body) {
  return new Promise((resolve, reject) => {
    const json = JSON.stringify(body);
    const req = http.request(
      {
        hostname: HOST,
        port: PORT,
        path: pathname,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(json),
        },
        timeout: 800,
      },
      (res) => {
        res.resume();
        res.on("end", resolve);
      },
    );
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("timeout"));
    });
    req.on("error", reject);
    req.write(json);
    req.end();
  });
}

function spawnPet() {
  const electronExe = path.join(ROOT, "node_modules", "electron", "dist", "electron.exe");
  const cmd = fs.existsSync(electronExe) ? electronExe : "npx";
  const args = fs.existsSync(electronExe) ? [ROOT] : ["electron", ROOT];
  const child = spawn(cmd, args, {
    cwd: ROOT,
    detached: true,
    stdio: "ignore",
    windowsHide: true,
    shell: !fs.existsSync(electronExe),
  });
  child.unref();
}

function compactPayload(payload) {
  if (!payload || typeof payload !== "object") return {};
  const roots = payload.workspace_roots || payload.workspaceRoots;
  return {
    cwd: payload.cwd || (Array.isArray(roots) ? roots[0] : "") || "",
    workspace_roots: Array.isArray(roots) ? roots : undefined,
    tool_name: payload.tool_name || payload.toolName,
    tool_response: payload.tool_response || payload.toolResponse,
    permission_mode: payload.permission_mode || payload.permissionMode,
  };
}

function sessionIdFor(agent, payload) {
  const raw =
    payload.session_id ||
    payload.sessionId ||
    payload.conversation_id ||
    payload.conversationId ||
    payload.thread_id ||
    payload.threadId ||
    "unknown";
  const id = String(raw);
  if (agent === "cursor") return id.startsWith("cursor:") ? id : `cursor:${id}`;
  if (agent === "claude-code") return id.startsWith("claude:") ? id : `claude:${id}`;
  if (agent === "codely-cli") return id.startsWith("codely:") ? id : `codely:${id}`;
  return id;
}

const { agent: AGENT, event: EVENT_ARG } = parseArgs(process.argv.slice(2));

try {
  const payload = await readStdin();
  const event = normalizeEvent(EVENT_ARG, payload);
  const sessionId = sessionIdFor(AGENT, payload);
  const body = {
    source: "hook",
    agent: AGENT,
    event,
    session_id: sessionId,
    title: titleFor(AGENT, payload),
    payload: compactPayload(payload),
  };

  if (event === "SessionStart") {
    if (!isManualQuit()) {
      try {
        await post("/ensure", body);
      } catch {
        spawnPet();
      }
    }
  } else {
    try {
      await post("/state", body);
    } catch {
      // fail-open: pet may be closed
    }
  }
} catch {
  // fail-open
} finally {
  process.stdout.write("{}\n");
}
