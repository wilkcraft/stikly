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
  screen,
  globalShortcut,
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

function writeFileAtomic(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + ".tmp";
  fs.writeFileSync(tmp, content, "utf-8");
  try {
    fs.renameSync(tmp, file);
  } catch {
    fs.copyFileSync(tmp, file);
    fs.rmSync(tmp, { force: true });
  }
}

function saveSettings(patch) {
  const next = { ...loadSettings(), ...patch };
  writeFileAtomic(settingsFile, JSON.stringify(next, null, 2));
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
      console.error("Could not migrate", src, e);
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
      body: String(data.text || "").slice(0, 100000),
      html: typeof data.html === "string" ? data.html.slice(0, 20000) : "",
      color: colorRe.test(data.color || "") ? data.color : "#fff59d",
      modified,
      isOpen: openPaths.has(normPath(filePath)),
      pinned: !!data.pinned,
      autoStart: !!data.autoStart,
      tags: Array.isArray(data.tags)
        ? data.tags.filter((t) => typeof t === "string").slice(0, 10)
        : [],
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
  const b = win.getBounds();
  const d = win.noteData;
  const data = {
    id: win.noteId,
    x: b.x,
    y: b.y,
    width: b.width,
    height: b.height,
    html: d.html || "",
    text: d.text || "",
    color: d.color || "#fff59d",
    zOrder: d.zOrder || "normal",
    topCollapsed: !!d.topCollapsed,
    bottomCollapsed: !!d.bottomCollapsed,
    pinned: !!d.pinned,
    autoStart: !!d.autoStart,
    tags: Array.isArray(d.tags) ? d.tags : [],
  };
  writeFileAtomic(d.filePath, JSON.stringify(data, null, 2));
}

function renameIfTitleChanged(win) {
  const d = win.noteData;
  const stripN = (s) => s.replace(/ \(\d+\)$/, "").toLowerCase();
  const wanted = suggestFileName(win);
  if (
    stripN(path.basename(wanted, ".json")) ===
    stripN(path.basename(d.filePath, ".json"))
  )
    return;
  const target = uniquePath(path.dirname(d.filePath), wanted);
  try {
    if (fs.existsSync(d.filePath)) fs.renameSync(d.filePath, target);
    d.filePath = target;
  } catch (e) {
    console.error("Rename failed:", e);
  }
}

function autoSaveWindow(win) {
  if (!win || win.isDestroyed() || win.noteData?.discarded) return;
  const d = win.noteData;
  try {
    if (!d.filePath) {
      if (!(d.text || "").trim()) return;
      d.filePath = uniquePath(notesFolder, suggestFileName(win));
      d.autoNamed = true;
    } else if (d.autoNamed) {
      renameIfTitleChanged(win);
    }
    saveNoteToFile(win);
  } catch (e) {
    console.error("Auto-save failed:", e);
  }
}

function autoSaveAllNotes() {
  for (const win of noteWindows.values()) autoSaveWindow(win);
}

const AUTOSAVE_MS = 2000;
const autosaveTimers = new Map();

function scheduleAutoSave(win) {
  if (!win || win.isDestroyed()) return;
  clearTimeout(autosaveTimers.get(win));
  autosaveTimers.set(
    win,
    setTimeout(() => {
      autosaveTimers.delete(win);
      autoSaveWindow(win);
      persistOpenList();
    }, AUTOSAVE_MS),
  );
}

