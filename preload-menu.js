const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("menuAPI", {
  onInit: (cb) => ipcRenderer.on("init-menu", (e, data) => cb(data)),
  setColor: (noteId, color) =>
    ipcRenderer.send("menu-set-color", { noteId, color }),
  setZOrder: (noteId, zOrder) =>
    ipcRenderer.send("menu-set-zorder", { noteId, zOrder }),
  openCustomColor: (noteId) =>
    ipcRenderer.send("menu-open-custom-color", { noteId }),
  close: (noteId) => ipcRenderer.send("menu-close", noteId),
});
