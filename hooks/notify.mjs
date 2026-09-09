import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const HOST = process.env.CODEX_VIDEO_PET_HOST || "127.0.0.1";
const PORT = Number(process.env.CODEX_VIDEO_PET_PORT || 17331);
const EVENT = process.argv[2] || "";

function readStdin() {
  return new Promise((resolve) => {
    const chunks = [];
    const timer = setTimeout(() => resolve({}), 400);
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => chunks.push(chunk));
    process.stdin.on("end", () => {
      clearTimeout(timer);
      const raw = chunks.join("").trim();
      if (!raw) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch {
        resolve({});
      }
    });
    process.stdin.on("error", () => {
      clearTimeout(timer);
      resolve({});
    });
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
  return {
    cwd: payload.cwd,
    tool_name: payload.tool_name,
    tool_response: payload.tool_response,
    permission_mode: payload.permission_mode,
  };
}

try {
  const payload = await readStdin();
  const sessionId = payload.session_id || payload.sessionId || "unknown";
  const body = {
    source: "hook",
    event: EVENT || payload.hook_event_name || payload.hookEventName,
    session_id: sessionId,
    payload: compactPayload(payload),
  };

  if (EVENT === "SessionStart") {
    try {
      await post("/ensure", body);
    } catch {
      spawnPet();
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
