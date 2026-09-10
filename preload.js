const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("petBridge", {
  onInit: (handler) => {
    ipcRenderer.on("pet:init", (_event, data) => handler(data));
  },
  onState: (handler) => {
    ipcRenderer.on("pet:state", (_event, data) => handler(data));
  },
  onEffects: (handler) => {
    ipcRenderer.on("pet:effects", (_event, effects) => handler(effects));
  },
  onLanguage: (handler) => {
    ipcRenderer.on("pet:language", (_event, language) => handler(language));
  },
  onPanelPlacement: (handler) => {
    ipcRenderer.on("pet:panel-placement", (_event, placement) => handler(placement));
  },
  onVideoVisibility: (handler) => {
    ipcRenderer.on("pet:video-visibility", (_event, visibility) => handler(visibility));
  },
  onScale: (handler) => {
    ipcRenderer.on("pet:scale", (_event, scale) => handler(scale));
  },
  clipEnded: (state) => ipcRenderer.send("pet:clip-ended", state),
  setIgnoreMouse: (ignore) => ipcRenderer.send("pet:ignore-mouse", ignore),
  scaleBy: (delta) => ipcRenderer.send("pet:scale-by", delta),
  dragStart: (cursor) => ipcRenderer.send("pet:drag-start", cursor),
  dragEnd: () => ipcRenderer.send("pet:drag-end"),
  pinThread: (id) => ipcRenderer.send("pet:pin-thread", id),
  markRead: (id) => ipcRenderer.send("pet:mark-read", id),
  openThread: (id) => ipcRenderer.send("pet:open-thread", id),
  dismissThread: (id) => ipcRenderer.send("pet:dismiss-thread", id),
  threadContextMenu: (id) => ipcRenderer.send("pet:thread-menu", id),
  videoContextMenu: () => ipcRenderer.send("pet:video-menu"),
  setPanelHeight: (height) => ipcRenderer.send("pet:panel-height", height),
  getClipConfig: () => ipcRenderer.invoke("clips:get"),
  addClipFiles: (state) => ipcRenderer.invoke("clips:add-files", state),
  updateClipState: (state, patch) => ipcRenderer.invoke("clips:update", state, patch),
  generateClipMask: (state, index) => ipcRenderer.invoke("clips:generate-mask", state, index),
  updateMaskEffects: (patch) => ipcRenderer.invoke("effects:update", patch),
  updateLanguage: (language) => ipcRenderer.invoke("settings:update-language", language),
  updateScale: (percent) => ipcRenderer.invoke("settings:update-scale", percent),
  updateMousePassthrough: (enabled) => ipcRenderer.invoke("settings:update-mouse-passthrough", enabled),
  updateExcludedApps: (apps) => ipcRenderer.invoke("settings:update-excluded-apps", apps),
  listApps: () => ipcRenderer.invoke("settings:list-apps"),
  restoreClipState: (state) => ipcRenderer.invoke("clips:restore", state),
  getHookStatus: () => ipcRenderer.invoke("hooks:status"),
  installHooks: (agentId) => ipcRenderer.invoke("hooks:install", agentId),
  uninstallHooks: (agentId) => ipcRenderer.invoke("hooks:uninstall", agentId),
  onClipConfig: (handler) => {
    ipcRenderer.on("clips:updated", (_event, data) => handler(data));
  },
  onForegroundApp: (handler) => {
    ipcRenderer.on("settings:foreground-app", (_event, appName) => handler(appName));
  },
});
