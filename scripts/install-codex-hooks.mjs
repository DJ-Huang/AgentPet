import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const CODEX_HOME = process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
const HOOKS_PATH = path.join(CODEX_HOME, "hooks.json");
const NOTIFY_CMD = path.join(ROOT, "hooks", "notify.cmd");

const EVENTS = [
  ["SessionStart", 5],
  ["UserPromptSubmit", 5],
  ["PreToolUse", 5],
  ["PostToolUse", 5],
  ["PermissionRequest", 5],
  ["Stop", 5],
  ["Interrupt", 3],
  ["SessionEnd", 3],
];

function handler(event, timeout) {
  const winCmd = `${NOTIFY_CMD} ${event}`;
  return {
    hooks: [
      {
        type: "command",
        command: winCmd,
        commandWindows: winCmd,
        timeout,
      },
    ],
  };
}

function backupExisting() {
  if (!fs.existsSync(HOOKS_PATH)) return null;
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = path.join(CODEX_HOME, `hooks.json.bak-${stamp}`);
  fs.copyFileSync(HOOKS_PATH, backupPath);
  return backupPath;
}

const backupPath = backupExisting();
const hooks = {};
for (const [event, timeout] of EVENTS) {
  hooks[event] = [handler(event, timeout)];
}

fs.mkdirSync(CODEX_HOME, { recursive: true });
fs.writeFileSync(
  HOOKS_PATH,
  `${JSON.stringify(
    {
      description: "Codex Video Pet — transparent desktop overlay. Replaces CodexMotionPet.",
      hooks,
    },
    null,
    2,
  )}\n`,
  "utf8",
);

console.log(`Wrote ${HOOKS_PATH}`);
if (backupPath) console.log(`Backup ${backupPath}`);
console.log("In Codex, run /hooks and trust the new commands (hash changed).");
