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

export function getSession(id, { cwd, kitty, theme, mode, onTitle, onExit }) {
  let s = sessions.get(id);
  if (s) { s.onTitle = onTitle; s.onExit = onExit; return s; }
  listenOnce();
  const look = kittyLook(kitty, theme, mode);
  const term = new Terminal({
    minimumContrastRatio: look.minimumContrastRatio,
    allowProposedApi: true,
    fontFamily: look.fontFamily,
    fontSize: look.fontSize,
    lineHeight: 1.0,
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
  el.style.padding = `${look.padding}px`;
  el.style.background = look.theme.background;
  s = { id, term, fit, el, look, started: false, exited: false, onTitle, onExit, fontSize: look.fontSize, baseFont: look.fontSize };
  sessions.set(id, s);

  term.open(el);
  try { term.loadAddon(new WebglAddon()); } catch { /* falls back to the DOM renderer */ }
  term.onData((d) => !s.exited && api.termWrite(id, d).catch(() => {}));
  term.onTitleChange((t) => s.onTitle?.(t));
  term.attachCustomKeyEventHandler((e) => kittyAction(e, s, look));
  s.cwd = cwd;
  s.kitty = kitty ?? {};
  s.stopTrail = attachCursorTrail(s);
  return s;
}

// Puts the session's terminal into `container` and starts the shell once.
export function attach(s, container, shell) {
  if (s.el.parentElement !== container) container.appendChild(s.el);
  requestAnimationFrame(() => {
    try { s.fit.fit(); } catch { /* not visible yet */ }
    const { cols, rows } = s.term;
    if (!s.started) {
      s.started = true;
      api.termSpawn(s.id, s.cwd ?? "", cols, rows, shell).catch((e) => s.term.write(`\r\n[could not start shell: ${e}]\r\n`));
    } else if (!s.exited) api.termResize(s.id, cols, rows).catch(() => {});
  });
}

export function refit(s) {
  if (!s.el.isConnected || !s.el.offsetWidth) return;
  const { cols, rows } = s.term;
  try { s.fit.fit(); } catch { return; }
  if (s.started && !s.exited && (cols !== s.term.cols || rows !== s.term.rows)) api.termResize(s.id, s.term.cols, s.term.rows).catch(() => {});
}

// The app's theme changed: the terminal follows it.
export function retheme(s, kitty, theme, mode) {
  const look = kittyLook(kitty, theme, mode);
  s.term.options.minimumContrastRatio = look.minimumContrastRatio;
  s.look.theme = look.theme;
  s.term.options.theme = look.theme;
  s.el.style.background = look.theme.background;
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
window.__scribblrTerminalText = () => [...sessions.values()].map((s) => {
  const b = s.term.buffer.active, out = [];
  for (let i = 0; i < b.length; i++) out.push(b.getLine(i)?.translateToString(true) ?? "");
  return out.join("\n");
}).join("\n---\n");
