const board = document.getElementById("board");
const emptyState = document.getElementById("emptyState");
const countLabel = document.getElementById("countLabel");
const searchInput = document.getElementById("searchInput");
let allNotes = [];

const colorFilter = document.getElementById("colorFilter");
const tagFilter = document.getElementById("tagFilter");
const sortSelect = document.getElementById("sortSelect");
const deepSearch = document.getElementById("deepSearch");
const viewButtons = document.querySelectorAll("[data-view]");

const ui = Object.assign(
  { view: "board", sort: "recent", deep: false },
  (() => {
    try {
      return JSON.parse(localStorage.getItem("stikly-ui")) || {};
    } catch {
      return {};
    }
  })(),
  { color: "", tag: "" },
);
function saveUi() {
  try {
    localStorage.setItem(
      "stikly-ui",
      JSON.stringify({ view: ui.view, sort: ui.sort, deep: ui.deep }),
    );
  } catch {}
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function parseRgb(color) {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color);
  if (hex) {
    let h = hex[1];
    if (h.length === 3)
      h = h
        .split("")
        .map((c) => c + c)
        .join("");
    const n = parseInt(h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const m = String(color).match(/\d+/g);
  return m && m.length >= 3 ? m.slice(0, 3).map(Number) : [255, 245, 157];
}

function isDarkColor(color) {
  const [r, g, b] = parseRgb(color);
  return (r * 299 + g * 587 + b * 114) / 1000 < 140;
}

function hueOf(color) {
  const [r, g, b] = parseRgb(color).map((v) => v / 255);
  const max = Math.max(r, g, b),
    min = Math.min(r, g, b),
    d = max - min;
  if (d < 0.08) return 999;
  const h =
    max === r
      ? ((g - b) / d) % 6
      : max === g
        ? (b - r) / d + 2
        : (r - g) / d + 4;
  return (h * 60 + 360) % 360;
}

function formatDate(ms) {
  return new Date(ms).toLocaleString("en-US", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

async function openNote(note, keepOpen) {
  await window.libraryAPI.open(note.filePath, keepOpen);
  if (keepOpen) await refresh();
}

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

function readStyle(el, prop) {
  const raw = el.getAttribute("style") || "";
  const m = new RegExp("(?:^|;)\\s*" + prop + "\\s*:\\s*([^;]+)", "i").exec(
    raw,
  );
  return m ? m[1].trim() : "";
}

function validColor(value) {
  return !!value && CSS.supports("color", value);
}

function sanitizeInto(source, target) {
  for (const child of source.childNodes) {
    if (child.nodeType === Node.TEXT_NODE) {
      target.appendChild(document.createTextNode(child.textContent));
      continue;
    }
    if (child.nodeType !== Node.ELEMENT_NODE) continue;
    if (DROP_TAGS.has(child.tagName)) continue;

    const tag = TAG_MAP[child.tagName];
    if (!tag) {
      sanitizeInto(child, target);
      continue;
    }

    const out = document.createElement(tag);

    const color = child.getAttribute("color") || readStyle(child, "color");
    if (validColor(color)) out.style.color = color;

    const bg = readStyle(child, "background-color");
    if (validColor(bg) && bg !== "transparent") {
      out.style.backgroundColor = bg;
      out.style.borderRadius = "2px";
    }

    const weight = readStyle(child, "font-weight");
    if (/^(bold|[6-9]00)$/i.test(weight)) out.style.fontWeight = "700";
    if (/^italic$/i.test(readStyle(child, "font-style")))
      out.style.fontStyle = "italic";
    const deco = readStyle(child, "text-decoration");
    if (/^(underline|line-through)( (underline|line-through))?$/i.test(deco)) {
      out.style.textDecoration = deco;
    }

    if (tag === "ul" && child.classList.contains("checklist"))
      out.classList.add("checklist");
    if (tag === "li" && child.dataset.checked === "true")
      out.dataset.checked = "true";

    sanitizeInto(child, out);
    target.appendChild(out);
  }
}

function buildPreview(note) {
  const box = el("div", "card-preview");
  if (note.html) {
    const doc = new DOMParser().parseFromString(note.html, "text/html");
    sanitizeInto(doc.body, box);
  }
  if (!box.textContent.trim() && !box.querySelector("li")) {
    box.textContent = "(empty note)";
    box.classList.add("empty-text");
  }
  return box;
}

async function setMeta(note, patch) {
  await window.libraryAPI.setMeta(note.filePath, patch);
  await refresh();
}

function miniBtn(label, title, pressed, onClick) {
  const b = el("button", "card-btn" + (pressed ? " on" : ""), label);
  b.type = "button";
  b.title = title;
  b.setAttribute("aria-pressed", String(!!pressed));
  b.addEventListener("click", (e) => {
    e.stopPropagation();
    onClick();
  });
  b.addEventListener("keydown", (e) => e.stopPropagation());
  return b;
}

function openTagInput(card, note) {
  if (card.querySelector(".tag-input")) return;
  const input = el("input", "tag-input");
  input.type = "text";
  input.placeholder = "tag + Enter";
  input.maxLength = 30;
  input.addEventListener("click", (e) => e.stopPropagation());
  input.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Enter") {
      const t = input.value.trim().replace(/^#/, "").toLowerCase();
      if (t) setMeta(note, { tags: [...note.tags, t] });
      else input.remove();
    } else if (e.key === "Escape") input.remove();
  });
  input.addEventListener("blur", () => input.remove());
  card.querySelector(".card-foot").before(input);
  input.focus();
}

function createCard(note, q) {
  const card = el(
    "article",
    "note-card" +
      (isDarkColor(note.color) ? " dark-note" : "") +
      (note.pinned ? " is-pinned" : ""),
  );
  card.tabIndex = 0;
  card.setAttribute("role", "button");
  card.setAttribute("aria-label", "Open note " + note.name);
  card.style.setProperty("--note-color", note.color);

  card.appendChild(el("div", "pin"));
  if (note.isOpen) card.appendChild(el("span", "open-badge", "Open"));

  const title = el("h3", "card-title", note.name);
  const preview = buildPreview(note);
  card.append(title, preview);

  if (q) {
    highlightIn(title, q);
    const hits = highlightIn(preview, q);
    if (ui.deep && !hits) {
      const sn = buildSnippet(note.body || "", q);
      if (sn) card.appendChild(sn);
    }
  }

  if (note.tags.length) {
    const row = el("div", "card-tags");
    for (const t of note.tags) {
      const chip = el("span", "tag-chip", "#" + t);
      const x = el("button", "tag-x", "\u00D7");
      x.type = "button";
      x.title = "Remove tag";
      x.addEventListener("click", (e) => {
        e.stopPropagation();
        setMeta(note, { tags: note.tags.filter((v) => v !== t) });
      });
      x.addEventListener("keydown", (e) => e.stopPropagation());
      chip.appendChild(x);
      row.appendChild(chip);
    }
    card.appendChild(row);
  }

  const del = el("button", "card-delete", "\u{1F5D1}");
  del.type = "button";
  del.title = "Move to Recycle Bin";
  let armed = false;
  let timer = null;
  del.addEventListener("click", async (e) => {
    e.stopPropagation();
    if (!armed) {
      armed = true;
      del.textContent = "Delete?";
      del.classList.add("armed");
      timer = setTimeout(() => {
        armed = false;
        del.textContent = "\u{1F5D1}";
        del.classList.remove("armed");
      }, 3000);
      return;
    }
    clearTimeout(timer);
    await window.libraryAPI.remove(note.filePath);
    await refresh();
  });
  del.addEventListener("keydown", (e) => e.stopPropagation());

  const foot = el("div", "card-foot");
  foot.appendChild(el("span", "", formatDate(note.modified)));
  const actions = el("div", "card-actions");
  actions.append(
    miniBtn(
      "\u{1F4CC}",
      note.pinned ? "Unpin" : "Pin to the top",
      note.pinned,
      () => setMeta(note, { pinned: !note.pinned }),
    ),
    miniBtn(
      "\u{1F680}",
      "Open this note when Stikly starts",
      note.autoStart,
      () => setMeta(note, { autoStart: !note.autoStart }),
    ),
    miniBtn("\u{1F3F7}", "Add tag", false, () => openTagInput(card, note)),
    del,
  );
  foot.appendChild(actions);
  card.appendChild(foot);

  card.addEventListener("click", (e) => openNote(note, e.shiftKey));
  card.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      openNote(note, e.shiftKey);
    }
  });
  return card;
}

