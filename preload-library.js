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
});
