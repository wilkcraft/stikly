const TAG_MAP = {
  B: "b",
  STRONG: "strong",
  I: "i",
  EM: "em",
  U: "u",
  S: "s",
  STRIKE: "s",
  DEL: "s",
  UL: "ul",
  OL: "ol",
  LI: "li",
  BR: "br",
  DIV: "div",
  P: "p",
  SPAN: "span",
  FONT: "span",
  MARK: "mark",
  SUB: "sub",
  SUP: "sup",
};
const DROP_TAGS = new Set([
  "SCRIPT",
  "STYLE",
  "IFRAME",
  "OBJECT",
  "EMBED",
  "NOSCRIPT",
  "TEMPLATE",
]);

function validColor(value) {
  return !!value && value.length < 60 && CSS.supports("color", value);
}

function sanitizeInto(source, target) {
  for (const child of source.childNodes) {
    if (child.nodeType === Node.TEXT_NODE) {
      target.appendChild(document.createTextNode(child.textContent));
      continue;
    }
    if (child.nodeType !== Node.ELEMENT_NODE) continue;

    const name = child.tagName.toUpperCase();
    if (DROP_TAGS.has(name)) continue;

    const tag = TAG_MAP[name];
    if (!tag) {
      sanitizeInto(child, target);
      continue;
    }

    const out = document.createElement(tag);
    const st = child.style;

    const color = child.getAttribute("color") || st.color;
    if (validColor(color)) out.style.color = color;

    if (
      validColor(st.backgroundColor) &&
      st.backgroundColor !== "transparent"
    ) {
      out.style.backgroundColor = st.backgroundColor;
    }

    if (/^(bold|[6-9]00)$/i.test(st.fontWeight)) out.style.fontWeight = "700";
    if (/^italic$/i.test(st.fontStyle)) out.style.fontStyle = "italic";

    const size = parseFloat(st.fontSize);
    if (/px$/i.test(st.fontSize) && size >= 8 && size <= 72) {
      out.style.fontSize = size + "px";
    }

    const deco = st.textDecorationLine || st.textDecoration;
    if (/^(underline|line-through)( (underline|line-through))?$/i.test(deco)) {
      out.style.textDecoration = deco;
    }

    if (tag === "ul" && child.classList.contains("checklist")) {
      out.classList.add("checklist");
    }
    if (tag === "li" && child.dataset.checked === "true") {
      out.dataset.checked = "true";
    }

    sanitizeInto(child, out);
    target.appendChild(out);
  }
}

function setSafeHtml(target, html) {
  const doc = new DOMParser().parseFromString(String(html), "text/html");
  const frag = document.createDocumentFragment();
  sanitizeInto(doc.body, frag);
  target.replaceChildren(frag);
}

const noteEl = document.getElementById("note");
const content = document.getElementById("content");
const closeBtn = document.getElementById("closeBtn");
const newBtn = document.getElementById("newBtn");
const menuBtn = document.getElementById("menuBtn");
const toolbarButtons = document.querySelectorAll("[data-command]");
const toolbar = document.querySelector(".toolbar");
const saveBtn = document.getElementById("saveBtn");
const openBtn = document.getElementById("openBtn");
const colorBtn = document.getElementById("colorBtn");
const highlightBtn = document.getElementById("highlightBtn");
const checklistBtn = document.getElementById("checklistBtn");
const colorMenu = document.getElementById("colorMenu");
const highlightMenu = document.getElementById("highlightMenu");
const resetColorBtn = document.getElementById("resetColorBtn");
const resetHighlightBtn = document.getElementById("resetHighlightBtn");
let notePath = null;
const DEFAULT_NOTE_COLOR = "#fff59d";
let baseTextColor = "#000000";
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

let noteColor = DEFAULT_NOTE_COLOR;
let noteOpacity = 1;

function renderNoteBackground() {
  const { r, g, b } = hexToRgb(noteColor);
  noteEl.style.background = `rgba(${r}, ${g}, ${b}, ${noteOpacity})`;

  const isDark = getLuminance(noteColor) < 140;
  const base = isDark ? "255, 255, 255" : "0, 0, 0";
  const bandA = (isDark ? 0.14 : 0.08) * noteOpacity;
  const borderA = (isDark ? 0.2 : 0.12) * noteOpacity;

  noteEl.style.setProperty("--collapse-ink", isDark ? "#fff" : "#000");
  noteEl.style.setProperty("--band-overlay", `rgba(${base}, ${bandA})`);
  noteEl.style.setProperty("--band-border", `rgba(${base}, ${borderA})`);
}

