"use strict";

const { app, BrowserWindow, Tray, Menu, ipcMain, nativeImage, screen, dialog, shell, globalShortcut } = require("electron");
const { spawn } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { PetStateMachine, inferAgent } = require("./lib/state-machine");
const { createStateServer } = require("./lib/http-server");
const { createJsonlWatcher } = require("./lib/jsonl-watcher");
const { createSessionCatalog, TITLE_LIMIT } = require("./lib/session-catalog");
const { loadClipConfig, addClipFiles, clipFileAt, updateClipState, setClipMask, updateMaskEffects, restoreClipState } = require("./lib/clip-config");
const { getHookStatus, installHooks, uninstallHooks } = require("./lib/agent-hooks");
const { setManualQuit } = require("./lib/launch-control");
const { shouldShowPanelAbove } = require("./lib/panel-placement");

const HOST = process.env.CODEX_VIDEO_PET_HOST || "127.0.0.1";
const PORT = Number(process.env.CODEX_VIDEO_PET_PORT || 17331);
// Default clips live with Hana's bundled videos. Manifest entries resolve relative to this folder.
const PET_DIR = path.join(__dirname, "assets", "hana");
const APP_ICON = path.join(PET_DIR, process.platform === "win32" ? "app-icon.ico" : "app-icon.png");
const SETTINGS_FILE = path.join(app.getPath("userData"), "window-position.json");
const CLIP_CONFIG_FILE = path.join(app.getPath("userData"), "clip-config.json");
const READ_FILE = path.join(app.getPath("userData"), "read-receipts.json");
const SCALE_MIN = 0.1;
const SCALE_MAX = 2;
const SCALE_STEP = 0.01;
const VIDEO_TOGGLE_SHORTCUT = "Alt+V";
const THREAD_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

let mainWindow = null;
let settingsWindow = null;
let tray = null;
let httpServer = null;
let jsonlWatcher = null;
let sessionCatalog = null;
let machine = null;
let scale = 0.5;
let language = "zh-CN";
let dragOffset = null;
let dragTimer = null;
let panelHeight = 0;
let panelAbove = false;
let videoVisible = true;
let mousePassthrough = true;
const maskJobs = new Map();

const TEXT = {
  "zh-CN": {
    noActivity: "暂无活动",
    status: "状态",
    sessions: "Codex 任务",
    followLatest: "跟随最近活动",
    reset: "重置为空闲状态",
    scale: "缩放",
    zoomIn: "放大",
    zoomOut: "缩小",
    hide: "隐藏窗口",
    show: "显示窗口",
    hideVideo: "关闭视频",
    showVideo: "显示视频",
    settings: "设置…",
    reload: "重新加载视频",
    quit: "退出",
    settingsTitle: "桌宠设置",
    chooseVideo: "选择视频",
    video: "视频",
    untitled: "未命名任务",
    dismissSession: "从列表中移除",
    agents: { codex: "Codex", cursor: "Cursor", "codely-cli": "Codely", "claude-code": "Claude", manual: "手动" },
    maskStartFailed: "无法启动 Mask 生成器",
    maskFailed: "Mask 生成失败",
    clipNotFound: "找不到要生成 Mask 的视频",
    states: { idle: "空闲", waiting: "等待确认", working: "工作中", completed: "完成" },
  },
  en: {
    noActivity: "No activity",
    status: "Status",
    sessions: "Codex Tasks",
    followLatest: "Follow Latest Activity",
    reset: "Reset to Idle",
    scale: "Scale",
    zoomIn: "Zoom In",
    zoomOut: "Zoom Out",
    hide: "Hide Window",
    show: "Show Window",
    hideVideo: "Hide Video",
    showVideo: "Show Video",
    settings: "Settings…",
    reload: "Reload Videos",
    quit: "Quit",
    settingsTitle: "Desktop Pet Settings",
    chooseVideo: "Choose Videos",
    video: "Videos",
    untitled: "Untitled Task",
    dismissSession: "Remove from list",
    agents: { codex: "Codex", cursor: "Cursor", "codely-cli": "Codely", "claude-code": "Claude", manual: "Manual" },
    maskStartFailed: "Unable to start the Mask generator",
    maskFailed: "Mask generation failed",
    clipNotFound: "The video selected for Mask generation could not be found",
    states: { idle: "Idle", waiting: "Needs Input", working: "Working", completed: "Done" },
  },
};

