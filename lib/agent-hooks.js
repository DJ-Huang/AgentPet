"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const MARKER = "--pet destokpet";
const ROOT = path.resolve(__dirname, "..");
const NOTIFY_CMD = path.join(ROOT, "hooks", "notify.cmd");
const NOTIFY_MJS = path.join(ROOT, "hooks", "notify.mjs");
const CODELY_EXTENSION_NAME = "desktop-pet";

const CODEX_EVENTS = [
  ["SessionStart", 5],
  ["UserPromptSubmit", 5],
  ["PreToolUse", 5],
  ["PostToolUse", 5],
  ["PermissionRequest", 5],
  ["Stop", 5],
  ["Interrupt", 3],
  ["SessionEnd", 3],
];

const AGENTS = {
  codex: {
    id: "codex",
    name: "Codex",
    format: "nested",
    fileKind: "hooks-root",
    windowsFields: true,
    events: CODEX_EVENTS,
    configPath() {
      return path.join(process.env.CODEX_HOME || path.join(os.homedir(), ".codex"), "hooks.json");
    },
  },
  cursor: {
    id: "cursor",
    name: "Cursor",
    format: "cursor-flat",
    fileKind: "hooks-root",
    events: [
      ["sessionStart", 5],
      ["beforeSubmitPrompt", 5],
      ["preToolUse", 5],
      ["postToolUse", 5],
      ["postToolUseFailure", 5],
      ["stop", 5],
      ["sessionEnd", 3],
    ],
    configPath() {
      return path.join(os.homedir(), ".cursor", "hooks.json");
    },
  },
  "codely-cli": {
    id: "codely-cli",
    name: "Codely CLI",
    format: "nested",
    fileKind: "settings",
    hookName: "desktop-pet",
    events: [
      ["SessionStart", 5000],
      ["BeforeAgent", 5000],
      ["BeforeTool", 5000],
      ["AfterTool", 5000],
      ["AfterToolFailure", 5000],
      ["PermissionRequest", 5000],
      ["AfterAgent", 5000],
      ["SessionEnd", 3000],
    ],
    configPath() {
      return path.join(os.homedir(), ".codely-cli", "settings.json");
    },
    extensionDir() {
      return path.join(os.homedir(), ".codely-cli", "extensions", CODELY_EXTENSION_NAME);
    },
  },
  "claude-code": {
    id: "claude-code",
    name: "Claude Code",
    format: "nested",
    fileKind: "settings",
    events: [
      ["SessionStart", 5],
      ["UserPromptSubmit", 5],
      ["PreToolUse", 5],
      ["PostToolUse", 5],
      ["PostToolUseFailure", 5],
      ["PermissionRequest", 5],
      ["Stop", 5],
      ["StopFailure", 5],
      ["SessionEnd", 3],
    ],
    configPath() {
      return path.join(os.homedir(), ".claude", "settings.json");
    },
  },
};

const INSTALL_ORDER = ["codex", "cursor", "codely-cli", "claude-code"];

function resolveAgent(id) {
  const agent = AGENTS[id];
  if (!agent) throw new Error(`unknown agent: ${id}`);
  if (agent.aliasOf) {
    const target = AGENTS[agent.aliasOf];
    return {
      ...target,
      id: agent.id,
      name: agent.name,
      aliasOf: agent.aliasOf,
      sharedWith: [agent.aliasOf, ...(target.sharedWith || []).filter((item) => item !== agent.id)],
    };
  }
  return agent;
}

function quoteCmdPath(filePath) {
  return `"${String(filePath).replace(/"/g, '\\"')}"`;
}

function notifyCommand(agentId, event) {
  // Avoid .cmd on Windows: cmd.exe re-encodes UTF-8 stdin (Chinese titles become mojibake).
  if (agentId === "codely-cli" || agentId === "cursor" || agentId === "claude-code") {
    return `node ${quoteCmdPath(NOTIFY_MJS)} ${MARKER} ${agentId} ${event}`;
  }
  return `${NOTIFY_CMD} ${MARKER} ${agentId} ${event}`;
}

function normalizeCmd(command) {
  return String(command || "").replace(/\//g, "\\").toLowerCase();
}

function isPetCommand(command) {
  const value = normalizeCmd(command);
  if (value.includes("--pet destokpet")) return true;
  if (value.includes(normalizeCmd(NOTIFY_CMD))) return true;
  if (value.includes(normalizeCmd(NOTIFY_MJS))) return true;
  return value.includes("destokpet") && (value.includes("notify.cmd") || value.includes("notify.mjs"));
}

function stamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function backupFile(filePath) {
  if (!fs.existsSync(filePath)) return null;
  const backupPath = `${filePath}.bak-${stamp()}`;
  fs.copyFileSync(filePath, backupPath);
  return backupPath;
}

function readJson(filePath) {
  if (!fs.existsSync(filePath)) return { exists: false, data: {} };
  const raw = fs.readFileSync(filePath, "utf8");
  if (!raw.trim()) return { exists: true, data: {} };
  try {
    const data = JSON.parse(raw);
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      throw new Error("JSON root must be an object");
    }
    return { exists: true, data };
  } catch (error) {
    throw new Error(`${filePath} is not valid JSON: ${error.message || error}`);
  }
}

function writeJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function nestedHandler(agent, event, timeout) {
  const command = notifyCommand(agent.aliasOf || agent.id, event);
  const handler = {
    type: "command",
    command,
    timeout,
  };
  if (agent.hookName) handler.name = agent.hookName;
  if (agent.windowsFields) {
    handler.commandWindows = command;
    handler.statusMessage = "Desktop Pet";
  }
  return handler;
}

function stripNestedGroups(groups) {
  return (Array.isArray(groups) ? groups : [])
    .map((group) => {
      if (group && typeof group === "object" && Array.isArray(group.hooks)) {
        const hooks = group.hooks.filter((hook) => !isPetCommand(hook?.command || hook?.commandWindows));
        return { ...group, hooks };
      }
      if (isPetCommand(group?.command || group?.commandWindows)) return null;
      return group;
    })
    .filter((group) => {
      if (!group) return false;
      if (Array.isArray(group.hooks)) return group.hooks.length > 0;
      return true;
    });
}

function countNestedOurs(groups) {
  let count = 0;
  for (const group of Array.isArray(groups) ? groups : []) {
    if (Array.isArray(group?.hooks)) {
      count += group.hooks.filter((hook) => isPetCommand(hook?.command || hook?.commandWindows)).length;
    } else if (isPetCommand(group?.command || group?.commandWindows)) {
      count += 1;
    }
  }
  return count;
}

function mergeNested(data, agent, install) {
  const hooks = { ...(data.hooks && typeof data.hooks === "object" ? data.hooks : {}) };
  for (const [event, timeout] of agent.events) {
    const kept = stripNestedGroups(hooks[event]);
    if (install) {
      kept.push({ hooks: [nestedHandler(agent, event, timeout)] });
    }
    if (kept.length) hooks[event] = kept;
    else delete hooks[event];
  }
  if (agent.fileKind === "settings") {
    const next = { ...data, hooks };
    if (Object.keys(hooks).length === 0) delete next.hooks;
    return next;
  }
  const description =
    typeof data.description === "string" && data.description.trim() && !data.description.includes("Codex Video Pet")
      ? data.description
      : "Desktop Pet — observe Codex / Cursor / Codely CLI / Claude Code sessions.";
  return { ...data, description, hooks };
}

function readCodelyExtensionHooks() {
  const agent = AGENTS["codely-cli"];
  const hooksPath = path.join(agent.extensionDir(), "hooks", "hooks.json");
  try {
    const { exists, data } = readJson(hooksPath);
    if (!exists) return { exists: false, hooks: {} };
    const hooks = data.hooks && typeof data.hooks === "object" ? data.hooks : {};
    return { exists: true, hooks };
  } catch {
    return { exists: false, hooks: {} };
  }
}

function writeCodelyExtension(install) {
  const agent = AGENTS["codely-cli"];
  const dir = agent.extensionDir();
  if (!install) {
    fs.rmSync(dir, { recursive: true, force: true });
    return;
  }
  fs.mkdirSync(path.join(dir, "hooks"), { recursive: true });
  writeJson(path.join(dir, "gemini-extension.json"), {
    name: CODELY_EXTENSION_NAME,
    version: "1.0.0",
    description: "DestokPet desktop pet — observe Codely CLI sessions.",
  });
  const hooks = {};
  for (const [event, timeout] of agent.events) {
    hooks[event] = [{ hooks: [nestedHandler(agent, event, timeout)] }];
  }
  writeJson(path.join(dir, "hooks", "hooks.json"), { hooks });
}

function mergeCodelySettings(data, install) {
  const agent = AGENTS["codely-cli"];
  const hooks = { ...(data.hooks && typeof data.hooks === "object" ? data.hooks : {}) };
  // Keep destokpet out of user settings.json. Codely treats user hooks as
  // untrusted project hooks when the workspace has none, then skips them
  // again when loading the user scope. Extension hooks are not trust-gated.
  for (const [event] of agent.events) {
    const kept = stripNestedGroups(hooks[event]);
    if (kept.length) hooks[event] = kept;
    else delete hooks[event];
  }
  if (install) hooks.enabled = true;
  const next = { ...data, hooks };
  if (Object.keys(hooks).length === 0) delete next.hooks;
  return next;
}

function stripCursorHooks(list) {
  return (Array.isArray(list) ? list : []).filter((item) => !isPetCommand(item?.command));
}

function countCursorOurs(list) {
  return (Array.isArray(list) ? list : []).filter((item) => isPetCommand(item?.command)).length;
}