function applyNoteColor(color) {
  noteColor = color;
  renderNoteBackground();
}

function applyNoteOpacity(o) {
  noteOpacity = o;
  renderNoteBackground();
}

window.notesAPI.onApplyOpacity(({ opacity }) => applyNoteOpacity(opacity));

function rgbStringToHex(rgbStr) {
  const match = rgbStr.match(/\d+/g);
  if (!match || match.length < 3) return "#000000";
  const [r, g, b] = match.map(Number);
  return (
    "#" +
    [r, g, b]
      .map((x) => Math.max(0, Math.min(255, x)).toString(16).padStart(2, "0"))
      .join("")
  );
}

window.notesAPI.onInit(
  ({
    id,
    html,
    text,
    color,
    zOrder,
    filePath,
    topCollapsed,
    bottomCollapsed,
    opacity,
    fontSize,
    textColor,
  }) => {
    noteId = id;
    baseTextColor = textColor || "#000000";
    content.style.fontSize = (fontSize || 14) + "px";
    content.style.color = baseTextColor;
    noteOpacity = typeof opacity === "number" ? opacity : 1;
    notePath = filePath || null;
    if (html) {
      setSafeHtml(content, html);
    } else if (text) {
      content.textContent = text;
    } else {
      content.innerHTML = "";
    }
    applyNoteColor(color || DEFAULT_NOTE_COLOR);
    if (!html && !text) content.focus();
    setTopCollapsed(!!topCollapsed);
    setBottomCollapsed(!!bottomCollapsed);
    saveBtn.classList.toggle("saved", !!notePath);
    saveBtn.title = notePath ? "Save as..." : "Save note";
  },
);

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

let savedRange = null;

document.addEventListener("selectionchange", () => {
  const sel = window.getSelection();
  if (
    sel.rangeCount &&
    content.contains(sel.anchorNode) &&
    content.contains(sel.focusNode)
  ) {
    savedRange = sel.getRangeAt(0).cloneRange();
  }
});

function showKeptSelection() {
  if (!window.CSS || !CSS.highlights || typeof Highlight === "undefined")
    return;
  if (savedRange && !savedRange.collapsed && !document.hasFocus()) {
    CSS.highlights.set(
      "kept-selection",
      new Highlight(savedRange.cloneRange()),
    );
  } else {
    CSS.highlights.delete("kept-selection");
  }
}
window.addEventListener("blur", showKeptSelection);
window.addEventListener("focus", () => {
  if (window.CSS && CSS.highlights) CSS.highlights.delete("kept-selection");
});

function selectAllContent() {
  const range = document.createRange();
  range.selectNodeContents(content);
  savedRange = range;
}

function applyToSavedSelection(command, value) {
  content.focus();
  const sel = window.getSelection();
  if (savedRange) {
    sel.removeAllRanges();
    sel.addRange(savedRange.cloneRange());
  }
  document.execCommand(command, false, value);
  if (sel.rangeCount && content.contains(sel.anchorNode)) {
    savedRange = sel.getRangeAt(0).cloneRange();
  }
  showKeptSelection();
  scheduleSave();
}

function applyFontSize(px) {
  content.focus();
  const sel = window.getSelection();
  if (savedRange) {
    sel.removeAllRanges();
    sel.addRange(savedRange.cloneRange());
  }
  if (sel.isCollapsed) return;

  document.execCommand("fontSize", false, "7");
  const spans = [];
  content.querySelectorAll('font[size="7"]').forEach((f) => {
    const span = document.createElement("span");
    span.style.fontSize = px + "px";
    while (f.firstChild) span.appendChild(f.firstChild);
    f.replaceWith(span);
    spans.push(span);
  });
  spans.forEach((s) =>
    s
      .querySelectorAll("span")
      .forEach((i) => i.style.removeProperty("font-size")),
  );

  if (spans.length) {
    const r = document.createRange();
    r.setStartBefore(spans[0]);
    r.setEndAfter(spans[spans.length - 1]);
    sel.removeAllRanges();
    sel.addRange(r);
    savedRange = r.cloneRange();
  }
  showKeptSelection();
  scheduleSave();
}