function visibleNotes(q) {
  const list = allNotes.filter((n) => {
    if (ui.color && n.color.toLowerCase() !== ui.color) return false;
    if (ui.tag && !n.tags.includes(ui.tag)) return false;
    if (!q) return true;
    const hay = (
      n.name +
      " " +
      n.tags.join(" ") +
      " " +
      (ui.deep ? n.body : n.text)
    ).toLowerCase();
    return hay.includes(q);
  });
  const cmp = {
    recent: (a, b) => b.modified - a.modified,
    name: (a, b) =>
      a.name.localeCompare(b.name, undefined, {
        numeric: true,
        sensitivity: "base",
      }),
    color: (a, b) => hueOf(a.color) - hueOf(b.color) || b.modified - a.modified,
  }[ui.sort];
  return list.sort((a, b) => b.pinned - a.pinned || cmp(a, b));
}

function renderFilters() {
  const colors = [...new Set(allNotes.map((n) => n.color.toLowerCase()))];
  const tags = [...new Set(allNotes.flatMap((n) => n.tags))].sort();
  if (ui.color && !colors.includes(ui.color)) ui.color = "";
  if (ui.tag && !tags.includes(ui.tag)) ui.tag = "";

  colorFilter.replaceChildren(
    ...colors.map((c) => {
      const b = el("button", "color-dot");
      b.type = "button";
      b.style.background = c;
      b.title = "Filter by this color";
      b.setAttribute("aria-pressed", String(ui.color === c));
      b.addEventListener("click", () => {
        ui.color = ui.color === c ? "" : c;
        render();
      });
      return b;
    }),
  );
  colorFilter.hidden = colors.length < 2;

  tagFilter.replaceChildren(
    ...tags.map((t) => {
      const b = el("button", "tag-btn", "#" + t);
      b.type = "button";
      b.setAttribute("aria-pressed", String(ui.tag === t));
      b.addEventListener("click", () => {
        ui.tag = ui.tag === t ? "" : t;
        render();
      });
      return b;
    }),
  );
  tagFilter.hidden = tags.length === 0;
}