function mergeCursor(data, agent, install) {
  const hooks = { ...(data.hooks && typeof data.hooks === "object" ? data.hooks : {}) };
  const writerId = agent.aliasOf || agent.id;
  for (const [event, timeout] of agent.events) {
    const kept = stripCursorHooks(hooks[event]);
    if (install) {
      kept.push({
        command: notifyCommand(writerId, event),
        timeout,
      });
    }
    if (kept.length) hooks[event] = kept;
    else delete hooks[event];
  }
  return { ...data, version: data.version || 1, hooks };
}

function eventCoverage(data, agent) {
  const hooks =
    agent.id === "codely-cli"
      ? readCodelyExtensionHooks().hooks
      : data.hooks && typeof data.hooks === "object"
        ? data.hooks
        : {};
  const matched = [];
  const missing = [];
  for (const [event] of agent.events) {
    const count =
      agent.format === "cursor-flat" ? countCursorOurs(hooks[event]) : countNestedOurs(hooks[event]);
    if (count > 0) matched.push(event);
    else missing.push(event);
  }
  let status = "missing";
  if (matched.length === agent.events.length) status = "installed";
  else if (matched.length > 0) status = "partial";
  return { status, matched, missing };
}

function applyAgent(agentId, install) {
  const agent = resolveAgent(agentId);
  const configPath = agent.configPath();
  const { data } = readJson(configPath);
  const next =
    agent.id === "codely-cli"
      ? mergeCodelySettings(data, install)
      : agent.format === "cursor-flat"
        ? mergeCursor(data, agent, install)
        : mergeNested(data, agent, install);
  const backupPath = backupFile(configPath);
  writeJson(configPath, next);
  if (agent.id === "codely-cli") writeCodelyExtension(install);
  return {
    id: agentId,
    ok: true,
    configPath: agent.id === "codely-cli" ? agent.extensionDir() : configPath,
    backupPath,
    coverage: eventCoverage(next, agent),
  };
}

function displayPath(filePath) {
  const home = os.homedir();
  if (filePath.toLowerCase().startsWith(home.toLowerCase())) {
    return `~${filePath.slice(home.length).replace(/\\/g, "/")}`;
  }
  return filePath;
}

function agentNote(agent) {
  if (agent.id === "codex") {
    return "Writes ~/.codex/hooks.json. After install, run /hooks in Codex and trust the new commands.";
  }
  if (agent.id === "cursor") {
    return "Writes user hooks to ~/.cursor/hooks.json. Cursor reloads on save; if they do not appear, restart Cursor.";
  }
  if (agent.id === "codely-cli") {
    return "Installs ~/.codely-cli/extensions/desktop-pet (extension hooks skip project trust) and sets hooks.enabled in settings.json. Restart Codely CLI, then run /hooks to confirm.";
  }
  return "Writes user hooks into ~/.claude/settings.json without replacing other settings. Run /hooks in Claude Code to confirm.";
}

function statusFor(agentId) {
  const agent = resolveAgent(agentId);
  const configPath = agent.id === "codely-cli" ? agent.extensionDir() : agent.configPath();
  try {
    const { exists, data } = readJson(agent.configPath());
    const coverage = eventCoverage(data, agent);
    const present =
      agent.id === "codely-cli" ? readCodelyExtensionHooks().exists || exists : exists;
    return {
      id: agent.id,
      name: agent.name,
      aliasOf: agent.aliasOf || null,
      sharedWith: agent.sharedWith || [],
      configPath,
      displayPath: displayPath(configPath),
      exists: present,
      ok: true,
      note: agentNote(agent),
      ...coverage,
    };
  } catch (error) {
    return {
      id: agent.id,
      name: agent.name,
      aliasOf: agent.aliasOf || null,
      sharedWith: agent.sharedWith || [],
      configPath,
      displayPath: displayPath(configPath),
      exists: fs.existsSync(configPath),
      ok: false,
      status: "error",
      matched: [],
      missing: agent.events.map(([event]) => event),
      note: agentNote(agent),
      error: String(error.message || error),
    };
  }
}

function listAgents() {
  return INSTALL_ORDER.map((id) => statusFor(id));
}

function uniqueInstallIds(agentId) {
  if (!agentId || agentId === "*") return INSTALL_ORDER;
  const agent = resolveAgent(agentId);
  return [agent.aliasOf || agent.id];
}

function installHooks(agentId) {
  return uniqueInstallIds(agentId).map((id) => applyAgent(id, true));
}

function uninstallHooks(agentId) {
  return uniqueInstallIds(agentId).map((id) => applyAgent(id, false));
}

function getHookStatus() {
  return {
    notifyCmd: NOTIFY_CMD,
    agents: listAgents(),
  };
}

module.exports = {
  AGENTS,
  getHookStatus,
  installHooks,
  uninstallHooks,
};
