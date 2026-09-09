"use strict";

const { app, BrowserWindow, Tray, Menu, ipcMain, nativeImage, screen } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const { PetStateMachine } = require("./lib/state-machine");
const { createStateServer } = require("./lib/http-server");
const { createJsonlWatcher } = require("./lib/jsonl-watcher");
const { createSessionCatalog, LIST_LIMIT } = require("./lib/session-catalog");

const HOST = process.env.CODEX_VIDEO_PET_HOST || "127.0.0.1";
const PORT = Number(process.env.CODEX_VIDEO_PET_PORT || 17331);
const PET_DIR = path.join(__dirname, "assets", "pet");
const SETTINGS_FILE = path.join(app.getPath("userData"), "window-position.json");
const SCALE_MIN = 0.25;
const SCALE_MAX = 3;
const SCALE_STEP = 0.1;
const SCALE_PRESETS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2];
const PANEL_HEIGHT = 188;

let mainWindow = null;
let tray = null;
let httpServer = null;
let jsonlWatcher = null;
let sessionCatalog = null;
let machine = null;
let scale = 0.5;
let dragOffset = null;
let dragTimer = null;

function loadManifest() {
  const manifestPath = path.join(PET_DIR, "manifest.json");
  const raw = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const clips = raw.clips || {};
  const files = {};
  const missing = {};
  for (const [name, clip] of Object.entries(clips)) {
    const filePath = path.join(PET_DIR, clip.file);
    if (fs.existsSync(filePath)) {
      files[name] = pathToFileUrl(filePath);
    } else {
      missing[name] = clip.file;
    }
  }
  const size = Array.isArray(raw.size) ? raw.size : [360, 360];
  return {
    size,
    reviewHoldMs: raw.reviewHoldMs || 8000,
    clips,
    files,
    missing,
    state: machine ? machine.aggregate() : "idle",
    threads: machine ? machine.threadList() : [],
    drivingId: machine ? machine.snapshot().drivingId : null,
    pinnedId: machine ? machine.pinnedId : null,
  };
}

function pathToFileUrl(filePath) {
  const resolved = path.resolve(filePath).replace(/\\/g, "/");
  return encodeURI(`file:///${resolved}`);
}

function clampScale(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0.5;
  return Math.min(SCALE_MAX, Math.max(SCALE_MIN, Math.round(n * 100) / 100));
}

function loadSettings() {
  try {
    return JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf8"));
  } catch {
    return {};
  }
}

function videoSize() {
  const manifest = loadManifest();
  const [width, height] = manifest.size;
  return [Math.max(80, Math.round(width * scale)), Math.max(80, Math.round(height * scale))];
}

function windowSize() {
  const [width, height] = videoSize();
  return [Math.max(width, 280), height + PANEL_HEIGHT];
}

function saveSettings() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const bounds = mainWindow.getBounds();
  fs.mkdirSync(path.dirname(SETTINGS_FILE), { recursive: true });
  fs.writeFileSync(
    SETTINGS_FILE,
    JSON.stringify({ x: bounds.x, y: bounds.y, scale, pinnedId: machine ? machine.pinnedId : null }),
  );
}

function restorePosition(width, height) {
  const saved = loadSettings();
  if (Number.isFinite(saved.scale)) scale = clampScale(saved.scale);
  if (Number.isFinite(saved.x) && Number.isFinite(saved.y)) {
    try {
      const display = screen.getDisplayNearestPoint({ x: saved.x, y: saved.y });
      const { x, y, width: dw, height: dh } = display.workArea;
      if (saved.x >= x - 40 && saved.y >= y - 40 && saved.x < x + dw && saved.y < y + dh) {
        return { x: saved.x, y: saved.y, width, height };
      }
    } catch {
      // fall through
    }
  }
  const { workArea } = screen.getPrimaryDisplay();
  return {
    x: workArea.x + workArea.width - width - 24,
    y: workArea.y + workArea.height - height - 24,
    width,
    height,
  };
}