function resetFontSize() {
  if (!savedRange) selectAllContent();
  content.focus();
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(savedRange.cloneRange());
  content.querySelectorAll("span").forEach((s) => {
    if (s.style.fontSize && sel.containsNode(s, true)) {
      s.style.removeProperty("font-size");
      if (!s.getAttribute("style")) s.removeAttribute("style");
      if (!s.attributes.length) s.replaceWith(...s.childNodes);
    }
  });
  scheduleSave();
}

function currentList() {
  const sel = window.getSelection();
  if (!sel.rangeCount || !sel.anchorNode || !content.contains(sel.anchorNode)) {
    return null;
  }
  const node =
    sel.anchorNode.nodeType === 1
      ? sel.anchorNode
      : sel.anchorNode.parentElement;
  const list = node ? node.closest("ul, ol") : null;
  return list && content.contains(list) ? list : null;
}

function isChecklist(list) {
  return (
    !!list && list.tagName === "UL" && list.classList.contains("checklist")
  );
}

function updateToolbarState() {
  const inChecklist = isChecklist(currentList());
  toolbarButtons.forEach((button) => {
    const command = button.dataset.command;
    let active = false;
    try {
      active = document.queryCommandState(command);
    } catch (e) {
      active = false;
    }
    if (command === "insertUnorderedList" && inChecklist) active = false;
    button.classList.toggle("active", active);
  });
  checklistBtn.classList.toggle("active", inChecklist);
}

function applyEditCommand(command) {
  content.focus();
  if (command === "insertUnorderedList" && isChecklist(currentList())) {
    currentList().classList.remove("checklist");
    updateToolbarState();
    scheduleSave();
    return;
  }
  document.execCommand(command, false, null);
  updateToolbarState();
  scheduleSave();
}

toolbarButtons.forEach((button) => {
  button.addEventListener("mousedown", (event) => {
    event.preventDefault();
  });
  button.addEventListener("click", () => {
    applyEditCommand(button.dataset.command);
  });
});

content.addEventListener("keyup", updateToolbarState);
content.addEventListener("mouseup", updateToolbarState);

toolbar.addEventListener(
  "wheel",
  (e) => {
    if (e.deltaY) {
      toolbar.scrollLeft += e.deltaY;
      e.preventDefault();
    }
  },
  { passive: false },
);

function markSelectedListsAsChecklist() {
  const sel = window.getSelection();
  content.querySelectorAll("ul").forEach((ul) => {
    if (sel.rangeCount && sel.containsNode(ul, true)) {
      ul.classList.add("checklist");
    }
  });
  const list = currentList();
  if (list && list.tagName === "UL") list.classList.add("checklist");
}

function toggleChecklist() {
  content.focus();
  const list = currentList();
  if (isChecklist(list)) {
    document.execCommand("insertUnorderedList");
  } else if (list && list.tagName === "UL") {
    list.classList.add("checklist");
  } else {
    document.execCommand("insertUnorderedList");
    markSelectedListsAsChecklist();
  }
  updateToolbarState();
  scheduleSave();
}

checklistBtn.addEventListener("mousedown", (e) => e.preventDefault());
checklistBtn.addEventListener("click", toggleChecklist);

content.addEventListener("mousedown", (e) => {
  if (e.button !== 0 || !e.target.closest) return;
  const li = e.target.closest("ul.checklist > li");
  if (!li || !content.contains(li)) return;
  const rect = li.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;
  if (x >= 0 && x <= 24 && y >= 0 && y <= 24) {
    e.preventDefault();
    if (li.dataset.checked === "true") {
      delete li.dataset.checked;
    } else {
      li.dataset.checked = "true";
    }
    scheduleSave();
  }
});

content.addEventListener("input", (e) => {
  if (e.inputType !== "insertParagraph") return;
  const sel = window.getSelection();
  if (!sel.anchorNode) return;
  const node =
    sel.anchorNode.nodeType === 1
      ? sel.anchorNode
      : sel.anchorNode.parentElement;
  const li = node && node.closest("ul.checklist > li");
  if (li && !li.textContent.trim()) delete li.dataset.checked;
});

