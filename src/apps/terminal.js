// Terminal sessions: one xterm.js terminal + one real shell (PTY, Rust side)
// per pane. Sessions outlive their React component, so a terminal keeps
// running while you switch tabs or spaces, swap panes or enter focus mode;
// it ends when its pane closes (App calls disposeMissing) or the shell exits.
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { listen } from "@tauri-apps/api/event";
import { openUrl } from "@tauri-apps/plugin-opener";
import "@xterm/xterm/css/xterm.css";
import { api } from "../api.js";
import { kittyLook, kittyAction } from "./kitty.js";
import { attachCursorTrail } from "./cursorTrail.js";

const sessions = new Map();
const decoder = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

// One listener for every terminal's output.
let listening = null;
function listenOnce() {
  if (listening) return listening;
  listening = Promise.all([
    listen("term-data", (e) => sessions.get(e.payload.id)?.term.write(decoder(e.payload.data))),
    listen("term-exit", (e) => {
      const s = sessions.get(e.payload.id);
      if (s) { s.exited = true; s.onExit?.(); }
    }),
  ]);
  return listening;
}

export function getSession(id, { cwd, kitty, theme, mode, opts, onTitle, onExit }) {
  let s = sessions.get(id);
  if (s) { s.onTitle = onTitle; s.onExit = onExit; return s; }
  listenOnce();
  const look = kittyLook(kitty, theme, mode, opts);
  const term = new Terminal({
    minimumContrastRatio: look.minimumContrastRatio,
    allowProposedApi: true,
    fontFamily: look.fontFamily,
    fontSize: look.fontSize,
    lineHeight: look.lineHeight,
    cursorStyle: look.cursorStyle,
    cursorBlink: look.cursorBlink,
    scrollback: look.scrollback,
    theme: look.theme,
    macOptionIsMeta: true,
    drawBoldTextInBrightColors: false,
  });
  const fit = new FitAddon();
  term.loadAddon(fit);
  term.loadAddon(new WebLinksAddon((_e, uri) => openUrl(uri).catch(() => {})));
  const uni = new Unicode11Addon();
  term.loadAddon(uni);
  term.unicode.activeVersion = "11";
  const el = document.createElement("div");
  el.className = "term-host";
  el.style.background = look.theme.background;
  s = { id, term, fit, el, look, started: false, exited: false, onTitle, onExit, fontSize: look.fontSize, baseFont: look.fontSize };
  sessions.set(id, s);

  term.open(el);
  // Padding goes on xterm's own element: the fit addon subtracts that one
  // (padding on the host made it fit one row too many, cutting the last).
  s0pad(look);
  term.element.style.padding = `${PAD.y}px ${PAD.x}px`;
  try { term.loadAddon(new WebglAddon()); } catch { /* falls back to the DOM renderer */ }
  term.onData((d) => !s.exited && api.termWrite(id, d).catch(() => {}));
  term.onTitleChange((t) => s.onTitle?.(t));
  // Shells that recolour the terminal (OSC 4/10/11/12…, e.g. a wallpaper
  // theme script in fish) would fight the app theme; xterm also can't read
  // the "11;[100]#rrggbb" form, so only the text colour changed and output
  // came out pale on a light background. With "Match the app theme" these
  // are ignored; with "Kitty's colours" the background form is understood.
  s.mode = mode;
  for (const code of [4, 10, 11, 12, 17, 19, 104, 110, 111, 112, 708]) {
    term.parser.registerOscHandler(code, (data) => {
      if (s.mode !== "kitty") return true; // swallowed: the theme decides
      if (code === 11 || code === 708) {
        const m = /^(?:\[\d+\])?(#[0-9a-f]{6})$/i.exec(data.trim());
        if (m) { term.options.theme = { ...term.options.theme, background: m[1] }; s.edgeBg = null; return true; }
      }
      return false; // xterm's own handling
    });
  }
  // Like Ghostty / Herdr: the padding takes the colour of the edge cells, so
  // full-screen apps (nvim, htop) look edge-to-edge instead of framed.
  let edgeQueued = false;
  term.onRender(() => {
    if (edgeQueued) return;
    edgeQueued = true;
    requestAnimationFrame(() => { edgeQueued = false; paintEdges(s); });
  });
  term.attachCustomKeyEventHandler((e) => kittyAction(e, s, look));
  s.cwd = cwd;
  s.kitty = kitty ?? {};
  s.refit = () => refit(s);
  s.stopTrail = attachCursorTrail(s);
  return s;
}

// Base padding (Herdr's 12 / 14 px) and the helpers that keep the grid snug.
const PAD = { x: 14, y: 12 };
function s0pad(look) { if (look.padding != null) { PAD.x = PAD.y = look.padding; } }

function balance(s) {
  const d = s.term._core?._renderService?.dimensions?.css?.cell;
  if (!d?.width || !d?.height) return;
  const w = s.term.element.clientWidth, h = s.term.element.clientHeight;
  const extraX = Math.max(0, w - 2 * PAD.x - s.term.cols * d.width);
  const extraY = Math.max(0, h - 2 * PAD.y - s.term.rows * d.height);
  s.term.element.style.padding = `${PAD.y + Math.floor(extraY / 2)}px ${PAD.x + Math.floor(extraX / 2)}px`;
}

const toHex = (n) => "#" + n.toString(16).padStart(6, "0");
function xterm256(i) {
  if (i < 232) { const c = i - 16, v = [0, 95, 135, 175, 215, 255]; return `rgb(${v[Math.floor(c / 36)]},${v[Math.floor(c / 6) % 6]},${v[c % 6]})`; }
  const g = 8 + (i - 232) * 10; return `rgb(${g},${g},${g})`;
}
function cellBg(s, x, y) {
  const line = s.term.buffer.active.getLine(s.term.buffer.active.viewportY + y);
  const cell = line?.getCell(x);
  const theme = s.term.options.theme ?? {};
  if (!cell || cell.isBgDefault()) return theme.background;
  if (cell.isBgRGB()) return toHex(cell.getBgColor());
  const i = cell.getBgColor();
  const names = ["black", "red", "green", "yellow", "blue", "magenta", "cyan", "white"];
  if (i < 16) return theme[i < 8 ? names[i] : "bright" + names[i - 8][0].toUpperCase() + names[i - 8].slice(1)];
  return xterm256(i);
}
// Padding colour = the colour of the grid's edge (full-screen apps), else the theme's.
function paintEdges(s) {
  const t = s.term;
  let bg = t.options.theme?.background;
  if (t.buffer.active.type === "alternate" && t.rows > 2) {
    const a = cellBg(s, 0, 1), b = cellBg(s, t.cols - 1, 1);
    if (a && a === b) bg = a;
  }
  if (bg && s.edgeBg !== bg) {
    s.edgeBg = bg;
    t.element.style.background = bg;
    s.el.style.background = bg;
  }
}

// Puts the session's terminal into `container` and starts the shell once.
// The shell starts only once the pane has settled at its real size (two
// frames in a row the same), so the first prompt isn't drawn for a narrow
// half-laid-out pane and then repainted (which left broken prompt copies).
export function attach(s, container, shell) {
  if (s.el.parentElement !== container) container.appendChild(s.el);
  let last = "", tries = 0;
  // The terminal font may still be loading: measuring cells with a fallback
  // font gave too many rows (the bottom line was cut off). Wait for fonts.
  const fontsReady = document.fonts?.ready ?? Promise.resolve();
  const settle = () => {
    s.term.element.style.padding = `${PAD.y}px ${PAD.x}px`;
    try { s.fit.fit(); } catch { /* not visible yet */ }
    balance(s);
    const size = `${s.term.cols}x${s.term.rows}`;
    if ((size !== last || !s.el.offsetWidth) && tries++ < 30) { last = size; requestAnimationFrame(settle); return; }
    if (!s.started) {
      s.started = true;
      s.sent = size;
      api.termSpawn(s.id, s.cwd ?? "", s.term.cols, s.term.rows, shell).catch((e) => s.term.write(`\r\n[could not start shell: ${e}]\r\n`));
    } else sendSize(s);
  };
  fontsReady.then(() => requestAnimationFrame(settle));
}

// A font finishing loading changes the cell size: refit every terminal.
document.fonts?.addEventListener?.("loadingdone", () => {
  for (const s of sessions.values()) { s.term.options.fontFamily = s.term.options.fontFamily; refit(s); }
});

// Tell the shell its new size once resizing stops (each SIGWINCH makes fish
// and zsh repaint their prompt; a burst of them left stacked prompt copies).
function sendSize(s) {
  clearTimeout(s.sizeTimer);
  s.sizeTimer = setTimeout(() => {
    const size = `${s.term.cols}x${s.term.rows}`;
    if (!s.started || s.exited || size === s.sent) return;
    s.sent = size;
    api.termResize(s.id, s.term.cols, s.term.rows).catch(() => {});
  }, 120);
}

export function refit(s) {
  if (!s.el.isConnected || !s.el.offsetWidth) return;
  // Fit with the base padding, then share the leftover (less than one cell)
  // evenly on all sides, so the grid sits centred with no odd gap.
  s.term.element.style.padding = `${PAD.y}px ${PAD.x}px`;
  try { s.fit.fit(); } catch { return; }
  balance(s);
  // Repaint everything at the new cell size (no leftovers of the old grid).
  s.term.refresh(0, s.term.rows - 1);
  sendSize(s);
}

// The app's theme changed: the terminal follows it.
export function retheme(s, kitty, theme, mode, opts) {
  s.mode = mode;
  const look = kittyLook(kitty, theme, mode, opts);
  if (s.term.options.fontSize !== look.fontSize || s.term.options.fontFamily !== look.fontFamily) {
    s.term.options.fontSize = look.fontSize; s.term.options.fontFamily = look.fontFamily;
    s.baseFont = s.fontSize = look.fontSize;
    s0pad(look);
    requestAnimationFrame(() => { refit(s); setTimeout(() => refit(s), 90); });
  }
  s.term.options.minimumContrastRatio = look.minimumContrastRatio;
  s.look.theme = look.theme;
  s.term.options.theme = look.theme;
  s.edgeBg = null;
  paintEdges(s);
}

// Ends sessions whose panes are gone.
export function disposeMissing(liveIds) {
  for (const [id, s] of sessions) {
    if (liveIds.has(id)) continue;
    api.termKill(id).catch(() => {});
    s.stopTrail?.();
    s.term.dispose();
    s.el.remove();
    sessions.delete(id);
  }
}

export const allSessions = () => sessions;

// Read-only peek used by the end-to-end tests (e2e/run.py): the visible text
// of every terminal. The WebGL renderer draws to a canvas, so tests can't
// read the screen from the page.
window.__scribblrTerminalInfo = () => [...sessions.values()].map((s) => {
  const d = s.term._core?._renderService?.dimensions;
  return { rows: s.term.rows, cols: s.term.cols, cellH: d?.css?.cell?.height, canvasH: d?.css?.canvas?.height, proposed: s.fit.proposeDimensions() };
});
window.__scribblrCellInfo = (text) => [...sessions.values()].map((s) => {
  const b = s.term.buffer.active;
  for (let y = 0; y < b.length; y++) {
    const line = b.getLine(y), str = line?.translateToString(true) ?? "";
    const x = str.indexOf(text);
    if (x >= 0) { const c = line.getCell(x); return { y, x, fgMode: c.isFgRGB() ? "rgb" : c.isFgPalette() ? "palette" : "default", fg: c.getFgColor(), dim: c.isDim(), bold: c.isBold(), italic: c.isItalic(), bgDefault: c.isBgDefault(), theme: { fg: s.term.options.theme.foreground, bg: s.term.options.theme.background, black: s.term.options.theme.black } }; }
  }
  return null;
});
window.__scribblrTerminalText = () => [...sessions.values()].map((s) => {
  const b = s.term.buffer.active, out = [];
  for (let i = 0; i < b.length; i++) out.push(b.getLine(i)?.translateToString(true) ?? "");
  return out.join("\n");
}).join("\n---\n");
