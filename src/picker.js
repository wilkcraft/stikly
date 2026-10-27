const svCanvas = document.getElementById("svCanvas");
const hueCanvas = document.getElementById("hueCanvas");
const svCtx = svCanvas.getContext("2d");
const hueCtx = hueCanvas.getContext("2d");
const pickerPreview = document.getElementById("pickerPreview");
const pickerHex = document.getElementById("pickerHex");

let pickerHue = 0,
  pickerSat = 1,
  pickerVal = 1;

function hsvToRgb(h, s, v) {
  let r, g, b;
  const i = Math.floor(h * 6);
  const f = h * 6 - i;
  const p = v * (1 - s);
  const q = v * (1 - f * s);
  const t = v * (1 - (1 - f) * s);
  switch (i % 6) {
    case 0:
      r = v;
      g = t;
      b = p;
      break;
    case 1:
      r = q;
      g = v;
      b = p;
      break;
    case 2:
      r = p;
      g = v;
      b = t;
      break;
    case 3:
      r = p;
      g = q;
      b = v;
      break;
    case 4:
      r = t;
      g = p;
      b = v;
      break;
    case 5:
      r = v;
      g = p;
      b = q;
      break;
  }
  return {
    r: Math.round(r * 255),
    g: Math.round(g * 255),
    b: Math.round(b * 255),
  };
}

function rgbToHsv(r, g, b) {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b),
    min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h /= 6;
    if (h < 0) h += 1;
  }
  const s = max === 0 ? 0 : d / max;
  const v = max;
  return { h, s, v };
}

function rgbToHex(r, g, b) {
  return (
    "#" +
    [r, g, b]
      .map((x) =>
        Math.max(0, Math.min(255, x))
          .toString(16)
          .padStart(2, "0"),
      )
      .join("")
  );
}

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

function drawHueCanvas() {
  const w = hueCanvas.width,
    h = hueCanvas.height;
  const grad = hueCtx.createLinearGradient(0, 0, w, 0);
  for (let i = 0; i <= 6; i++) {
    grad.addColorStop(i / 6, `hsl(${i * 60}, 100%, 50%)`);
  }
  hueCtx.fillStyle = grad;
  hueCtx.fillRect(0, 0, w, h);
}

function drawSvCanvas() {
  const w = svCanvas.width,
    h = svCanvas.height;
  const { r, g, b } = hsvToRgb(pickerHue, 1, 1);

  svCtx.fillStyle = `rgb(${r}, ${g}, ${b})`;
  svCtx.fillRect(0, 0, w, h);

  const whiteGrad = svCtx.createLinearGradient(0, 0, w, 0);
  whiteGrad.addColorStop(0, "rgba(255,255,255,1)");
  whiteGrad.addColorStop(1, "rgba(255,255,255,0)");
  svCtx.fillStyle = whiteGrad;
  svCtx.fillRect(0, 0, w, h);

  const blackGrad = svCtx.createLinearGradient(0, 0, 0, h);
  blackGrad.addColorStop(0, "rgba(0,0,0,0)");
  blackGrad.addColorStop(1, "rgba(0,0,0,1)");
  svCtx.fillStyle = blackGrad;
  svCtx.fillRect(0, 0, w, h);
}

let currentOrigin = "text";

function applyPickerBackground(hex) {
  document.body.style.setProperty("--picker-bg", hex);
  const { r, g, b } = hexToRgb(hex);
  const luminance = (r * 299 + g * 587 + b * 114) / 1000;
  document.body.classList.toggle("dark-bg", luminance < 140);
}

function updatePreview() {
  const { r, g, b } = hsvToRgb(pickerHue, pickerSat, pickerVal);
  const hex = rgbToHex(r, g, b);
  pickerPreview.style.background = hex;
  pickerHex.value = hex;

  if (currentOrigin === "note") {
    applyPickerBackground(hex);
  }

  return hex;
}

function applyPicked() {
  window.pickerAPI.sendColor(updatePreview());
}

let draggingSv = false;
function pickFromSvEvent(e) {
  const rect = svCanvas.getBoundingClientRect();
  let x = e.clientX - rect.left;
  let y = e.clientY - rect.top;
  x = Math.max(0, Math.min(svCanvas.width, x));
  y = Math.max(0, Math.min(svCanvas.height, y));
  pickerSat = x / svCanvas.width;
  pickerVal = 1 - y / svCanvas.height;
  applyPicked();
}
svCanvas.addEventListener("mousedown", (e) => {
  draggingSv = true;
  pickFromSvEvent(e);
});
window.addEventListener("mousemove", (e) => {
  if (draggingSv) pickFromSvEvent(e);
});
window.addEventListener("mouseup", () => {
  draggingSv = false;
});

let draggingHue = false;
function pickFromHueEvent(e) {
  const rect = hueCanvas.getBoundingClientRect();
  let x = e.clientX - rect.left;
  x = Math.max(0, Math.min(hueCanvas.width, x));
  pickerHue = x / hueCanvas.width;
  drawSvCanvas();
  applyPicked();
}
hueCanvas.addEventListener("mousedown", (e) => {
  draggingHue = true;
  pickFromHueEvent(e);
});
window.addEventListener("mousemove", (e) => {
  if (draggingHue) pickFromHueEvent(e);
});
window.addEventListener("mouseup", () => {
  draggingHue = false;
});

function parseColorToHex(str) {
  if (!str) return null;
  str = str.trim();
  if (/^#[0-9a-fA-F]{6}$/.test(str)) return str;
  if (/^#[0-9a-fA-F]{3}$/.test(str)) {
    const { r, g, b } = hexToRgb(str);
    return rgbToHex(r, g, b);
  }
  const match = str.match(/\d+/g);
  if (match && match.length >= 3) {
    const [r, g, b] = match.map(Number);
    return rgbToHex(r, g, b);
  }
  return null;
}

window.pickerAPI.onInit(({ origin, currentColor, noteColor }) => {
  currentOrigin = origin || "text";

  const parsedCurrent = parseColorToHex(currentColor);
  if (parsedCurrent) {
    const { r, g, b } = hexToRgb(parsedCurrent);
    const { h, s, v } = rgbToHsv(r, g, b);
    pickerHue = h;
    pickerSat = s;
    pickerVal = v;
  }

  if (currentOrigin === "note") {
    applyPickerBackground(parsedCurrent || "#ffffff");
  } else {
    const parsedNote = parseColorToHex(noteColor);
    if (parsedNote) applyPickerBackground(parsedNote);
  }

  drawHueCanvas();
  drawSvCanvas();
  updatePreview();
});

window.pickerAPI.onNoteColorChanged(({ noteColor }) => {
  if (currentOrigin === "note") return;
  const parsed = parseColorToHex(noteColor);
  if (parsed) applyPickerBackground(parsed);
});

pickerHex.addEventListener("change", () => {
  const val = pickerHex.value.trim();
  if (/^#[0-9a-fA-F]{6}$/.test(val)) window.pickerAPI.sendColor(val);
});

document
  .getElementById("closeBtn")
  .addEventListener("click", () => window.pickerAPI.close());