function applyZOrder(win, zOrder) {
  if (win.isDestroyed()) return;

  switch (zOrder) {
    case "desktop":
      win.setAlwaysOnTop(false);
      win.setSkipTaskbar(true);
      if (win.isVisible()) {
        applyWindowsModeAsync(win, "desktop")
          .catch((err) => console.error("Desktop mode error:", err))
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

function isVisibleOnSomeDisplay(b) {
  const MIN = 50;
  return screen.getAllDisplays().some((d) => {
    const wa = d.workArea;
    const ix = Math.min(b.x + b.width, wa.x + wa.width) - Math.max(b.x, wa.x);
    const iy = Math.min(b.y + b.height, wa.y + wa.height) - Math.max(b.y, wa.y);
    return ix >= MIN && iy >= MIN;
  });
}

let rescueTimer = null;
function scheduleRescue() {
  clearTimeout(rescueTimer);
  rescueTimer = setTimeout(rescueOffscreenNotes, 600);
}

let rescuing = false;
async function rescueOffscreenNotes() {
  if (rescuing) return;
  rescuing = true;
  try {
    const wa = screen.getPrimaryDisplay().workArea;
    let n = 0;
    for (const win of noteWindows.values()) {
      if (win.isDestroyed()) continue;
      const b = win.getBounds();
      if (isVisibleOnSomeDisplay(b)) continue;

      const width = Math.min(b.width, wa.width);
      const height = Math.min(b.height, wa.height);
      const step = (n++ % 10) * 25;
      const x = Math.min(wa.x + 40 + step, wa.x + wa.width - width);
      const y = Math.min(wa.y + 40 + step, wa.y + wa.height - height);

      const isDesktop = win.noteData?.zOrder === "desktop";
      if (isDesktop) await applyWindowsModeAsync(win, "normal").catch(() => {});
      if (win.isDestroyed()) continue;
      win.setBounds({ x, y, width, height });
      if (isDesktop) applyZOrder(win, "desktop");
    }
  } finally {
    rescuing = false;
  }
}

function createNoteWindow(note, filePath) {
  const probe = {
    x: note.x,
    y: note.y,
    width: note.width || 260,
    height: note.height || 260,
  };
  if (
    typeof note.x === "number" &&
    typeof note.y === "number" &&
    !isVisibleOnSomeDisplay(probe)
  ) {
    const wa = screen.getPrimaryDisplay().workArea;
    note.x = wa.x + 40;
    note.y = wa.y + 40;
  }

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
    topCollapsed: !!note.topCollapsed,
    bottomCollapsed: !!note.bottomCollapsed,
    filePath: filePath || note.filePath || null,
    pinned: !!note.pinned,
    autoStart: !!note.autoStart,
    tags: Array.isArray(note.tags) ? note.tags : [],
    autoNamed: false,
    discarded: false,
  };

  win.on("hide", () => {
    if (win.noteData?.zOrder === "desktop" && !win.isDestroyed()) {
      win.show();
      win.blur();
    }
  });

  win.noteId = note.id;
  win.on("focus", () => closeMenuFor(note.id));
  const followPickers = () => repositionPickersFor(note.id);
  win.on("move", followPickers);
  win.on("resize", followPickers);
  win.on("moved", () => scheduleAutoSave(win));
  win.on("resized", () => scheduleAutoSave(win));
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
      topCollapsed: win.noteData.topCollapsed,
      bottomCollapsed: win.noteData.bottomCollapsed,
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
    clearTimeout(autosaveTimers.get(win));
    autosaveTimers.delete(win);
    autoSaveWindow(win);
  });
  win.on("closed", () => {
    noteWindows.delete(note.id);
    persistOpenList();
    for (const [key, pWin] of pickerWindows) {
      if (pWin.pickerData?.noteId === note.id && !pWin.isDestroyed()) {
        pWin.close();
      }
    }
    const mWin = menuWindows.get(note.id);
    if (mWin && !mWin.isDestroyed()) mWin.close();
  });
  win.on("session-end", () => {
    autoSaveAllNotes();
    persistOpenList();
    quitting = true;
  });
  noteWindows.set(note.id, win);
  return win;
}

function focusWindowReliably(win) {
  if (!win || win.isDestroyed()) return;
  win.setAlwaysOnTop(true);
  win.show();
  win.focus();
  win.webContents.focus();
  if (win.noteData?.zOrder !== "top") {
    setTimeout(() => {
      if (!win.isDestroyed()) win.setAlwaysOnTop(false);
    }, 100);
  }
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
  const win = createNoteWindow(note);
  win.once("show", () => focusWindowReliably(win));
  return id;
}

function closeNotesOnly() {
  autoSaveAllNotes();
  createLibraryWindow();
  for (const win of [...noteWindows.values()]) {
    if (!win.isDestroyed()) win.close();
  }
}

function closeEverything() {
  autoSaveAllNotes();
  persistOpenList();
  quitting = true;
  for (const win of [...noteWindows.values()]) {
    if (!win.isDestroyed()) win.close();
  }
  closeLibraryWindow();
  app.quit();
}

let quitting = false;

function persistOpenList() {
  if (quitting) return;
  const open = [...noteWindows.values()]
    .filter((w) => !w.isDestroyed() && w.noteData?.filePath)
    .map((w) => w.noteData.filePath);
  saveSettings({ lastOpen: open });
}

