const {
  app,
  BrowserWindow,
  ipcMain,
  Tray,
  Menu,
  nativeImage,
  nativeTheme,
  dialog,
  shell,
} = require("electron");
const { execFile } = require("child_process");
const path = require("path");
const fs = require("fs");

const notesDir = app.getPath("userData");
const notesFolder = path.join(notesDir, "notes");
const pointerFile = path.join(notesDir, "last-saved.json");
const settingsFile = path.join(notesDir, "settings.json");
const noteWindows = new Map();
let tray = null;
const windowsApiScript = app.isPackaged
  ? path.join(process.resourcesPath, "app.asar.unpacked", "windows-window.ps1")
  : path.join(__dirname, "windows-window.ps1");

function loadSettings() {
  try {
    return JSON.parse(fs.readFileSync(settingsFile, "utf-8"));
  } catch {
    return {};
  }
}

function saveSettings(patch) {
  const next = { ...loadSettings(), ...patch };
  fs.writeFileSync(settingsFile, JSON.stringify(next, null, 2), "utf-8");
  return next;
}

const normPath = (p) => path.resolve(p).toLowerCase();

function isInsideNotesFolder(filePath) {
  const rel = path.relative(notesFolder, path.resolve(filePath));
  return Boolean(rel) && !rel.startsWith("..") && !path.isAbsolute(rel);
}

function uniquePath(dir, baseName) {
  const ext = path.extname(baseName);
  const name = path.basename(baseName, ext);
  let candidate = path.join(dir, baseName);
  let i = 1;
  while (fs.existsSync(candidate)) {
    candidate = path.join(dir, `${name} (${i})${ext}`);
    i++;
  }
  return candidate;
}

function isNoteData(d) {
  return (
    d &&
    typeof d === "object" &&
    typeof d.width === "number" &&
    (typeof d.html === "string" || typeof d.text === "string")
  );
}

function readNoteFile(filePath) {
  try {
    const data = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    return isNoteData(data) ? data : null;
  } catch {
    return null;
  }
}

function suggestFileName(win) {
  const firstLine =
    (win.noteData?.text || "")
      .split("\n")
      .map((l) => l.trim())
      .find((l) => l.length > 0) || "";
  const clean = firstLine
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "")
    .replace(/[. ]+$/g, "")
    .slice(0, 40)
    .trim();
  return (clean || "Note") + ".json";
}

function migrateLegacyNotes() {
  let entries = [];
  try {
    entries = fs.readdirSync(notesDir, { withFileTypes: true });
  } catch {}
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".json"))
      continue;
    if (entry.name === "settings.json" || entry.name === "last-saved.json")
      continue;
    const src = path.join(notesDir, entry.name);
    if (!readNoteFile(src)) continue;
    try {
      fs.renameSync(src, uniquePath(notesFolder, entry.name));
    } catch (e) {
      console.error("No se pudo migrar", src, e);
    }
  }

  if (!loadSettings().pointerImported) {
    try {
      const pointer = JSON.parse(fs.readFileSync(pointerFile, "utf-8"));
      const src = pointer?.filePath;
      if (
        src &&
        fs.existsSync(src) &&
        !isInsideNotesFolder(src) &&
        readNoteFile(src)
      ) {
        fs.copyFileSync(src, uniquePath(notesFolder, path.basename(src)));
      }
    } catch {}
    saveSettings({ pointerImported: true });
  }
}

