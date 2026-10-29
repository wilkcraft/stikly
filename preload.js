const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("notesAPI", {
  createNote: () => ipcRenderer.invoke("create-note"),
  deleteNote: (id) => ipcRenderer.invoke("delete-note", id),
  updateNote: (data) => {
    ipcRenderer.send("update-note", data);
  },
  saveNoteAs: () => ipcRenderer.invoke("save-note-as"),
  saveNote: () => ipcRenderer.invoke("save-note"),
  openNoteFile: () => ipcRenderer.invoke("open-note-file"),
  onInit: (callback) => {
    ipcRenderer.on("init-note", (event, data) => callback(data));
  },
  openColorPicker: (data) => ipcRenderer.send("open-color-picker", data),
  onApplyPickedColor: (cb) =>
    ipcRenderer.on("apply-picked-color", (e, data) => cb(data)),

  toggleMenu: (id) => ipcRenderer.send("menu-toggle", id),
  closeMenu: (id) => ipcRenderer.send("menu-close", id),
});