colorBtn.addEventListener("mousedown", (event) => {
  event.preventDefault();
});

colorBtn.addEventListener("click", () => {
  let currentColor = "#000000";
  try {
    const val = document.queryCommandValue("foreColor");
    if (val) currentColor = rgbStringToHex(val);
  } catch (e) {}

  let currentSize = 14;
  const s = window.getSelection();
  if (s.anchorNode && content.contains(s.anchorNode)) {
    const n =
      s.anchorNode.nodeType === 1 ? s.anchorNode : s.anchorNode.parentElement;
    currentSize = Math.round(parseFloat(getComputedStyle(n).fontSize)) || 14;
  }

  hideColorMenus();
  window.notesAPI.openColorPicker({
    noteId,
    origin: "text",
    currentColor,
    currentSize,
    noteColor: noteColor,
  });
});

colorBtn.addEventListener("contextmenu", (event) => {
  event.preventDefault();
  showMenuAboveButton(colorMenu, colorBtn);
});

function showMenuAboveButton(menuEl, btn) {
  hideColorMenus();
  menuEl.classList.add("visible");
  const noteRect = noteEl.getBoundingClientRect();
  const btnRect = btn.getBoundingClientRect();
  const menuWidth = menuEl.offsetWidth;

  let left = btnRect.left - noteRect.left + btnRect.width / 2 - menuWidth / 2;
  left = Math.max(4, Math.min(left, noteRect.width - menuWidth - 4));

  menuEl.style.left = left + "px";
  menuEl.style.right = "auto";
}

resetColorBtn.addEventListener("click", () => {
  if (!savedRange) selectAllContent();
  applyToSavedSelection("foreColor", baseTextColor);
  colorBtn.style.borderBottom = "";
  colorMenu.classList.remove("visible");
});

const resetSizeBtn = document.getElementById("resetSizeBtn");
resetSizeBtn.addEventListener("click", () => {
  resetFontSize();
  colorMenu.classList.remove("visible");
});

window.notesAPI.onApplyPickedSize(({ size }) => applyFontSize(size));

let lastHighlightColor = "#ffeb3b";

highlightBtn.addEventListener("mousedown", (event) => {
  event.preventDefault();
});

highlightBtn.addEventListener("click", () => {
  hideColorMenus();
  window.notesAPI.openColorPicker({
    noteId,
    origin: "highlight",
    currentColor: lastHighlightColor,
    noteColor: noteEl.style.background,
  });
});

highlightBtn.addEventListener("contextmenu", (event) => {
  event.preventDefault();
  showMenuAboveButton(highlightMenu, highlightBtn);
});

resetHighlightBtn.addEventListener("click", () => {
  if (!savedRange) selectAllContent();
  applyToSavedSelection("hiliteColor", "transparent");
  highlightBtn.style.borderBottom = "";
  highlightMenu.classList.remove("visible");
});

window.notesAPI.onApplyPickedColor(({ color, origin }) => {
  if (origin === "text") {
    applyToSavedSelection("foreColor", color);
    colorBtn.style.borderBottom = `3px solid ${color}`;
  } else if (origin === "highlight") {
    lastHighlightColor = color;
    applyToSavedSelection("hiliteColor", color);
    highlightBtn.style.borderBottom = `3px solid ${color}`;
  } else if (origin === "note") {
    applyNoteColor(color);
    window.notesAPI.updateNote({ id: noteId, color });
  }
});

function hideColorMenus() {
  colorMenu.classList.remove("visible");
  highlightMenu.classList.remove("visible");
}

menuBtn.addEventListener("click", (event) => {
  event.stopPropagation();
  window.notesAPI.toggleMenu(noteId);
});

document.addEventListener("click", (event) => {
  if (!colorMenu.contains(event.target) && !colorBtn.contains(event.target)) {
    colorMenu.classList.remove("visible");
  }
  if (
    !highlightMenu.contains(event.target) &&
    !highlightBtn.contains(event.target)
  ) {
    highlightMenu.classList.remove("visible");
  }
});

newBtn.addEventListener("click", () => {
  window.notesAPI.createNote();
});

closeBtn.addEventListener("click", () => {
  window.notesAPI.deleteNote(noteId);
});