function openStartupNotes() {
  const s = loadSettings();
  const mode = ["restore", "selected"].includes(s.startupMode)
    ? s.startupMode
    : "panel";
  let paths = [];
  if (mode === "restore") paths = Array.isArray(s.lastOpen) ? s.lastOpen : [];
  if (mode === "selected")
    paths = listSavedNotes()
      .filter((n) => n.autoStart)
      .map((n) => n.filePath);

  let opened = 0;
  for (const p of paths) {
    if (typeof p === "string" && fs.existsSync(p) && openNoteFromFile(p))
      opened++;
  }
  if (opened === 0) createLibraryWindow();
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
    { label: "Close all notes", click: () => closeNotesOnly() },
    { label: "Close all", click: () => closeEverything() },
  ]);

  tray.setContextMenu(contextMenu);
}

const { net, Notification } = require("electron");

app.setAppUserModelId("com.wilkcraft.stikly");

const REPO = "wilkcraft/stikly";
const DOWNLOAD_URL = "https://stikly.wilkcraft.work/#download";
let updateInfo = null;
let updateTimer = null;

function parseVersion(v) {
  return String(v)
    .trim()
    .replace(/^v/i, "")
    .split("-")[0]
    .split(".")
    .map((n) => parseInt(n, 10) || 0);
}

function isNewer(remote, local) {
  const a = parseVersion(remote),
    b = parseVersion(local);
  for (let i = 0; i < 3; i++) {
    if ((a[i] || 0) > (b[i] || 0)) return true;
    if ((a[i] || 0) < (b[i] || 0)) return false;
  }
  return false;
}

function pushUpdateToLibrary() {
  if (libraryWindow && !libraryWindow.isDestroyed()) {
    libraryWindow.webContents.send("update-available", updateInfo);
  }
}

async function checkForUpdates() {
  try {
    const res = await net.fetch(
      `https://api.github.com/repos/${REPO}/releases/latest`,
      {
        headers: {
          Accept: "application/vnd.github+json",
          "User-Agent": "Stikly",
        },
      },
    );
    if (!res.ok) return;
    const rel = await res.json();
    if (!rel.tag_name || rel.draft || rel.prerelease) return;

    if (!isNewer(rel.tag_name, app.getVersion())) {
      updateInfo = null;
      pushUpdateToLibrary();
      return;
    }

    const version = String(rel.tag_name).replace(/^v/i, "");
    updateInfo = {
      version,
      name: rel.name || `Stikly ${version}`,
      body: rel.body || "",
      published: rel.published_at || null,
    };
    pushUpdateToLibrary();

    if (
      loadSettings().lastNotifiedVersion !== version &&
      Notification.isSupported()
    ) {
      const n = new Notification({
        title: "Stikly update available",
        body: `Version ${version} is out. Click to see what's new.`,
      });
      n.on("click", () => createLibraryWindow());
      n.show();
      saveSettings({ lastNotifiedVersion: version });
    }
  } catch (e) {
    console.error("Update check failed:", e.message);
  }
}

function startUpdateChecks() {
  clearInterval(updateTimer);
  checkForUpdates();
  updateTimer = setInterval(checkForUpdates, 12 * 60 * 60 * 1000);
}

function stopUpdateChecks() {
  clearInterval(updateTimer);
  updateTimer = null;
  updateInfo = null;
  pushUpdateToLibrary();
}

