const board = document.getElementById("board");
const emptyState = document.getElementById("emptyState");
const countLabel = document.getElementById("countLabel");
const searchInput = document.getElementById("searchInput");
let allNotes = [];

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function isDarkColor(color) {
  let r = 255,
    g = 245,
    b = 157;
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color);
  if (hex) {
    let h = hex[1];
    if (h.length === 3)
      h = h
        .split("")
        .map((c) => c + c)
        .join("");
    const n = parseInt(h, 16);
    r = (n >> 16) & 255;
    g = (n >> 8) & 255;
    b = n & 255;
  } else {
    const m = String(color).match(/\d+/g);
    if (m && m.length >= 3) [r, g, b] = m.map(Number);
  }
  return (r * 299 + g * 587 + b * 114) / 1000 < 140;
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

function createCard(note) {
  const card = el(
    "article",
    "note-card" + (isDarkColor(note.color) ? " dark-note" : ""),
  );
  card.tabIndex = 0;
  card.setAttribute("role", "button");
  card.setAttribute("aria-label", "Open note " + note.name);
  card.style.setProperty("--note-color", note.color);

  card.appendChild(el("div", "pin"));
  if (note.isOpen) card.appendChild(el("span", "open-badge", "Open"));

  card.appendChild(el("h3", "card-title", note.name));
  card.appendChild(buildPreview(note));

  const foot = el("div", "card-foot");
  foot.appendChild(el("span", "", formatDate(note.modified)));

  const del = el("button", "card-delete", "🗑");
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
        del.textContent = "🗑";
        del.classList.remove("armed");
      }, 3000);
      return;
    }
    clearTimeout(timer);
    await window.libraryAPI.remove(note.filePath);
    await refresh();
  });
  del.addEventListener("keydown", (e) => e.stopPropagation());
  foot.appendChild(del);
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

function render() {
  const q = searchInput.value.trim().toLowerCase();
  const notes = q
    ? allNotes.filter((n) => (n.name + " " + n.text).toLowerCase().includes(q))
    : allNotes;

  board.replaceChildren(...notes.map(createCard));

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
        : "No notes match your search.";
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

refresh();