function setScale(next) {
  scale = clampScale(next);
  if (!mainWindow || mainWindow.isDestroyed()) {
    rebuildTray();
    return;
  }
  const [width, height] = windowSize();
  const bounds = mainWindow.getBounds();
  mainWindow.setBounds({
    x: Math.round(bounds.x + bounds.width / 2 - width / 2),
    y: Math.round(bounds.y + bounds.height / 2 - height / 2),
    width,
    height,
  });
  saveSettings();
  rebuildTray();
}

function sendState(snap) {
  const data = snap || (machine ? machine.snapshot() : { state: "idle", threads: [] });
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("pet:state", data);
  }
  rebuildTray();
}

function createWindow() {
  const saved = loadSettings();
  if (Number.isFinite(saved.scale)) scale = clampScale(saved.scale);
  const [width, height] = windowSize();
  const bounds = restorePosition(width, height);

  mainWindow = new BrowserWindow({
    x: bounds.x,
    y: bounds.y,
    width,
    height,
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    hasShadow: false,
    focusable: true,
    fullscreenable: false,
    minimizable: false,
    maximizable: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });

  mainWindow.setAlwaysOnTop(true, "screen-saver");
  mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  mainWindow.setIgnoreMouseEvents(true, { forward: true });
  mainWindow.loadFile(path.join(__dirname, "pet.html"));

  mainWindow.webContents.on("did-finish-load", () => {
    mainWindow.webContents.send("pet:init", { ...loadManifest(), ...machine.snapshot() });
  });
  mainWindow.once("ready-to-show", () => mainWindow.show());
  mainWindow.on("moved", saveSettings);
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

function trayImage() {
  const iconPath = path.join(__dirname, "assets", "tray.png");
  if (fs.existsSync(iconPath)) return nativeImage.createFromPath(iconPath);
  return nativeImage.createFromDataURL(
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAPUlEQVQ4T2NkYGD4z0ABYBw1gGE0DBhGQ58BCgoK/5EFGRgY/qMrRhZjYGD4j66YEbeJ2BRjuAHbZqJ7gXQwDAAA0r4H/6F9yH8AAAAASUVORK5CYII=",
  );
}

function truncate(text, max = 22) {
  const value = String(text || "");
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

function rebuildTray() {
  if (!tray || !machine) return;
  const snap = machine.snapshot();
  const current = snap.state;
  const states = ["idle", "thinking", "working", "waiting", "review", "failed"];
  const sessionItems =
    snap.threads.length === 0
      ? [{ label: "暂无会话", enabled: false }]
      : snap.threads.map((thread) => ({
          label: `${thread.driving ? "▶ " : ""}${truncate(thread.title)}  · ${thread.label}`,
          type: "checkbox",
          checked: Boolean(thread.pinned),
          click: () => {
            machine.togglePin(thread.id);
            saveSettings();
          },
        }));
  const template = [
    { label: `状态：${current}`, enabled: false },
    { type: "separator" },
    {
      label: "Codex 会话",
      submenu: [
        {
          label: "跟随最近活跃",
          type: "radio",
          checked: !snap.pinnedId,
          click: () => {
            machine.setPinned(null);
            saveSettings();
          },
        },
        { type: "separator" },
        ...sessionItems,
      ],
    },
    { type: "separator" },
    ...states.map((state) => ({
      label: state,
      type: "radio",
      checked: current === state,
      click: () => {
        machine.setManual(state);
      },
    })),
    { type: "separator" },
    {
      label: "复位待机",
      click: () => machine.reset(),
    },
    {
      label: `缩放 ${Math.round(scale * 100)}%`,
      submenu: [
        {
          label: "放大",
          click: () => setScale(scale + SCALE_STEP),
        },
        {
          label: "缩小",
          click: () => setScale(scale - SCALE_STEP),
        },
        { type: "separator" },
        ...SCALE_PRESETS.map((value) => ({
          label: `${Math.round(value * 100)}%`,
          type: "radio",
          checked: Math.abs(scale - value) < 0.02,
          click: () => setScale(value),
        })),
      ],
    },
    {
      label: mainWindow?.isVisible() ? "隐藏窗口" : "显示窗口",
      click: () => {
        if (!mainWindow) return;
        if (mainWindow.isVisible()) mainWindow.hide();
        else mainWindow.show();
      },
    },
    {
      label: "重新加载切片",
      click: () => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send("pet:init", { ...loadManifest(), ...machine.snapshot() });
          sendState();
        }
      },
    },
    { type: "separator" },
    { label: "退出", click: () => app.quit() },
  ];
  tray.setContextMenu(Menu.buildFromTemplate(template));
  tray.setToolTip(`Codex Video Pet · ${current}${snap.threads.find((row) => row.driving)?.title ? ` · ${snap.threads.find((row) => row.driving).title}` : ""}`);
}

