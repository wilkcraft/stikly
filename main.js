const {
  app,
  BrowserWindow,
  ipcMain,
  Tray,
  Menu,
  nativeImage,
} = require("electron");
const { execFile } = require("child_process");
const path = require("path");
const fs = require("fs");

const dataFile = path.join(app.getPath("userData"), "notes.json");
const noteWindows = new Map();
let tray = null;
const windowsApiScript = app.isPackaged
  ? path.join(process.resourcesPath, "app.asar.unpacked", "windows-window.ps1")
  : path.join(__dirname, "windows-window.ps1");

function getWindowHandle(win) {
  const buffer = win.getNativeWindowHandle();
  if (process.arch === "x64" || process.arch === "arm64") {
    return buffer.readBigUInt64LE(0).toString();
  }
  return buffer.readUInt32LE(0).toString();
}

function applyWindowsModeAsync(win, mode) {
  return new Promise((resolve, reject) => {
    if (process.platform !== "win32") return resolve();
    if (win.isDestroyed()) return resolve();

    const hwnd = getWindowHandle(win);
    const proc = execFile(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        windowsApiScript,
        "-Hwnd",
        hwnd,
        "-Mode",
        mode,
      ],
      (error, stdout, stderr) => {
        if (stdout && stdout.trim()) console.log("[WindowApi]", stdout.trim());
        if (error) {
          console.error("Windows API error:", error.message);
          if (stderr && stderr.trim()) console.error(stderr.trim());
          reject(error);
        } else {
          resolve();
        }
      },
    );

    setTimeout(() => {
      proc.kill();
      reject(new Error("PowerShell script timeout"));
    }, 5000);
  });
}

function loadNotes() {
  try {
    const raw = fs.readFileSync(dataFile, "utf-8");
    return JSON.parse(raw);
  } catch (e) {
    return [];
  }
}

function saveNotes(notes) {
  fs.writeFileSync(dataFile, JSON.stringify(notes, null, 2), "utf-8");
}

function getAllNotesData() {
  const notes = [];
  for (const [id, win] of noteWindows) {
    if (win.isDestroyed()) continue;
    const bounds = win.getBounds();
    const data = win.noteData || {};
    notes.push({
      id,
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
      html: data.html || "",
      text: data.text || "",
      color: data.color || "#fff59d",
      zOrder: data.zOrder || "normal",
    });
  }
  return notes;
}

function persist() {
  saveNotes(getAllNotesData());
}

function applyZOrder(win, zOrder) {
  if (win.isDestroyed()) return;

  switch (zOrder) {
    case "desktop":
      win.setAlwaysOnTop(false);
      win.setSkipTaskbar(true);
      if (win.isVisible()) {
        applyWindowsModeAsync(win, "desktop")
          .catch((err) => console.error("Error en desktop:", err))
          .finally(() => {
            if (!win.isDestroyed()) {
              win.blur();
            }
          });
      } else {
        applyWindowsModeAsync(win, "desktop").catch(console.error);
      }
      break;

    case "top":
      win.setSkipTaskbar(false);
      win.setAlwaysOnTop(true, "floating");
      if (win.isVisible()) {
        applyWindowsModeAsync(win, "top")
          .catch(console.error)
          .finally(() => {
            if (!win.isDestroyed()) {
              win.hide();
              win.show();
              win.focus();
            }
          });
      } else {
        applyWindowsModeAsync(win, "top").catch(console.error);
      }
      break;

    case "normal":
    default:
      win.setSkipTaskbar(false);
      win.setAlwaysOnTop(false);
      if (win.isVisible()) {
        applyWindowsModeAsync(win, "normal")
          .catch(console.error)
          .finally(() => {
            if (!win.isDestroyed()) {
              win.hide();
              win.show();
              win.focus();
            }
          });
      } else {
        applyWindowsModeAsync(win, "normal").catch(console.error);
      }
      break;
  }
}

