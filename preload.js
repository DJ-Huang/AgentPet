const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("petBridge", {
  onInit: (handler) => {
    ipcRenderer.on("pet:init", (_event, data) => handler(data));
  },
  onState: (handler) => {
    ipcRenderer.on("pet:state", (_event, data) => handler(data));
  },
  clipEnded: (state) => ipcRenderer.send("pet:clip-ended", state),
  setIgnoreMouse: (ignore) => ipcRenderer.send("pet:ignore-mouse", ignore),
  scaleBy: (delta) => ipcRenderer.send("pet:scale-by", delta),
  dragStart: (cursor) => ipcRenderer.send("pet:drag-start", cursor),
  dragEnd: () => ipcRenderer.send("pet:drag-end"),
  pinThread: (id) => ipcRenderer.send("pet:pin-thread", id),
  markRead: (id) => ipcRenderer.send("pet:mark-read", id),
  openThread: (id) => ipcRenderer.send("pet:open-thread", id),
  setPanelHeight: (height) => ipcRenderer.send("pet:panel-height", height),
  getClipConfig: () => ipcRenderer.invoke("clips:get"),
  addClipFiles: (state) => ipcRenderer.invoke("clips:add-files", state),
  updateClipState: (state, patch) => ipcRenderer.invoke("clips:update", state, patch),
  generateClipMask: (state, index) => ipcRenderer.invoke("clips:generate-mask", state, index),
  restoreClipState: (state) => ipcRenderer.invoke("clips:restore", state),
  onClipConfig: (handler) => {
    ipcRenderer.on("clips:updated", (_event, data) => handler(data));
  },
});