function listSavedNotes() {
  let files = [];
  try {
    files = fs
      .readdirSync(notesFolder)
      .filter((f) => f.toLowerCase().endsWith(".json"));
  } catch {}

  const openPaths = new Set(
    [...noteWindows.values()]
      .filter((w) => !w.isDestroyed() && w.noteData?.filePath)
      .map((w) => normPath(w.noteData.filePath)),
  );

  const colorRe = /^(#[0-9a-f]{3}|#[0-9a-f]{6}|rgba?\([\d\s,.%]+\))$/i;
  const list = [];
  for (const file of files) {
    const filePath = path.join(notesFolder, file);
    const data = readNoteFile(filePath);
    if (!data) continue;
    let modified = 0;
    try {
      modified = fs.statSync(filePath).mtimeMs;
    } catch {}
    list.push({
      filePath,
      name: path.basename(file, ".json"),
      text: String(data.text || "")
        .trim()
        .slice(0, 240),
      html: typeof data.html === "string" ? data.html.slice(0, 20000) : "",
      color: colorRe.test(data.color || "") ? data.color : "#fff59d",
      modified,
      isOpen: openPaths.has(normPath(filePath)),
    });
  }
  list.sort((a, b) => b.modified - a.modified);
  return list;
}

function openNoteFromFile(filePath) {
  const target = normPath(filePath);
  for (const win of noteWindows.values()) {
    if (
      !win.isDestroyed() &&
      win.noteData?.filePath &&
      normPath(win.noteData.filePath) === target
    ) {
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
      return true;
    }
  }
  const note = readNoteFile(filePath);
  if (!note) return false;
  if (!note.id || noteWindows.has(note.id)) {
    note.id = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  }
  createNoteWindow(note, filePath);
  return true;
}

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

function saveNoteToFile(win) {
  if (!win || win.isDestroyed() || !win.noteData?.filePath) return;
  const bounds = win.getBounds();
  const data = {
    id: win.noteId,
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    html: win.noteData.html || "",
    text: win.noteData.text || "",
    color: win.noteData.color || "#fff59d",
    zOrder: win.noteData.zOrder || "normal",
  };
  fs.mkdirSync(path.dirname(win.noteData.filePath), { recursive: true });
  fs.writeFileSync(
    win.noteData.filePath,
    JSON.stringify(data, null, 2),
    "utf-8",
  );
}

function autoSaveAllNotes() {
  for (const win of noteWindows.values()) {
    if (!win || win.isDestroyed()) continue;

    if (win.noteData?.filePath) {
      try {
        saveNoteToFile(win);
      } catch (e) {
        console.error("Auto-save failed:", e);
      }
      continue;
    }

    const hasText = (win.noteData?.text || "").trim().length > 0;
    if (!hasText) continue;

    try {
      win.noteData.filePath = uniquePath(notesFolder, suggestFileName(win));
      saveNoteToFile(win);
    } catch (e) {
      console.error("Auto-save failed:", e);
      win.noteData.filePath = null;
    }
  }
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

function createNoteWindow(note, filePath) {
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
    filePath: filePath || note.filePath || null,
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
      filePath: win.noteData.filePath,
    });
  });
  win.on("minimize", () => {
    if (win.noteData.zOrder === "desktop" && !win.isDestroyed()) {
      win.restore();
      win.blur();
    }
  });
  win.on("close", () => {
    if (win.noteData?.filePath) {
      saveNoteToFile(win);
    }
  });
  win.on("closed", () => {
    noteWindows.delete(note.id);
    for (const [key, pWin] of pickerWindows) {
      if (pWin.pickerData?.noteId === note.id && !pWin.isDestroyed()) {
        pWin.close();
      }
    }
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
    width: 320,
    height: 260,
    html: "",
    text: "",
    color: "#fff59d",
    zOrder: "normal",
  };
  createNoteWindow(note);
  return id;
}

function closeAllNotes() {
  autoSaveAllNotes();
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
    { label: "My notes", click: () => createLibraryWindow() },
    { type: "separator" },
    { label: "Close all notes", click: () => closeAllNotes() },
  ]);

  tray.setContextMenu(contextMenu);
}

app.whenReady().then(() => {
  applyThemePreference(loadSettings().theme);
  fs.mkdirSync(notesFolder, { recursive: true });
  migrateLegacyNotes();
  createTray();

  if (listSavedNotes().length === 0) {
    createNewNote();
  } else {
    createLibraryWindow();
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
  autoSaveAllNotes();
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
  if (html !== undefined) win.noteData.html = html;
  if (text !== undefined) win.noteData.text = text;
  if (color !== undefined) {
    win.noteData.color = color;
    broadcastNoteColorToPickers(id, color);
  }
  if (zOrder !== undefined) {
    win.noteData.zOrder = zOrder;
    applyZOrder(win, zOrder);
  }
});

ipcMain.on(
  "open-color-picker",
  (event, { noteId, origin, currentColor, noteColor }) => {
    const noteWin = noteWindows.get(noteId);
    if (!noteWin || noteWin.isDestroyed()) return;

    const key = `${noteId}::${origin}`;
    let win = pickerWindows.get(key);

    if (win && !win.isDestroyed() && win.isVisible()) {
      win.hide();
      return;
    }

    for (const [otherKey, other] of pickerWindows) {
      if (
        otherKey !== key &&
        other.pickerData?.noteId === noteId &&
        !other.isDestroyed()
      ) {
        other.hide();
      }
    }

    if (!win || win.isDestroyed()) {
      win = createPickerWindow(key, noteId, origin);
    }

    positionPickerWindow(win, noteWin, origin);
    win.webContents.send("init-picker", { origin, currentColor, noteColor });
    win.show();
    win.focus();
  },
);

ipcMain.on("close-color-picker", (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win && !win.isDestroyed()) win.hide();
});

ipcMain.on("picker-color-changed", (event, { color }) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win || win.isDestroyed() || !win.pickerData) return;
  const { noteId, origin } = win.pickerData;
  const noteWin = noteWindows.get(noteId);
  if (!noteWin || noteWin.isDestroyed()) return;
  noteWin.webContents.send("apply-picked-color", { color, origin });
});

ipcMain.handle("save-note-as", async (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) return null;
  const result = await dialog.showSaveDialog(win, {
    title: "Save note",
    defaultPath:
      win.noteData?.filePath || uniquePath(notesFolder, suggestFileName(win)),
    filters: [{ name: "Stikly Notes", extensions: ["json"] }],
  });
  if (result.canceled || !result.filePath) return null;
  win.noteData.filePath = result.filePath;
  saveNoteToFile(win);
  return result.filePath;
});