function render() {
  const q = searchInput.value.trim().toLowerCase();
  renderFilters();
  const notes = visibleNotes(q);

  board.classList.toggle("list-view", ui.view === "list");
  board.replaceChildren(...notes.map((n) => createCard(n, q)));

  board.querySelectorAll(".card-preview").forEach((p) => {
    p.classList.toggle("clipped", p.scrollHeight > p.clientHeight + 1);
  });

  const total = allNotes.length;
  countLabel.textContent =
    total === 0
      ? "No saved notes yet"
      : total === 1
        ? "1 saved note"
        : `${total} saved notes`;

  if (notes.length === 0) {
    emptyState.textContent =
      total === 0
        ? "Your notes will show up here once you save them."
        : "No notes match your search or filters.";
    emptyState.classList.add("visible");
  } else {
    emptyState.classList.remove("visible");
  }
}

async function refresh() {
  allNotes = await window.libraryAPI.list();
  render();
}

document
  .getElementById("newBtn")
  .addEventListener("click", () => window.libraryAPI.newNote());
document
  .getElementById("folderBtn")
  .addEventListener("click", () => window.libraryAPI.openFolder());
document.getElementById("importBtn").addEventListener("click", async () => {
  const count = await window.libraryAPI.importNotes();
  if (count) await refresh();
});
searchInput.addEventListener("input", render);
window.addEventListener("focus", refresh);
window.addEventListener("focus", () =>
  window.libraryAPI.getUpdate().then(setUpdate),
);