function normalizeLanguage(value) {
  return value === "en" ? "en" : "zh-CN";
}

function text(key) {
  return TEXT[language]?.[key] ?? TEXT["zh-CN"][key] ?? key;
}

function stateText(state) {
  return TEXT[language]?.states?.[state] || state;
}

function agentText(agent) {
  return TEXT[language]?.agents?.[agent] || TEXT["zh-CN"].agents?.[agent] || "";
}

function loadManifest() {
  const resolved = loadClipConfig({ petDir: PET_DIR, userConfigPath: CLIP_CONFIG_FILE });
  return {
    ...resolved,
    state: machine ? machine.aggregate() : "idle",
    threads: machine ? machine.threadList() : [],
    drivingId: machine ? machine.snapshot().drivingId : null,
    pinnedId: machine ? machine.pinnedId : null,
    language,
    scale,
    videoVisible,
    mousePassthrough,
  };
}

function pushClipConfig(payload) {
  const data = payload || loadManifest();
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("pet:init", { ...data, ...(machine ? machine.snapshot() : {}) });
  }
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.webContents.send("clips:updated", data);
  }
  return data;
}

function pushEffectConfig(payload) {
  const data = payload || loadManifest();
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("pet:effects", data.effects);
  }
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.webContents.send("clips:updated", data);
  }
  return data;
}

function maskOutputPath(videoPath) {
  const id = crypto.createHash("sha256").update(videoPath.toLowerCase()).digest("hex").slice(0, 20);
  return path.join(app.getPath("userData"), "masks", `${id}.png`);
}

function runMaskGenerator(videoPath, outputPath) {
  const key = videoPath.toLowerCase();
  if (maskJobs.has(key)) return maskJobs.get(key);
  const script = path.join(__dirname, "scripts", "make-person-sdf-mask.py");
  const job = new Promise((resolve, reject) => {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    const child = spawn(process.env.PYTHON || "python", [script, videoPath, outputPath], {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let errorText = "";
    let outputText = "";
    child.stdout.on("data", (chunk) => {
      outputText = `${outputText}${chunk}`.slice(-2000);
    });
    child.stderr.on("data", (chunk) => {
      errorText = `${errorText}${chunk}`.slice(-2000);
    });
    child.once("error", (error) => reject(new Error(`${text("maskStartFailed")}: ${error.message}`)));
    child.once("close", (code) => {
      if (code === 0 && fs.existsSync(outputPath)) {
        console.log(`[codex-video-pet] mask generated: ${outputText.trim()}`);
        resolve(outputPath);
      }
      else reject(new Error(`${text("maskFailed")}${errorText ? `: ${errorText.trim()}` : ""}`));
    });
  });
  maskJobs.set(key, job);
  job.finally(() => maskJobs.delete(key)).catch(() => {});
  return job;
}

function clampScale(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0.5;
  return Math.min(SCALE_MAX, Math.max(SCALE_MIN, Math.round(n * 100) / 100));
}

function loadReadReceipts() {
  try {
    const raw = JSON.parse(fs.readFileSync(READ_FILE, "utf8"));
    return raw.receipts && typeof raw.receipts === "object" ? raw.receipts : {};
  } catch {
    return {};
  }
}

function saveReadReceipts(receipts) {
  fs.mkdirSync(path.dirname(READ_FILE), { recursive: true });
  fs.writeFileSync(READ_FILE, `${JSON.stringify({ receipts: receipts || {} }, null, 2)}\n`);
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
  if (!videoVisible) return [280, Math.max(40, panelHeight)];
  const [width, height] = videoSize();
  const extra = Math.max(0, panelHeight);
  return [Math.max(width, extra ? 280 : width), height + extra];
}

function setWindowBounds(nextBounds) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const current = mainWindow.getBounds();
  if (dragOffset) {
    dragOffset.x += current.x - nextBounds.x;
    dragOffset.y += current.y - nextBounds.y;
  }
  mainWindow.setBounds(nextBounds);
}

function applyWindowSize(previousPanelHeight = panelHeight) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const [width, height] = windowSize();
  const bounds = mainWindow.getBounds();
  if (bounds.width === width && bounds.height === height) return;
  setWindowBounds({
    x: bounds.x,
    y: bounds.y + (videoVisible && panelAbove ? previousPanelHeight - panelHeight : 0),
    width,
    height,
  });
}

