const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("libraryAPI", {
  list: () => ipcRenderer.invoke("library:list"),
  open: (filePath, keepOpen) =>
    ipcRenderer.invoke("library:open", filePath, keepOpen),
  remove: (filePath) => ipcRenderer.invoke("library:delete", filePath),
  importNotes: () => ipcRenderer.invoke("library:import"),
  newNote: () => ipcRenderer.invoke("library:new"),
  openFolder: () => ipcRenderer.invoke("library:open-folder"),
  getTheme: () => ipcRenderer.invoke("library:get-theme"),
  setTheme: (theme) => ipcRenderer.invoke("library:set-theme", theme),
  getUpdate: () => ipcRenderer.invoke("update:get"),
  onUpdate: (cb) => ipcRenderer.on("update-available", (e, d) => cb(d)),
  openDownload: () => ipcRenderer.invoke("update:download"),
  openLink: (url) => ipcRenderer.invoke("update:open-link", url),
  getUpdateChecks: () => ipcRenderer.invoke("update:get-enabled"),
  setUpdateChecks: (on) => ipcRenderer.invoke("update:set-enabled", on),
  setMeta: (filePath, patch) =>
    ipcRenderer.invoke("library:set-meta", filePath, patch),
  getSettings: () => ipcRenderer.invoke("settings:get"),
  setSettings: (patch) => ipcRenderer.invoke("settings:set", patch),
  downloadAsset: (kind) => ipcRenderer.invoke("update:download-asset", kind),
  cancelDownload: () => ipcRenderer.invoke("update:cancel"),
  installUpdate: (kind) => ipcRenderer.invoke("update:install", kind),
  revealDownload: (kind) => ipcRenderer.invoke("update:reveal", kind),
  onUpdateProgress: (cb) => ipcRenderer.on("update-progress", (e, d) => cb(d)),
});