function createNoteWindow(note) {
  const win = new BrowserWindow({
    x: note.x,
    y: note.y,
    width: note.width || 260,
    height: note.height || 260,
    minWidth: 180,
    minHeight: 150,
    frame: false,
    transparent: true,
    alwaysOnTop: false,
    resizable: true,
    skipTaskbar: false,
    show: false,
    icon: path.join(__dirname, "build", "icon.png"),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.noteData = {
    html: note.html || "",
    text: note.text || "",
    color: note.color || "#fff59d",
    zOrder: note.zOrder || "normal",
  };

  win.on("hide", () => {
    if (win.noteData?.zOrder === "desktop" && !win.isDestroyed()) {
      win.show();
      win.blur();
    }
  });

  win.noteId = note.id;
  win.loadFile(path.join(__dirname, "src", "note.html"));

  win.once("ready-to-show", () => {
    if (win.noteData.zOrder === "desktop") {
      win.showInactive();
      applyZOrder(win, "desktop");
    } else if (win.noteData.zOrder === "top") {
      win.show();
      applyZOrder(win, "top");
    } else {
      win.show();
    }
  });

  win.webContents.on("did-finish-load", () => {
    win.webContents.send("init-note", {
      id: note.id,
      html: win.noteData.html,
      text: win.noteData.text,
      color: win.noteData.color,
      zOrder: win.noteData.zOrder,
    });
  });

  let saveTimeout;
  const scheduleSave = () => {
    clearTimeout(saveTimeout);
    saveTimeout = setTimeout(() => {
      persist();
    }, 400);
  };

  win.on("move", scheduleSave);
  win.on("resize", scheduleSave);

  win.on("minimize", () => {
    if (win.noteData.zOrder === "desktop" && !win.isDestroyed()) {
      win.restore();
      win.blur();
    }
  });

  win.on("closed", () => {
    noteWindows.delete(note.id);
    persist();
  });

  noteWindows.set(note.id, win);
  return win;
}

function createNewNote() {
  const id = Date.now().toString();
  const offset = (noteWindows.size % 8) * 25;
  const note = {
    id,
    x: 80 + offset,
    y: 80 + offset,
    width: 260,
    height: 260,
    html: "",
    text: "",
    color: "#fff59d",
    zOrder: "normal",
  };
  createNoteWindow(note);
  persist();
  return id;
}

function closeAllNotes() {
  for (const win of noteWindows.values()) {
    if (!win.isDestroyed()) {
      win.close();
    }
  }
  app.quit();
}

function createTray() {
  const iconPath = path.join(__dirname, "build", "icon.ico");
  let trayImage = nativeImage.createFromPath(iconPath);
  if (trayImage.isEmpty()) {
    trayImage = nativeImage.createFromPath(
      path.join(__dirname, "build", "icon.png"),
    );
  }

  tray = new Tray(trayImage);
  tray.setToolTip("Stikly");

  const contextMenu = Menu.buildFromTemplate([
    { label: "New note", click: () => createNewNote() },
    { type: "separator" },
    { label: "Close all notes", click: () => closeAllNotes() },
  ]);

  tray.setContextMenu(contextMenu);
}

app.whenReady().then(() => {
  createTray();
  const savedNotes = loadNotes();
  if (savedNotes.length === 0) {
    createNewNote();
  } else {
    savedNotes.forEach(createNoteWindow);
  }

  setInterval(() => {
    for (const win of noteWindows.values()) {
      if (win.isDestroyed()) continue;
      if (win.noteData?.zOrder === "desktop") {
        if (!win.isVisible() || win.isMinimized()) {
          win.restore();
          win.blur();
        }
      }
    }
  }, 150);
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  if (tray) {
    tray.destroy();
    tray = null;
  }
});

ipcMain.handle("create-note", () => {
  return createNewNote();
});

ipcMain.handle("delete-note", (event, id) => {
  const win = noteWindows.get(id);
  if (win && !win.isDestroyed()) {
    win.close();
  }
});

ipcMain.on("update-note", (event, data) => {
  const { id, html, text, color, zOrder } = data;
  const win = noteWindows.get(id);
  if (!win || win.isDestroyed()) return;

  if (html !== undefined) {
    win.noteData.html = html;
  }
  if (text !== undefined) {
    win.noteData.text = text;
  }
  if (color !== undefined) {
    win.noteData.color = color;
  }
  if (zOrder !== undefined) {
    win.noteData.zOrder = zOrder;
    applyZOrder(win, zOrder);
  }
  persist();
});
