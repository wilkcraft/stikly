const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("notesAPI", {
  createNote: () => ipcRenderer.invoke("create-note"),

  deleteNote: (id) => ipcRenderer.invoke("delete-note", id),

  updateNote: (data) => {
    ipcRenderer.send("update-note", data);
  },

  onInit: (callback) => {
    ipcRenderer.on("init-note", (event, data) => {
      callback(data);
    });
  },
});