function sendPanelPlacement() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("pet:panel-placement", { above: panelAbove });
  }
}

function syncPanelPlacement() {
  if (!mainWindow || mainWindow.isDestroyed() || !videoVisible || panelHeight <= 0) return;
  const bounds = mainWindow.getBounds();
  const [, petHeight] = videoSize();
  const petTop = bounds.y + (panelAbove ? panelHeight : 0);
  const display = screen.getDisplayNearestPoint({
    x: Math.round(bounds.x + bounds.width / 2),
    y: Math.round(petTop + petHeight / 2),
  });
  const above = shouldShowPanelAbove({ workArea: display.workArea, petTop, petHeight });
  if (above === panelAbove) return;

  panelAbove = above;
  setWindowBounds({
    x: bounds.x,
    y: petTop - (panelAbove ? panelHeight : 0),
    width: bounds.width,
    height: bounds.height,
  });
  sendPanelPlacement();
}

function setVideoVisible(next) {
  const visible = Boolean(next);
  if (visible === videoVisible) return;
  if (!mainWindow || mainWindow.isDestroyed()) {
    videoVisible = visible;
    return;
  }

  const bounds = mainWindow.getBounds();
  const [, videoHeight] = videoSize();
  const panelTop = videoVisible ? bounds.y + (panelAbove ? 0 : videoHeight) : bounds.y;
  videoVisible = visible;
  const [width, height] = windowSize();
  setWindowBounds({
    x: Math.round(bounds.x + bounds.width / 2 - width / 2),
    y: Math.round(videoVisible ? panelTop - (panelAbove ? 0 : videoHeight) : panelTop),
    width,
    height,
  });
  mainWindow.webContents.send("pet:video-visibility", { visible: videoVisible });
  if (videoVisible || panelHeight > 0) mainWindow.show();
  else mainWindow.hide();
  saveSettings();
  rebuildTray();
}

function applyMousePassthrough() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mousePassthrough) mainWindow.setIgnoreMouseEvents(true, { forward: true });
  else mainWindow.setIgnoreMouseEvents(false);
}

