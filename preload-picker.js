const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("pickerAPI", {
  onInit: (cb) => ipcRenderer.on("init-picker", (e, data) => cb(data)),
  sendColor: (color) => ipcRenderer.send("picker-color-changed", { color }),
  close: () => ipcRenderer.send("close-color-picker"),
  onNoteColorChanged: (cb) =>
    ipcRenderer.on("note-color-changed", (e, data) => cb(data)),
});