async function saveAsFlow() {
  const filePath = await window.notesAPI.saveNoteAs();
  if (filePath) {
    notePath = filePath;
    saveBtn.classList.add("saved");
    saveBtn.title = "Save as...";
  }
  return filePath;
}

async function saveQuickFlow() {
  const filePath = await window.notesAPI.saveNote();
  if (filePath) return filePath;
  return saveAsFlow();
}

saveBtn.addEventListener("click", () => {
  saveAsFlow();
});

openBtn.addEventListener("click", () => {
  window.notesAPI.openNoteFile();
});

const searchBar = document.getElementById("searchBar");
const searchInput = document.getElementById("searchInput");
const searchCloseBtn = document.getElementById("searchCloseBtn");

function openSearchBar() {
  searchBar.classList.add("visible");
  searchInput.value = "";
  collapseSelectionToStart();
  searchInput.focus();
}
function closeSearchBar() {
  searchBar.classList.remove("visible");
  window.getSelection().removeAllRanges();
  content.focus();
}
function collapseSelectionToStart() {
  const selection = window.getSelection();
  const range = document.createRange();
  range.selectNodeContents(content);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
}
function findNext(backwards = false) {
  const term = searchInput.value.trim();
  if (!term) return;
  window.find(term, false, backwards, true, false, true, false);
  searchInput.focus();
}
searchInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    findNext(event.shiftKey);
  } else if (event.key === "Escape") {
    event.preventDefault();
    closeSearchBar();
  }
});
searchInput.addEventListener("input", () => {
  collapseSelectionToStart();
  findNext(false);
});
searchCloseBtn.addEventListener("click", closeSearchBar);

document.addEventListener("keydown", (event) => {
  if (event.target === searchInput) return;
  const mod = event.ctrlKey || event.metaKey;
  const key = event.key.toLowerCase();

  if (mod && !event.shiftKey && key === "z") {
    event.preventDefault();
    applyEditCommand("undo");
    return;
  }
  if (mod && key === "y") {
    event.preventDefault();
    applyEditCommand("redo");
    return;
  }
  if (mod && !event.shiftKey && ["b", "i", "u"].includes(key)) {
    event.preventDefault();
    const map = { b: "bold", i: "italic", u: "underline" };
    applyEditCommand(map[key]);
    return;
  }
  if (mod && !event.shiftKey && key === "n") {
    event.preventDefault();
    window.notesAPI.createNote();
    return;
  }
  if (mod && key === "s") {
    event.preventDefault();
    if (event.shiftKey) saveAsFlow();
    else saveQuickFlow();
    return;
  }
  if (mod && key === "o") {
    event.preventDefault();
    window.notesAPI.openNoteFile();
    return;
  }
  if (mod && key === "f") {
    event.preventDefault();
    openSearchBar();
    return;
  }
  if (event.key === "Escape") {
    event.preventDefault();
    window.notesAPI.closeMenu(noteId);
    hideColorMenus();
    if (searchBar.classList.contains("visible")) closeSearchBar();
    return;
  }
});

const toggleTopBtn = document.getElementById("toggleTopBtn");
const toggleBottomBtn = document.getElementById("toggleBottomBtn");

function setTopCollapsed(collapsed) {
  noteEl.classList.toggle("top-collapsed", collapsed);
  toggleTopBtn.title = collapsed ? "Show top bar" : "Hide top bar";
  if (collapsed) {
    window.notesAPI.closeMenu(noteId);
  }
}

function setBottomCollapsed(collapsed) {
  noteEl.classList.toggle("bottom-collapsed", collapsed);
  toggleBottomBtn.title = collapsed ? "Show bottom bar" : "Hide bottom bar";
  if (collapsed) {
    hideColorMenus();
    searchBar.classList.remove("visible");
  }
}

toggleTopBtn.addEventListener("click", () => {
  const collapsed = !noteEl.classList.contains("top-collapsed");
  setTopCollapsed(collapsed);
  window.notesAPI.updateNote({ id: noteId, topCollapsed: collapsed });
});

toggleBottomBtn.addEventListener("click", () => {
  const collapsed = !noteEl.classList.contains("bottom-collapsed");
  setBottomCollapsed(collapsed);
  window.notesAPI.updateNote({ id: noteId, bottomCollapsed: collapsed });
});