function saveSettings() {
  const existing = loadSettings();
  const bounds = mainWindow && !mainWindow.isDestroyed() ? mainWindow.getBounds() : null;
  fs.mkdirSync(path.dirname(SETTINGS_FILE), { recursive: true });
  fs.writeFileSync(
    SETTINGS_FILE,
    JSON.stringify({
      ...existing,
      ...(bounds ? { x: bounds.x, y: bounds.y } : {}),
      scale,
      language,
      videoVisible,
      mousePassthrough,
      pinnedId: machine ? machine.pinnedId : existing.pinnedId || null,
    }),
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
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.webContents.send("pet:scale", scale);
  }
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
  videoVisible = saved.videoVisible !== false;
  mousePassthrough = saved.mousePassthrough !== false;
  const [width, height] = windowSize();
  const bounds = restorePosition(width, height);

  mainWindow = new BrowserWindow({
    icon: APP_ICON,
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
  applyMousePassthrough();
  if (process.platform !== "darwin") mainWindow.setIcon(APP_ICON);
  if (process.platform === "win32") {
    mainWindow.setAppDetails({
      appId: "codex-video-pet",
      appIconPath: APP_ICON,
    });
  }
  mainWindow.loadFile(path.join(__dirname, "pet.html"));

  mainWindow.webContents.on("did-finish-load", () => {
    mainWindow.webContents.send("pet:init", { ...loadManifest(), ...machine.snapshot() });
    sendPanelPlacement();
  });
  mainWindow.once("ready-to-show", () => {
    if (videoVisible || panelHeight > 0) mainWindow.show();
  });
  mainWindow.on("moved", () => {
    syncPanelPlacement();
    saveSettings();
  });
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

function trayImage() {
  if (fs.existsSync(APP_ICON)) {
    const icon = nativeImage.createFromPath(APP_ICON);
    if (!icon.isEmpty()) return process.platform === "darwin" ? icon.resize({ width: 18, height: 18 }) : icon;
  }
  return nativeImage.createFromDataURL(
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAPUlEQVQ4T2NkYGD4z0ABYBw1gGE0DBhGQ58BCgoK/5EFGRgY/qMrRhZjYGD4j66YEbeJ2BRjuAHbZqJ7gXQwDAAA0r4H/6F9yH8AAAAASUVORK5CYII=",
  );
}

function resolveCursorApp() {
  const localAppData = process.env.LOCALAPPDATA || "";
  const userProfile = process.env.USERPROFILE || "";
  const programFiles = process.env.PROGRAMFILES || "";
  const candidates = [
    path.join(localAppData, "Programs", "cursor", "Cursor.exe"),
    path.join(localAppData, "Programs", "Cursor", "Cursor.exe"),
    path.join(userProfile, "AppData", "Local", "Programs", "cursor", "Cursor.exe"),
    path.join(programFiles, "cursor", "Cursor.exe"),
    path.join(programFiles, "Cursor", "Cursor.exe"),
    "D:\\Program Files\\cursor\\Cursor.exe",
    "D:\\Program Files\\Cursor\\Cursor.exe",
    "C:\\Program Files\\cursor\\Cursor.exe",
    "C:\\Program Files\\Cursor\\Cursor.exe",
  ];
  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) return { cmd: candidate, useShell: false };
  }
  return { cmd: "cursor", useShell: true };
}

function launchDetached(cmd, args, useShell) {
  const child = spawn(cmd, args, {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
    shell: useShell,
  });
  child.on("error", (error) => {
    console.error("[codex-video-pet] launch failed", cmd, error);
  });
  child.unref();
}

function openCursor(cwd) {
  const folder = typeof cwd === "string" && cwd && fs.existsSync(cwd) ? cwd : "";
  const { cmd, useShell } = resolveCursorApp();
  try {
    launchDetached(cmd, folder ? ["--reuse-window", folder] : [], useShell);
  } catch (error) {
    console.error("[codex-video-pet] open Cursor failed", error);
    shell.openExternal("cursor://").catch((err) => {
      console.error("[codex-video-pet] open Cursor protocol failed", err);
    });
  }
}

function openThread(id) {
  const threadId = String(id || "");
  if (!threadId) return;
  const session = machine?.sessions?.get(threadId);
  const agent = inferAgent(session?.agent, threadId);
  if (agent === "cursor") return;
  if (!THREAD_ID_RE.test(threadId)) return;
  const url = `codex://threads/${threadId}`;
  shell.openExternal(url).catch((error) => {
    console.error("[codex-video-pet] open thread failed", url, error);
  });
  if (machine) machine.markRead(threadId);
}

function truncate(text, max = 22) {
  const value = String(text || "");
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

function rebuildTray() {
  if (!tray || !machine) return;
  const snap = machine.snapshot();
  const current = snap.state;
  const separator = language === "en" ? ": " : "：";
  const states = ["idle", "waiting", "working", "completed"];
  const sessionItems =
    snap.threads.length === 0
      ? [{ label: text("noActivity"), enabled: false }]
      : snap.threads.map((thread) => ({
          label: `${thread.driving ? "▶ " : ""}${agentText(thread.agent || "codex")} · ${truncate(thread.title || text("untitled"))}  · ${stateText(thread.state)}`,
          click: () => openThread(thread.id),
        }));
  const template = [
    { label: `${text("status")}${separator}${stateText(current)}`, enabled: false },
    { type: "separator" },
    {
      label: text("sessions"),
      submenu: [
        {
          label: text("followLatest"),
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
      label: stateText(state),
      type: "radio",
      checked: current === state,
      click: () => {
        machine.setManual(state);
      },
    })),
    { type: "separator" },
    {
      label: text("reset"),
      click: () => machine.reset(),
    },
    {
      label: `${text("scale")} ${Math.round(scale * 100)}%`,
      submenu: [
        {
          label: text("zoomIn"),
          click: () => setScale(scale + SCALE_STEP),
        },
        {
          label: text("zoomOut"),
          click: () => setScale(scale - SCALE_STEP),
        },
      ],
    },
    {
      label: mainWindow?.isVisible() ? text("hide") : text("show"),
      click: () => {
        if (!mainWindow) return;
        if (mainWindow.isVisible()) mainWindow.hide();
        else mainWindow.show();
      },
    },
    {
      label: videoVisible ? text("hideVideo") : text("showVideo"),
      click: () => setVideoVisible(!videoVisible),
    },
    {
      label: text("settings"),
      click: () => createSettingsWindow(),
    },
    {
      label: text("reload"),
      click: () => {
        pushClipConfig();
        sendState();
      },
    },
    { type: "separator" },
    { label: text("quit"), click: () => app.quit() },
  ];
  tray.setContextMenu(Menu.buildFromTemplate(template));
  tray.setToolTip(`Codex Video Pet · ${stateText(current)}${snap.threads.find((row) => row.driving)?.title ? ` · ${snap.threads.find((row) => row.driving).title}` : ""}`);
}

function createSettingsWindow() {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.show();
    settingsWindow.focus();
    return;
  }
  settingsWindow = new BrowserWindow({
    icon: APP_ICON,
    width: 560,
    height: 740,
    minWidth: 440,
    minHeight: 480,
    title: text("settingsTitle"),
    autoHideMenuBar: true,
    backgroundColor: "#1b1b1f",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  if (process.platform !== "darwin") settingsWindow.setIcon(APP_ICON);
  if (process.platform === "win32") {
    settingsWindow.setAppDetails({
      appId: "codex-video-pet",
      appIconPath: APP_ICON,
    });
  }
  settingsWindow.setMenuBarVisibility(false);
  settingsWindow.loadFile(path.join(__dirname, "settings.html"));
  settingsWindow.webContents.on("did-finish-load", () => {
    settingsWindow.webContents.send("clips:updated", loadManifest());
  });
  settingsWindow.on("closed", () => {
    settingsWindow = null;
  });
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
    onChange: sendState,
    onReadChange: saveReadReceipts,
    readAt: loadReadReceipts(),
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
    limit: TITLE_LIMIT,
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
    // A user opening the app explicitly opts back into hook-based auto-start.
    setManualQuit(false);
    if (process.platform === "win32") app.setAppUserModelId("codex-video-pet");
    if (process.platform === "darwin" && app.dock) app.dock.setIcon(APP_ICON);
    language = normalizeLanguage(loadSettings().language);
    await startServices();
    createWindow();
    createTray();
    if (!globalShortcut.register(VIDEO_TOGGLE_SHORTCUT, () => setVideoVisible(!videoVisible))) {
      console.warn(`[codex-video-pet] shortcut unavailable: ${VIDEO_TOGGLE_SHORTCUT}`);
    }
  });

  ipcMain.handle("clips:get", () => loadManifest());

  ipcMain.handle("clips:add-files", async (event, state) => {
    const parent = BrowserWindow.fromWebContents(event.sender);
    const result = await dialog.showOpenDialog(parent || settingsWindow, {
      title: text("chooseVideo"),
      properties: ["openFile", "multiSelections"],
      filters: [{ name: text("video"), extensions: ["mp4", "webm", "mov"] }],
    });
    if (result.canceled) return loadManifest();
    return pushClipConfig(addClipFiles(PET_DIR, CLIP_CONFIG_FILE, state, result.filePaths));
  });

  ipcMain.handle("clips:update", (_event, state, patch) => {
    return pushClipConfig(updateClipState(PET_DIR, CLIP_CONFIG_FILE, state, patch || {}));
  });

  ipcMain.handle("clips:generate-mask", async (_event, state, index) => {
    const clip = clipFileAt(PET_DIR, CLIP_CONFIG_FILE, state, Number(index));
    if (!clip?.exists) throw new Error(text("clipNotFound"));
    const outputPath = await runMaskGenerator(clip.abs, maskOutputPath(clip.abs));
    return pushClipConfig(setClipMask(PET_DIR, CLIP_CONFIG_FILE, state, Number(index), outputPath));
  });

  ipcMain.handle("effects:update", (_event, patch) => {
    return pushEffectConfig(updateMaskEffects(PET_DIR, CLIP_CONFIG_FILE, patch || {}));
  });

  ipcMain.handle("settings:update-language", (_event, nextLanguage) => {
    language = normalizeLanguage(nextLanguage);
    saveSettings();
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("pet:language", language);
    if (settingsWindow && !settingsWindow.isDestroyed()) {
      settingsWindow.setTitle(text("settingsTitle"));
      settingsWindow.webContents.send("pet:language", language);
    }
    rebuildTray();
    return loadManifest();
  });

  ipcMain.handle("settings:update-scale", (_event, percent) => {
    setScale(Number(percent) / 100);
    return loadManifest();
  });

  ipcMain.handle("settings:update-mouse-passthrough", (_event, next) => {
    mousePassthrough = next !== false;
    if (!dragOffset) applyMousePassthrough();
    saveSettings();
    return loadManifest();
  });

  ipcMain.handle("clips:restore", (_event, state) => {
    return pushClipConfig(restoreClipState(PET_DIR, CLIP_CONFIG_FILE, state));
  });

  ipcMain.handle("hooks:status", () => getHookStatus());

  ipcMain.handle("hooks:install", (_event, agentId) => {
    const results = installHooks(agentId);
    return { ...getHookStatus(), results };
  });

  ipcMain.handle("hooks:uninstall", (_event, agentId) => {
    const results = uninstallHooks(agentId);
    return { ...getHookStatus(), results };
  });

  ipcMain.on("pet:open-thread", (_event, id) => {
    openThread(id);
  });

  ipcMain.on("pet:thread-menu", (event, id) => {
    const threadId = String(id || "");
    if (!threadId || !machine || !mainWindow || mainWindow.isDestroyed()) return;
    Menu.buildFromTemplate([
      {
        label: text("dismissSession"),
        click: () => {
          machine.dismissThread(threadId);
        },
      },
    ]).popup({ window: BrowserWindow.fromWebContents(event.sender) || mainWindow });
  });

  ipcMain.on("pet:video-menu", (event) => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    Menu.buildFromTemplate([
      { label: videoVisible ? text("hideVideo") : text("showVideo"), click: () => setVideoVisible(!videoVisible) },
    ]).popup({ window: BrowserWindow.fromWebContents(event.sender) || mainWindow });
  });

  ipcMain.on("pet:mark-read", (_event, id) => {
    if (machine) machine.markRead(id);
  });

  ipcMain.on("pet:panel-height", (_event, height) => {
    const next = Math.max(0, Math.round(Number(height) || 0));
    if (next === panelHeight) return;
    const previous = panelHeight;
    panelHeight = next;
    applyWindowSize(previous);
    syncPanelPlacement();
    if (!videoVisible && mainWindow && !mainWindow.isDestroyed()) {
      if (panelHeight > 0) mainWindow.show();
      else mainWindow.hide();
    }
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
    if (!mousePassthrough || dragOffset) return;
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
      syncPanelPlacement();
    }, 16);
  });

  ipcMain.on("pet:drag-end", () => {
    dragOffset = null;
    if (dragTimer) {
      clearInterval(dragTimer);
      dragTimer = null;
    }
    applyMousePassthrough();
    saveSettings();
  });

  app.on("window-all-closed", () => {
    // tray keeps the process alive on Windows
  });

  app.on("before-quit", () => {
    setManualQuit(true);
    if (dragTimer) clearInterval(dragTimer);
    saveSettings();
    if (sessionCatalog) sessionCatalog.stop();
    if (jsonlWatcher) jsonlWatcher.stop();
    if (httpServer) httpServer.close();
  });

  app.on("will-quit", () => {
    globalShortcut.unregister(VIDEO_TOGGLE_SHORTCUT);
  });
}

process.on("uncaughtException", (error) => {
  console.error(error);
});