async function initUpdates(parent) {
  let s = loadSettings();
  if (typeof s.updateChecks !== "boolean") {
    const opts = {
      type: "question",
      title: "Stikly",
      message: "Get notified about new versions?",
      detail:
        "Stikly can check GitHub from time to time to see if a new version is available. " +
        "Nothing is installed automatically and no personal data is sent. " +
        "You can change this later in My notes.",
      buttons: ["Yes, notify me", "No, thanks"],
      defaultId: 0,
      cancelId: 1,
    };
    const { response } =
      parent && !parent.isDestroyed()
        ? await dialog.showMessageBox(parent, opts)
        : await dialog.showMessageBox(opts);
    saveSettings({ updateChecks: response === 0 });
    s = loadSettings();
  }
  if (s.updateChecks) startUpdateChecks();
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();
else app.on("second-instance", () => createLibraryWindow());

app.whenReady().then(() => {
  if (!gotLock) return;
  applyThemePreference(loadSettings().theme);
  fs.mkdirSync(notesFolder, { recursive: true });
  migrateLegacyNotes();
  createTray();

  registerShortcut();
  openStartupNotes();

  screen.on("display-removed", scheduleRescue);
  screen.on("display-metrics-changed", scheduleRescue);

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

app.on("will-quit", () => globalShortcut.unregisterAll());

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  autoSaveAllNotes();
  persistOpenList();
  quitting = true;
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
  const { id, html, text, color, zOrder, topCollapsed, bottomCollapsed } = data;
  const win = noteWindows.get(id);
  if (!win || win.isDestroyed()) return;
  if (html !== undefined) win.noteData.html = html;
  if (text !== undefined) win.noteData.text = text;
  if (topCollapsed !== undefined) win.noteData.topCollapsed = topCollapsed;
  if (bottomCollapsed !== undefined)
    win.noteData.bottomCollapsed = bottomCollapsed;
  if (color !== undefined) {
    win.noteData.color = color;
    broadcastNoteColorToPickers(id, color);
  }
  if (zOrder !== undefined) {
    win.noteData.zOrder = zOrder;
    applyZOrder(win, zOrder);
  }
  scheduleAutoSave(win);
});

function openColorPicker(noteId, origin, currentColor, noteColor) {
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

  win.pickerData.moved = false;
  positionPickerWindow(win, noteWin, origin);
  win.webContents.send("init-picker", { origin, currentColor, noteColor });
  win.show();
  win.focus();
}

ipcMain.on("open-color-picker", (event, args) => {
  openColorPicker(args.noteId, args.origin, args.currentColor, args.noteColor);
});

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
  const old = win.noteData.filePath;
  win.noteData.filePath = result.filePath;
  if (
    win.noteData.autoNamed &&
    old &&
    normPath(old) !== normPath(result.filePath)
  ) {
    fs.rm(old, { force: true }, () => {});
  }
  win.noteData.autoNamed = false;
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
  win.pickerData = { noteId, origin, moved: false };
  win.pickerExpectedPos = null;
  win.on("move", () => {
    if (win.isDestroyed() || !win.pickerExpectedPos) return;
    const b = win.getBounds();
    const dx = Math.abs(b.x - win.pickerExpectedPos.x);
    const dy = Math.abs(b.y - win.pickerExpectedPos.y);
    if (dx > 3 || dy > 3) win.pickerData.moved = true;
  });
  win.loadFile(path.join(__dirname, "src", "picker.html"));
  win.on("closed", () => {
    pickerWindows.delete(key);
  });
  pickerWindows.set(key, win);
  return win;
}

function computePickerBounds(noteWin, pickerWin, origin) {
  const nb = noteWin.getBounds();
  const { width: pw, height: ph } = pickerWin.getBounds();
  const wa = screen.getDisplayMatching(nb).workArea;
  const gap = 8;

  const clamp = (v, min, max) => Math.max(min, Math.min(v, Math.max(min, max)));
  const clampX = (x) => clamp(x, wa.x, wa.x + wa.width - pw);
  const clampY = (y) => clamp(y, wa.y, wa.y + wa.height - ph);

  const above = origin === "note";
  const primaryY = above ? nb.y - ph - gap : nb.y + nb.height + gap;
  const fitsVertically = primaryY >= wa.y && primaryY + ph <= wa.y + wa.height;
  if (fitsVertically) {
    return { x: clampX(nb.x), y: primaryY, width: pw, height: ph };
  }

  const sideY = clampY(above ? nb.y : nb.y + nb.height - ph);

  const leftX = nb.x - pw - gap;
  if (leftX >= wa.x) {
    return { x: leftX, y: sideY, width: pw, height: ph };
  }

  const rightX = nb.x + nb.width + gap;
  return { x: clampX(rightX), y: sideY, width: pw, height: ph };
}

function positionPickerWindow(win, noteWin, origin) {
  if (win.isDestroyed() || noteWin.isDestroyed()) return;
  const b = computePickerBounds(noteWin, win, origin);
  win.pickerExpectedPos = { x: b.x, y: b.y };
  win.setBounds(b);
}

function repositionPickersFor(noteId) {
  const noteWin = noteWindows.get(noteId);
  if (!noteWin || noteWin.isDestroyed()) return;
  for (const pWin of pickerWindows.values()) {
    if (
      !pWin.isDestroyed() &&
      pWin.isVisible() &&
      pWin.pickerData?.noteId === noteId &&
      !pWin.pickerData.moved
    ) {
      positionPickerWindow(pWin, noteWin, pWin.pickerData.origin);
    }
  }
}

