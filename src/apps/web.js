// Web panes: real browser views (WebKitGTK) laid over their pane by the Rust
// side. This keeps each one glued to its pane and hides it whenever the pane
// isn't on screen or a menu / dialog is open (native views sit above HTML).
import { listen } from "@tauri-apps/api/event";
import { api } from "../api.js";

const open = new Map(); // label -> { el, url, space, visible, rect }
let ctx = { zoom: 1, overlay: false, onEvent: null, onKey: null };

// Live page state per view (loading, progress, zoom) for the toolbar.
const state = new Map();
const subs = new Set();
const emit = () => subs.forEach((f) => f());
export const subscribeWeb = (f) => { subs.add(f); return () => subs.delete(f); };
export const webState = (label) => state.get(label) ?? IDLE;
const IDLE = { loading: false, progress: 1, zoom: 1 };
let loop = 0;

export const webLabel = (paneId) => `web-${paneId}`;
export function setWebContext(c) { ctx = { ...ctx, ...c }; tick(); }

let listening = false;
function listenOnce() {
  if (listening) return;
  listening = true;
  listen("web-event", (e) => ctx.onEvent?.(e.payload));
  listen("web-load", (e) => {
    const { label, loading, progress, zoom } = e.payload;
    state.set(label, { loading, progress, zoom });
    emit();
  });
  listen("web-key", (e) => ctx.onKey?.(e.payload));
}

function rectOf(el) {
  const r = el.getBoundingClientRect();
  const z = ctx.zoom || 1;
  return { x: Math.round(r.left * z), y: Math.round(r.top * z), w: Math.round(r.width * z), h: Math.round(r.height * z) };
}
const onScreen = (el) => el.isConnected && el.offsetWidth > 0 && !el.closest(".hidden-tab") && !document.hidden;

function tick() {
  for (const [label, w] of open) {
    const visible = !ctx.overlay && onScreen(w.el);
    const rect = visible ? rectOf(w.el) : w.rect;
    const key = `${visible}|${rect?.x},${rect?.y},${rect?.w},${rect?.h}`;
    if (key === w.key) continue;
    w.key = key;
    w.rect = rect;
    if (!w.created) {
      if (!visible) continue;
      w.created = true;
      api.webOpen(label, w.url, w.space, rect).catch((e) => console.error("web view", e));
    } else api.webBounds(label, rect ?? { x: 0, y: 0, w: 1, h: 1 }, visible).catch(() => {});
  }
}
function ensureLoop() {
  if (loop) return;
  const run = () => { tick(); loop = open.size ? requestAnimationFrame(run) : 0; };
  loop = requestAnimationFrame(run);
}

export function mountWeb(label, el, url, space) {
  listenOnce();
  const w = open.get(label) ?? { created: false };
  Object.assign(w, { el, url, space, key: null });
  open.set(label, w);
  ensureLoop();
}
export function unmountWeb(label) {
  const w = open.get(label);
  if (!w) return;
  w.el = document.createElement("div"); // detached: hidden until mounted again
  w.key = null;
  tick();
}
export const navWeb = (label, action, url) => api.webNav(label, action, url).then((zoom) => {
  if (action.startsWith("zoom")) { state.set(label, { ...webState(label), zoom }); emit(); }
}).catch(() => {});

// Close views whose panes are gone.
export function closeMissingWebs(liveIds) {
  for (const label of [...open.keys()]) {
    if (liveIds.has(label.slice(4))) continue;
    api.webClose(label).catch(() => {});
    open.delete(label);
  }
}