function createTray() {
  tray = new Tray(trayImage());
  rebuildTray();
  tray.on("double-click", () => {
    if (!mainWindow) return;
    if (mainWindow.isVisible()) mainWindow.hide();
    else mainWindow.show();
  });
}

async function startServices() {
  const saved = loadSettings();
  machine = new PetStateMachine({
    reviewHoldMs: loadManifest().reviewHoldMs,
    onChange: sendState,
  });
  if (saved.pinnedId) machine.setPinned(saved.pinnedId);

  httpServer = await createStateServer({
    host: HOST,
    port: PORT,
    machine,
    ensurePet: () => {
      if (mainWindow && !mainWindow.isVisible()) mainWindow.show();
    },
  });

  sessionCatalog = createSessionCatalog({
    onChange: (threads) => machine.setTitles(threads),
    limit: LIST_LIMIT,
  });
  await sessionCatalog.refresh(true);
  sessionCatalog.start();

  jsonlWatcher = createJsonlWatcher({ machine });
  jsonlWatcher.start();
  console.log(`[codex-video-pet] http://${HOST}:${PORT}`);
  console.log(`[codex-video-pet] jsonl ${jsonlWatcher.root}`);
  console.log(`[codex-video-pet] sessions ${sessionCatalog.path}`);
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!mainWindow) return;
    if (!mainWindow.isVisible()) mainWindow.show();
    mainWindow.focus();
  });

  app.whenReady().then(async () => {
    app.setAppUserModelId("codex-video-pet");
    await startServices();
    createWindow();
    createTray();
  });

  ipcMain.on("pet:pin-thread", (_event, id) => {
    if (!machine) return;
    machine.togglePin(id);
    saveSettings();
  });

  ipcMain.on("pet:clip-ended", (_event, state) => {
    if (machine) machine.clipEnded(state);
  });

  ipcMain.on("pet:ignore-mouse", (_event, ignore) => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (dragOffset) return;
    if (ignore) mainWindow.setIgnoreMouseEvents(true, { forward: true });
    else mainWindow.setIgnoreMouseEvents(false);
  });

  ipcMain.on("pet:scale-by", (_event, delta) => {
    setScale(scale + Number(delta || 0));
  });

  ipcMain.on("pet:drag-start", (_event, cursor) => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    const bounds = mainWindow.getBounds();
    const point = cursor && Number.isFinite(cursor.x) ? cursor : screen.getCursorScreenPoint();
    dragOffset = {
      x: point.x - bounds.x,
      y: point.y - bounds.y,
    };
    mainWindow.setIgnoreMouseEvents(false);
    if (dragTimer) clearInterval(dragTimer);
    dragTimer = setInterval(() => {
      if (!dragOffset || !mainWindow || mainWindow.isDestroyed()) return;
      const pos = screen.getCursorScreenPoint();
      mainWindow.setPosition(Math.round(pos.x - dragOffset.x), Math.round(pos.y - dragOffset.y));
    }, 16);
  });

  ipcMain.on("pet:drag-end", () => {
    dragOffset = null;
    if (dragTimer) {
      clearInterval(dragTimer);
      dragTimer = null;
    }
    saveSettings();
  });

  app.on("window-all-closed", () => {
    // tray keeps the process alive on Windows
  });

  app.on("before-quit", () => {
    if (dragTimer) clearInterval(dragTimer);
    saveSettings();
    if (sessionCatalog) sessionCatalog.stop();
    if (jsonlWatcher) jsonlWatcher.stop();
    if (httpServer) httpServer.close();
  });
}

process.on("uncaughtException", (error) => {
  console.error(error);
});