function broadcastNoteColorToPickers(noteId, noteColor) {
  for (const win of pickerWindows.values()) {
    if (win.pickerData?.noteId === noteId && !win.isDestroyed()) {
      win.webContents.send("note-color-changed", { noteColor });
    }
  }
}

const MENU_W = 190;
const MENU_H = 212;
const MENU_PAD = 8;
const menuWindows = new Map();

function createMenuWindow(noteId) {
  const win = new BrowserWindow({
    width: MENU_W + MENU_PAD * 2,
    height: MENU_H + MENU_PAD * 2,
    frame: false,
    transparent: true,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload-menu.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.menuData = { noteId, hiddenAt: 0 };
  win.loadFile(path.join(__dirname, "src", "menu.html"));

  win.on("blur", () => {
    if (hasVisibleNotePicker(noteId)) return;
    hideMenu(win);
  });
  win.on("closed", () => menuWindows.delete(noteId));

  menuWindows.set(noteId, win);
  return win;
}

function hasVisibleNotePicker(noteId) {
  for (const p of pickerWindows.values()) {
    if (
      !p.isDestroyed() &&
      p.isVisible() &&
      p.pickerData?.noteId === noteId &&
      p.pickerData.origin === "note"
    ) {
      return true;
    }
  }
  return false;
}

function hideMenu(win) {
  if (win && !win.isDestroyed() && win.isVisible()) {
    win.menuData.hiddenAt = Date.now();
    win.hide();
  }
}

function closeMenuFor(noteId) {
  hideMenu(menuWindows.get(noteId));
}

function computeMenuBounds(noteWin) {
  const nb = noteWin.getBounds();
  const wa = screen.getDisplayMatching(nb).workArea;
  const gap = 6;
  const clamp = (v, min, max) => Math.max(min, Math.min(v, Math.max(min, max)));

  let cx, cy;

  const fitsInside = 5 + MENU_W <= nb.width && 27 + MENU_H <= nb.height;
  if (fitsInside) {
    cx = nb.x + 5;
    cy = nb.y + 27;
  } else {
    cy = clamp(nb.y, wa.y, wa.y + wa.height - MENU_H);
    cx = nb.x - gap - MENU_W;
    if (cx < wa.x) {
      cx = clamp(nb.x + nb.width + gap, wa.x, wa.x + wa.width - MENU_W);
    }
  }

  return {
    x: Math.round(cx - MENU_PAD),
    y: Math.round(cy - MENU_PAD),
    width: MENU_W + MENU_PAD * 2,
    height: MENU_H + MENU_PAD * 2,
  };
}

function toggleMenu(noteId) {
  const noteWin = noteWindows.get(noteId);
  if (!noteWin || noteWin.isDestroyed()) return;

  let win = menuWindows.get(noteId);
  if (win && !win.isDestroyed()) {
    if (win.isVisible()) {
      hideMenu(win);
      return;
    }
    if (Date.now() - win.menuData.hiddenAt < 250) return;
  } else {
    win = createMenuWindow(noteId);
  }

  win.setBounds(computeMenuBounds(noteWin));

  const sendInit = () =>
    win.webContents.send("init-menu", {
      noteId,
      zOrder: noteWin.noteData.zOrder || "normal",
    });
  if (win.webContents.isLoading()) {
    win.webContents.once("did-finish-load", sendInit);
  } else {
    sendInit();
  }

  win.show();
  win.focus();
}

function focusNote(noteWin) {
  if (!noteWin.isDestroyed() && noteWin.noteData?.zOrder !== "desktop") {
    noteWin.focus();
  }
}

ipcMain.on("menu-toggle", (event, noteId) => toggleMenu(noteId));
ipcMain.on("menu-close", (event, noteId) => closeMenuFor(noteId));

ipcMain.on("menu-set-color", (event, { noteId, color }) => {
  const noteWin = noteWindows.get(noteId);
  if (!noteWin || noteWin.isDestroyed()) return;
  if (!/^#[0-9a-f]{6}$/i.test(color)) return;
  noteWin.webContents.send("apply-picked-color", { color, origin: "note" });
  closeMenuFor(noteId);
  focusNote(noteWin);
});

ipcMain.on("menu-set-zorder", (event, { noteId, zOrder }) => {
  const noteWin = noteWindows.get(noteId);
  if (!noteWin || noteWin.isDestroyed()) return;
  if (!["desktop", "normal", "top"].includes(zOrder)) return;
  noteWin.noteData.zOrder = zOrder;
  closeMenuFor(noteId);
  applyZOrder(noteWin, zOrder);
  scheduleAutoSave(noteWin);
});

ipcMain.on("menu-open-custom-color", (event, { noteId }) => {
  const noteWin = noteWindows.get(noteId);
  if (!noteWin || noteWin.isDestroyed()) return;
  const color = noteWin.noteData.color || "#fff59d";
  openColorPicker(noteId, "note", color, color);
});

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
      win.noteData.discarded = true;
      win.close();
    }
  }
  try {
    await shell.trashItem(filePath);
    return true;
  } catch (e) {
    console.error("Error deleting note:", e);
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
      console.error("Error importing", src, e);
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

ipcMain.handle("library:set-meta", (event, filePath, patch) => {
  if (typeof filePath !== "string" || !isInsideNotesFolder(filePath) || !patch)
    return false;
  const clean = {};
  if (typeof patch.pinned === "boolean") clean.pinned = patch.pinned;
  if (typeof patch.autoStart === "boolean") clean.autoStart = patch.autoStart;
  if (Array.isArray(patch.tags)) {
    clean.tags = [
      ...new Set(
        patch.tags.map((t) => String(t).trim().slice(0, 30)).filter(Boolean),
      ),
    ].slice(0, 10);
  }

  const target = normPath(filePath);
  for (const win of noteWindows.values()) {
    if (
      !win.isDestroyed() &&
      win.noteData?.filePath &&
      normPath(win.noteData.filePath) === target
    ) {
      Object.assign(win.noteData, clean);
      saveNoteToFile(win);
      return true;
    }
  }
  const data = readNoteFile(filePath);
  if (!data) return false;
  writeFileAtomic(filePath, JSON.stringify({ ...data, ...clean }, null, 2));
  return true;
});

ipcMain.handle("update:get", () => updateInfo);
ipcMain.handle("update:download", () => shell.openExternal(DOWNLOAD_URL));
ipcMain.handle("update:open-link", (e, url) => {
  if (typeof url === "string" && /^https:\/\//i.test(url))
    return shell.openExternal(url);
});
ipcMain.handle(
  "update:get-enabled",
  () => loadSettings().updateChecks === true,
);
ipcMain.handle("update:set-enabled", (e, on) => {
  saveSettings({ updateChecks: !!on });
  if (on) startUpdateChecks();
  else stopUpdateChecks();
  return !!on;
});

const DEFAULT_SHORTCUT = "Ctrl+Alt+N";
let shortcutOk = false;

function registerShortcut() {
  globalShortcut.unregisterAll();
  shortcutOk = false;
  const s = loadSettings();
  if (s.shortcutEnabled === false) return;
  try {
    shortcutOk = globalShortcut.register(s.shortcut || DEFAULT_SHORTCUT, () =>
      createNewNote(),
    );
  } catch (e) {
    console.error("Shortcut error:", e.message);
  }
}

const exePath = () => process.env.PORTABLE_EXECUTABLE_FILE || process.execPath;

function getSettingsView() {
  const s = loadSettings();
  return {
    openAtLogin: app.isPackaged
      ? app.getLoginItemSettings({ path: exePath() }).openAtLogin
      : false,
    startupMode: ["restore", "selected"].includes(s.startupMode)
      ? s.startupMode
      : "panel",
    shortcutEnabled: s.shortcutEnabled !== false,
    shortcut: s.shortcut || DEFAULT_SHORTCUT,
    shortcutOk,
  };
}

ipcMain.handle("settings:get", () => getSettingsView());

ipcMain.handle("settings:set", (e, patch = {}) => {
  const next = {};
  if (["panel", "restore", "selected"].includes(patch.startupMode))
    next.startupMode = patch.startupMode;
  if (typeof patch.shortcutEnabled === "boolean")
    next.shortcutEnabled = patch.shortcutEnabled;
  if (
    typeof patch.shortcut === "string" &&
    /^[\w+]{1,40}$/.test(patch.shortcut)
  )
    next.shortcut = patch.shortcut;
  if (Object.keys(next).length) saveSettings(next);

  if (typeof patch.openAtLogin === "boolean" && app.isPackaged) {
    app.setLoginItemSettings({
      openAtLogin: patch.openAtLogin,
      path: exePath(),
    });
  }
  registerShortcut();
  return getSettingsView();
});