const themeButtons = document.querySelectorAll("[data-pref]");
function markTheme(pref) {
  themeButtons.forEach((b) =>
    b.setAttribute("aria-pressed", String(b.dataset.pref === pref)),
  );
}
themeButtons.forEach((b) =>
  b.addEventListener("click", async () => {
    markTheme(await window.libraryAPI.setTheme(b.dataset.pref));
  }),
);
window.libraryAPI.getTheme().then(markTheme);

const updateBtn = document.getElementById("updateBtn");
const updateModal = document.getElementById("updateModal");
const updateTitle = document.getElementById("updateTitle");
const updateBody = document.getElementById("updateBody");
const updateOpt = document.getElementById("updateOpt");
let currentUpdate = null;

function renderInline(text, parent) {
  const re =
    /(\*\*[^*]+\*\*|`[^`]+`|\*[^*]+\*|\[[^\]]+\]\(https:\/\/[^)\s]+\))/g;
  let last = 0,
    m;
  while ((m = re.exec(text))) {
    if (m.index > last) parent.append(text.slice(last, m.index));
    const t = m[0];
    if (t.startsWith("**"))
      parent.appendChild(el("strong", "", t.slice(2, -2)));
    else if (t.startsWith("`"))
      parent.appendChild(el("code", "", t.slice(1, -1)));
    else if (t.startsWith("[")) {
      const [, label, url] = /^\[([^\]]+)\]\((.+)\)$/.exec(t);
      const a = el("a", "", label);
      a.addEventListener("click", () => window.libraryAPI.openLink(url));
      parent.appendChild(a);
    } else parent.appendChild(el("em", "", t.slice(1, -1)));
    last = re.lastIndex;
  }
  if (last < text.length) parent.append(text.slice(last));
}

function renderMarkdown(md, target) {
  target.replaceChildren();
  let para = [],
    list = null;
  const flush = () => {
    if (!para.length) return;
    const p = el("p");
    renderInline(para.join(" "), p);
    target.appendChild(p);
    para = [];
  };
  const addItem = (tag, text) => {
    flush();
    if (!list || list.tagName.toLowerCase() !== tag) {
      list = el(tag);
      target.appendChild(list);
    }
    const li = el("li");
    renderInline(text, li);
    list.appendChild(li);
  };
  for (const raw of String(md).replace(/\r\n/g, "\n").split("\n")) {
    const line = raw.trimEnd();
    let m;
    if (!line.trim()) {
      flush();
      list = null;
      continue;
    }
    if ((m = /^(#{1,6})\s+(.*)$/.exec(line))) {
      flush();
      list = null;
      const h = el("h" + Math.min(m[1].length + 2, 6));
      renderInline(m[2], h);
      target.appendChild(h);
    } else if ((m = /^\s*[-*+]\s+(.*)$/.exec(line))) addItem("ul", m[1]);
    else if ((m = /^\s*\d+\.\s+(.*)$/.exec(line))) addItem("ol", m[1]);
    else {
      list = null;
      para.push(line.trim());
    }
  }
  flush();
}

function setUpdate(info) {
  currentUpdate = info;
  updateBtn.hidden = !info;
}

function showUpdate() {
  if (!currentUpdate) return;
  updateTitle.textContent = `${currentUpdate.name}`;
  renderMarkdown(currentUpdate.body || "No release notes.", updateBody);
  updateModal.hidden = false;
}

updateBtn.addEventListener("click", showUpdate);
document
  .getElementById("updateClose")
  .addEventListener("click", () => (updateModal.hidden = true));
document.getElementById("updateDownload").addEventListener("click", () => {
  updateModal.hidden = true;
  showDownloads();
});
updateModal.addEventListener("click", (e) => {
  if (e.target === updateModal) updateModal.hidden = true;
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    updateModal.hidden = true;
    settingsModal.hidden = true;
    downloadModal.hidden = true;
  }
});

updateOpt.addEventListener("change", async () => {
  updateOpt.checked = await window.libraryAPI.setUpdateChecks(
    updateOpt.checked,
  );
  if (!updateOpt.checked) setUpdate(null);
});

function highlightIn(root, q) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  let count = 0;
  for (const node of nodes) {
    const text = node.nodeValue;
    const lower = text.toLowerCase();
    let i = lower.indexOf(q);
    if (i < 0) continue;
    const frag = document.createDocumentFragment();
    let last = 0;
    while (i >= 0) {
      frag.append(text.slice(last, i));
      const m = document.createElement("mark");
      m.className = "hit";
      m.textContent = text.slice(i, i + q.length);
      frag.append(m);
      count++;
      last = i + q.length;
      i = lower.indexOf(q, last);
    }
    frag.append(text.slice(last));
    node.replaceWith(frag);
  }
  return count;
}

