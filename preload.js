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
});
