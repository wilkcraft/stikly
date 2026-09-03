const noteEl = document.getElementById("note");
const content = document.getElementById("content");
const closeBtn = document.getElementById("closeBtn");
const newBtn = document.getElementById("newBtn");
const menuBtn = document.getElementById("menuBtn");
const menu = document.getElementById("menu");
const colorOptions = document.querySelectorAll(".color-option");
const zOrderOptions = document.querySelectorAll("[data-zorder]");
const toolbarButtons = document.querySelectorAll("[data-command]");

const DEFAULT_NOTE_COLOR = "#fff59d";

let noteId = null;
let saveTimeout = null;

function hexToRgb(hex) {
  const clean = hex.replace("#", "");
  const full =
    clean.length === 3
      ? clean
          .split("")
          .map((c) => c + c)
          .join("")
      : clean;
  const bigint = parseInt(full, 16);
  return { r: (bigint >> 16) & 255, g: (bigint >> 8) & 255, b: bigint & 255 };
}

function getLuminance(hex) {
  const { r, g, b } = hexToRgb(hex);
  return (r * 299 + g * 587 + b * 114) / 1000;
}

function applyNoteColor(color) {
  noteEl.style.background = color;
  const isDark = getLuminance(color) < 140;
  if (isDark) {
    noteEl.style.setProperty("--band-overlay", "rgba(255, 255, 255, 0.14)");
    noteEl.style.setProperty("--band-border", "rgba(255, 255, 255, 0.2)");
  } else {
    noteEl.style.setProperty("--band-overlay", "rgba(0, 0, 0, 0.08)");
    noteEl.style.setProperty("--band-border", "rgba(0, 0, 0, 0.12)");
  }
}

window.notesAPI.onInit(({ id, html, text, color, zOrder }) => {
  noteId = id;
  if (html) {
    content.innerHTML = html;
  } else if (text) {
    content.textContent = text;
  } else {
    content.innerHTML = "";
  }
  applyNoteColor(color || DEFAULT_NOTE_COLOR);
  updateZOrderUI(zOrder || "normal");
});

function saveContent() {
  if (!noteId) return;
  window.notesAPI.updateNote({
    id: noteId,
    html: content.innerHTML,
    text: content.innerText,
  });
}

function scheduleSave() {
  clearTimeout(saveTimeout);
  saveTimeout = setTimeout(() => {
    saveContent();
  }, 300);
}

content.addEventListener("input", scheduleSave);

toolbarButtons.forEach((button) => {
  button.addEventListener("mousedown", (event) => {
    event.preventDefault();
  });
  button.addEventListener("click", () => {
    const command = button.dataset.command;
    content.focus();
    document.execCommand(command, false, null);
    updateToolbarState();
    scheduleSave();
  });
});

const colorBtn = document.getElementById("colorBtn");
const colorPicker = document.getElementById("colorPicker");
let savedRange = null;

colorBtn.addEventListener("mousedown", (event) => {
  event.preventDefault();
  const selection = window.getSelection();
  if (selection.rangeCount > 0) {
    savedRange = selection.getRangeAt(0).cloneRange();
  }
});

colorBtn.addEventListener("click", () => {
  colorPicker.click();
});

colorPicker.addEventListener("input", (event) => {
  const color = event.target.value;
  content.focus();
  const selection = window.getSelection();
  if (savedRange) {
    selection.removeAllRanges();
    selection.addRange(savedRange);
  }
  document.execCommand("foreColor", false, color);
  colorBtn.style.borderBottom = `3px solid ${color}`;
  scheduleSave();
});

const colorMenu = document.getElementById("colorMenu");
const resetColorBtn = document.getElementById("resetColorBtn");

colorBtn.addEventListener("contextmenu", (event) => {
  event.preventDefault();
  colorMenu.classList.add("visible");
});

resetColorBtn.addEventListener("click", () => {
  content.focus();
  const selection = window.getSelection();
  if (savedRange) {
    selection.removeAllRanges();
    selection.addRange(savedRange);
  } else {
    const range = document.createRange();
    range.selectNodeContents(content);
    selection.removeAllRanges();
    selection.addRange(range);
  }
  document.execCommand("foreColor", false, "#000000");
  colorBtn.style.borderBottom = "";
  scheduleSave();
  colorMenu.classList.remove("visible");
});

function updateToolbarState() {
  toolbarButtons.forEach((button) => {
    const command = button.dataset.command;
    let active = false;
    try {
      active = document.queryCommandState(command);
    } catch (e) {
      active = false;
    }
    button.classList.toggle("active", active);
  });
}

content.addEventListener("keyup", updateToolbarState);
content.addEventListener("mouseup", updateToolbarState);

colorOptions.forEach((option) => {
  option.addEventListener("click", () => {
    const color = option.dataset.color;
    applyNoteColor(color);
    window.notesAPI.updateNote({
      id: noteId,
      color,
    });
    closeMenu();
  });
});

const gearBtn = document.getElementById("customColorBtn");
const noteColorPicker = document.getElementById("noteColorPicker");
const noteColorMenu = document.getElementById("noteColorMenu");
const resetNoteColorBtn = document.getElementById("resetNoteColorBtn");

gearBtn.addEventListener("click", () => {
  noteColorPicker.click();
});

gearBtn.addEventListener("contextmenu", (event) => {
  event.preventDefault();
  closeMenu();
  noteColorMenu.classList.add("visible");
});

noteColorPicker.addEventListener("input", (event) => {
  const color = event.target.value;
  applyNoteColor(color);
  window.notesAPI.updateNote({ id: noteId, color });
});

resetNoteColorBtn.addEventListener("click", () => {
  applyNoteColor(DEFAULT_NOTE_COLOR);
  window.notesAPI.updateNote({ id: noteId, color: DEFAULT_NOTE_COLOR });
  noteColorMenu.classList.remove("visible");
});

zOrderOptions.forEach((option) => {
  option.addEventListener("click", () => {
    const zOrder = option.dataset.zorder;
    window.notesAPI.updateNote({
      id: noteId,
      zOrder,
    });
    updateZOrderUI(zOrder);
    closeMenu();
  });
});

function updateZOrderUI(zOrder) {
  zOrderOptions.forEach((option) => {
    option.classList.toggle("selected", option.dataset.zorder === zOrder);
  });
}

menuBtn.addEventListener("click", (event) => {
  event.stopPropagation();
  menu.classList.toggle("visible");
});

document.addEventListener("click", (event) => {
  if (!menu.contains(event.target) && event.target !== menuBtn) {
    closeMenu();
  }
  if (!colorMenu.contains(event.target) && event.target !== colorBtn) {
    colorMenu.classList.remove("visible");
  }
  if (!noteColorMenu.contains(event.target) && event.target !== gearBtn) {
    noteColorMenu.classList.remove("visible");
  }
});

function closeMenu() {
  menu.classList.remove("visible");
}

newBtn.addEventListener("click", () => {
  window.notesAPI.createNote();
});

closeBtn.addEventListener("click", () => {
  window.notesAPI.deleteNote(noteId);
});