function buildSnippet(body, q) {
  const i = body.toLowerCase().indexOf(q);
  if (i < 0) return null;
  const start = Math.max(0, i - 40);
  const text =
    (start ? "\u2026" : "") +
    body.slice(start, i + q.length + 60).replace(/\s+/g, " ") +
    "\u2026";
  const p = el("p", "card-snippet", text);
  highlightIn(p, q);
  return p;
}

window.libraryAPI.onUpdate(setUpdate);
window.libraryAPI.getUpdate().then(setUpdate);
window.libraryAPI.getUpdateChecks().then((v) => (updateOpt.checked = v));

sortSelect.value = ui.sort;
deepSearch.checked = ui.deep;
sortSelect.addEventListener("change", () => {
  ui.sort = sortSelect.value;
  saveUi();
  render();
});
deepSearch.addEventListener("change", () => {
  ui.deep = deepSearch.checked;
  saveUi();
  render();
});

function markView() {
  viewButtons.forEach((b) =>
    b.setAttribute("aria-pressed", String(b.dataset.view === ui.view)),
  );
}
viewButtons.forEach((b) =>
  b.addEventListener("click", () => {
    ui.view = b.dataset.view;
    saveUi();
    markView();
    render();
  }),
);
markView();

const settingsBtn = document.getElementById("settingsBtn");
const settingsModal = document.getElementById("settingsModal");
const setLogin = document.getElementById("setLogin");
const setShortcutOn = document.getElementById("setShortcutOn");
const setShortcut = document.getElementById("setShortcut");
const shortcutMsg = document.getElementById("shortcutMsg");
const startupRadios = document.querySelectorAll('input[name="startupMode"]');

function applySettingsUI(s) {
  setLogin.checked = s.openAtLogin;
  startupRadios.forEach((r) => (r.checked = r.value === s.startupMode));
  setShortcutOn.checked = s.shortcutEnabled;
  setShortcut.value = s.shortcut;
  setShortcut.disabled = !s.shortcutEnabled;
  shortcutMsg.textContent =
    s.shortcutEnabled && !s.shortcutOk
      ? "That shortcut is used by another app. Try a different one."
      : "";
}
async function pushSettings(patch) {
  applySettingsUI(await window.libraryAPI.setSettings(patch));
}

settingsBtn.addEventListener("click", async () => {
  applySettingsUI(await window.libraryAPI.getSettings());
  settingsModal.hidden = false;
});
document
  .getElementById("settingsClose")
  .addEventListener("click", () => (settingsModal.hidden = true));
settingsModal.addEventListener("click", (e) => {
  if (e.target === settingsModal) settingsModal.hidden = true;
});

setLogin.addEventListener("change", () =>
  pushSettings({ openAtLogin: setLogin.checked }),
);
startupRadios.forEach((r) =>
  r.addEventListener(
    "change",
    () => r.checked && pushSettings({ startupMode: r.value }),
  ),
);
setShortcutOn.addEventListener("change", () =>
  pushSettings({ shortcutEnabled: setShortcutOn.checked }),
);

setShortcut.addEventListener("keydown", (e) => {
  e.preventDefault();
  if (["Control", "Shift", "Alt", "Meta"].includes(e.key)) return;
  const mods = [];
  if (e.ctrlKey) mods.push("Ctrl");
  if (e.altKey) mods.push("Alt");
  if (e.shiftKey) mods.push("Shift");
  if (!mods.length) return;
  let key =
    e.key.length === 1 ? e.key.toUpperCase() : e.key.replace("Arrow", "");
  if (key === " ") key = "Space";
  pushSettings({ shortcut: [...mods, key].join("+") });
});

