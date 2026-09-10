"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const APP_DATA_NAME = "codex-video-pet";
const MANUAL_QUIT_FILE = "manual-quit.json";

function appDataDirectory({ platform = process.platform, env = process.env, home = os.homedir() } = {}) {
  if (platform === "win32") return env.APPDATA || path.join(home, "AppData", "Roaming");
  if (platform === "darwin") return path.join(home, "Library", "Application Support");
  return env.XDG_CONFIG_HOME || path.join(home, ".config");
}

function manualQuitPath(options) {
  return path.join(appDataDirectory(options), APP_DATA_NAME, MANUAL_QUIT_FILE);
}

function isManualQuit(options) {
  try {
    const data = JSON.parse(fs.readFileSync(manualQuitPath(options), "utf8"));
    return data?.manualQuit === true;
  } catch {
    return false;
  }
}

function setManualQuit(manualQuit, options) {
  const filePath = manualQuitPath(options);
  if (!manualQuit) {
    fs.rmSync(filePath, { force: true });
    return;
  }
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify({ manualQuit: true }, null, 2)}\n`, "utf8");
}

module.exports = {
  appDataDirectory,
  isManualQuit,
  manualQuitPath,
  setManualQuit,
};