ipcMain.handle("save-note", (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win || !win.noteData?.filePath) return null;
  saveNoteToFile(win);
  return win.noteData.filePath;
});

ipcMain.handle("open-note-file", () => {
  createLibraryWindow();
  return true;
});

const pickerWindows = new Map();

function createPickerWindow(key, noteId, origin) {
  const win = new BrowserWindow({
    width: 190,
    height: 165,
    frame: false,
    transparent: true,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload-picker.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.pickerData = { noteId, origin };
  win.loadFile(path.join(__dirname, "src", "picker.html"));
  win.on("closed", () => {
    pickerWindows.delete(key);
  });
  pickerWindows.set(key, win);
  return win;
}

function positionPickerWindow(win, noteWin, origin) {
  const nb = noteWin.getBounds();
  const pb = win.getBounds();
  const gap = 8;
  const x = nb.x;
  const y = origin === "note" ? nb.y - pb.height - gap : nb.y + nb.height + gap;
  win.setBounds({ x, y, width: pb.width, height: pb.height });
}

function broadcastNoteColorToPickers(noteId, noteColor) {
  for (const win of pickerWindows.values()) {
    if (win.pickerData?.noteId === noteId && !win.isDestroyed()) {
      win.webContents.send("note-color-changed", { noteColor });
    }
  }
}

let libraryWindow = null;

function applyThemePreference(pref) {
  const theme = ["system", "light", "dark"].includes(pref) ? pref : "system";
  nativeTheme.themeSource = theme;
  return theme;
}

function createLibraryWindow() {
  if (libraryWindow && !libraryWindow.isDestroyed()) {
    if (libraryWindow.isMinimized()) libraryWindow.restore();
    libraryWindow.show();
    libraryWindow.focus();
    return libraryWindow;
  }
  libraryWindow = new BrowserWindow({
    width: 1000,
    height: 720,
    minWidth: 560,
    minHeight: 420,
    title: "Stikly – My notes",
    icon: path.join(__dirname, "build", "icon.png"),
    autoHideMenuBar: true,
    show: false,
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#24312c" : "#efe8d6",
    webPreferences: {
      preload: path.join(__dirname, "preload-library.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  libraryWindow.setMenu(null);
  libraryWindow.loadFile(path.join(__dirname, "src", "library.html"));
  libraryWindow.once("ready-to-show", () => libraryWindow.show());
  libraryWindow.on("closed", () => {
    libraryWindow = null;
  });
  return libraryWindow;
}

function closeLibraryWindow() {
  if (libraryWindow && !libraryWindow.isDestroyed()) libraryWindow.close();
}

ipcMain.handle("library:list", () => listSavedNotes());

ipcMain.handle("library:open", (event, filePath, keepOpen) => {
  if (typeof filePath !== "string" || !isInsideNotesFolder(filePath))
    return false;
  const ok = openNoteFromFile(filePath);
  if (ok && !keepOpen) closeLibraryWindow();
  return ok;
});

ipcMain.handle("library:new", () => {
  createNewNote();
  closeLibraryWindow();
  return true;
});

ipcMain.handle("library:delete", async (event, filePath) => {
  if (typeof filePath !== "string" || !isInsideNotesFolder(filePath))
    return false;
  const target = normPath(filePath);
  for (const win of noteWindows.values()) {
    if (
      !win.isDestroyed() &&
      win.noteData?.filePath &&
      normPath(win.noteData.filePath) === target
    ) {
      win.noteData.filePath = null;
      win.close();
    }
  }
  try {
    await shell.trashItem(filePath);
    return true;
  } catch (e) {
    console.error("Error al borrar nota:", e);
    return false;
  }
});

ipcMain.handle("library:import", async (event) => {
  const parent = BrowserWindow.fromWebContents(event.sender);
  const result = await dialog.showOpenDialog(parent, {
    title: "Import notes",
    filters: [{ name: "Stikly Notes", extensions: ["json"] }],
    properties: ["openFile", "multiSelections"],
  });
  if (result.canceled) return 0;
  let count = 0;
  for (const src of result.filePaths) {
    if (!readNoteFile(src)) continue;
    try {
      if (!isInsideNotesFolder(src)) {
        fs.copyFileSync(src, uniquePath(notesFolder, path.basename(src)));
      }
      count++;
    } catch (e) {
      console.error("Error importando", src, e);
    }
  }
  return count;
});

ipcMain.handle("library:open-folder", () => shell.openPath(notesFolder));

ipcMain.handle("library:get-theme", () => loadSettings().theme || "system");

ipcMain.handle("library:set-theme", (event, pref) => {
  const theme = applyThemePreference(pref);
  saveSettings({ theme });
  return theme;
});