const downloadModal = document.getElementById("downloadModal");
const dlTitle = document.getElementById("dlTitle");
const dlRows = {};
let dlBusy = null;
let dlVersion = null;

document.querySelectorAll(".dl-row").forEach((row) => {
  const kind = row.dataset.kind;
  dlRows[kind] = {
    row,
    btn: row.querySelector(".dl-btn"),
    box: row.querySelector(".dl-progress"),
    bar: row.querySelector("progress"),
    pct: row.querySelector(".dl-pct"),
    name: row.querySelector(".dl-name"),
    msg: row.querySelector(".dl-msg"),
  };
});

function fmtSize(bytes) {
  if (!bytes) return "";
  const mb = bytes / 1048576;
  return mb >= 1 ? mb.toFixed(1) + " MB" : Math.ceil(bytes / 1024) + " KB";
}

function setRowState(kind, state, msg = "") {
  const r = dlRows[kind];
  r.row.dataset.state = state;
  r.box.hidden = state === "idle" || state === "error";
  r.msg.textContent = msg;
  r.btn.textContent = {
    idle: "Download",
    downloading: "Cancel",
    done: kind === "setup" ? "Install" : "Show in folder",
    error: "Retry",
  }[state];
  r.btn.classList.toggle("secondary", state === "downloading");
  r.btn.classList.toggle("primary", state !== "downloading");
  for (const k in dlRows) {
    dlRows[k].btn.disabled = !!dlBusy && dlBusy !== k;
  }
}

function showDownloads() {
  if (!currentUpdate) return;
  const v = currentUpdate.version;
  dlTitle.textContent = `Download Stikly ${v}`;
  if (dlVersion !== v && !dlBusy) {
    dlVersion = v;
    for (const kind in dlRows) {
      const a = currentUpdate.assets?.[kind];
      dlRows[kind].name.textContent = a
        ? `${a.name}${a.size ? " · " + fmtSize(a.size) : ""}`
        : "";
      setRowState(kind, "idle");
    }
  }
  downloadModal.hidden = false;
}

Object.entries(dlRows).forEach(([kind, r]) => {
  r.btn.addEventListener("click", () => {
    const state = r.row.dataset.state || "idle";
    if (state === "downloading") return window.libraryAPI.cancelDownload();
    if (state === "done") {
      return kind === "setup"
        ? window.libraryAPI.installUpdate(kind)
        : window.libraryAPI.revealDownload(kind);
    }
    dlBusy = kind;
    r.bar.value = 0;
    r.pct.textContent = "0%";
    setRowState(kind, "downloading");
    window.libraryAPI.downloadAsset(kind);
  });
});

window.libraryAPI.onUpdateProgress((p) => {
  const r = dlRows[p.kind] || dlRows[dlBusy];
  if (!r) return;
  const kind = p.kind || dlBusy;

  if (p.error) {
    dlBusy = null;
    if (p.error === "cancelled") setRowState(kind, "idle");
    else setRowState(kind, "error", "Download failed: " + p.error);
    return;
  }

  if (p.total) {
    const pct = Math.floor((p.received / p.total) * 100);
    r.bar.value = pct;
    r.pct.textContent = `${fmtSize(p.received)} / ${fmtSize(p.total)} · ${pct}%`;
  } else {
    r.bar.removeAttribute("value");
    r.pct.textContent = fmtSize(p.received);
  }

  if (p.done) {
    dlBusy = null;
    r.bar.value = 100;
    r.pct.textContent = "100%";
    setRowState(
      kind,
      "done",
      kind === "setup"
        ? "Download complete. Click Install to continue."
        : "Download complete. Saved in your Downloads folder.",
    );
  }
});

document
  .getElementById("dlClose")
  .addEventListener("click", () => (downloadModal.hidden = true));
downloadModal.addEventListener("click", (e) => {
  if (e.target === downloadModal) downloadModal.hidden = true;
});

refresh();
