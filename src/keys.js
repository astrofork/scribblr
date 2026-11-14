// keys.json, Herdr's format: { "global": { "ctrl-shift-t": "tab.new", ... } }.
// Defaults follow Herdr's own bindings. ~/.config/scribblr/keys.json overrides them.
export const DEFAULT_KEYS = {
  global: {
    "alt-1": "space.select:1", "alt-2": "space.select:2", "alt-3": "space.select:3",
    "alt-4": "space.select:4", "alt-5": "space.select:5", "alt-6": "space.select:6",
    "alt-7": "space.select:7", "alt-8": "space.select:8", "alt-9": "space.select:9",
    "alt-h": "pane.go:left", "alt-j": "pane.go:down", "alt-k": "pane.go:up", "alt-l": "pane.go:right",
    "alt-left": "pane.go:left", "alt-right": "pane.go:right",
    "ctrl-1": "tab.select:1", "ctrl-2": "tab.select:2", "ctrl-3": "tab.select:3",
    "ctrl-4": "tab.select:4", "ctrl-5": "tab.select:5", "ctrl-6": "tab.select:6",
    "ctrl-7": "tab.select:7", "ctrl-8": "tab.select:8", "ctrl-9": "tab.select:9",
    "ctrl-pagedown": "tab.next", "ctrl-pageup": "tab.prev",
    "ctrl-tab": "tab.next", "ctrl-shift-tab": "tab.prev", "alt-]": "tab.next", "alt-[": "tab.prev",
    "ctrl-shift-pagedown": "space.next", "ctrl-shift-pageup": "space.prev",
    "ctrl-shift-/": "app.help", "ctrl-shift-?": "app.help",
    "ctrl-shift-b": "layout.toggle:sidebar",
    "ctrl-shift-n": "space.new",
    "ctrl-shift-t": "tab.new",
    "ctrl-shift-k": "app.picker",
    "ctrl-shift-p": "app.palette",
    "ctrl-,": "app.settings",
    "ctrl-shift-o": "pane.split:right",
    "ctrl-shift-d": "pane.split:down",
    "ctrl-shift-enter": "new.terminal",
    "ctrl-shift-m": "new.note",
    "ctrl-shift-a": "calendar.open",
    "ctrl-shift-f": "pane.full",
    "f11": "web.ultra",
    "alt-shift-h": "pane.swap:left", "alt-shift-j": "pane.swap:down", "alt-shift-k": "pane.swap:up", "alt-shift-l": "pane.swap:right",
    "ctrl-shift-w": "tab.close",
    "ctrl-shift-x": "pane.close",
    "ctrl-shift-z": "pane.zoom",
    "ctrl-shift-e": "panel.toggle:files",
    "ctrl-shift-g": "graph.open",
    "ctrl-shift-l": "link.insert",
    "ctrl-shift-y": "panel.toggle:links",
    "ctrl-alt-=": "app.zoom_in", "ctrl-alt--": "app.zoom_out", "ctrl-alt-0": "app.zoom_reset",
    "f2": "tab.rename", "shift-f2": "space.rename",
  },
};

const NAMED = {
  ArrowLeft: "left", ArrowRight: "right", ArrowUp: "up", ArrowDown: "down",
  PageUp: "pageup", PageDown: "pagedown", Tab: "tab", Enter: "enter", Escape: "escape",
  Backspace: "backspace", Delete: "delete", Home: "home", End: "end", " ": "space",
};
const CODES = { Minus: "-", Equal: "=", Comma: ",", Period: ".", Slash: "/", BracketLeft: "[", BracketRight: "]", Semicolon: ";", Quote: "'", Backquote: "`", Backslash: "\\" };

// "ctrl-shift-t" for a keydown. Letters by the letter typed (so Colemak,
// Dvorak... get the letter on their key, not the QWERTY one); digits and
// punctuation by physical key, so shift doesn't change the name.
export function comboOf(e) {
  let k;
  if (/^[a-z]$/i.test(e.key)) k = e.key.toLowerCase();
  else if (/^Key[A-Z]$/.test(e.code)) k = e.code.slice(3).toLowerCase();
  else if (/^Digit\d$/.test(e.code)) k = e.code.slice(5);
  else if (CODES[e.code]) k = CODES[e.code];
  else if (/^F\d+$/.test(e.key)) k = e.key.toLowerCase();
  else k = NAMED[e.key] ?? e.key.toLowerCase();
  if (["control", "shift", "alt", "meta"].includes(k)) return null;
  return [e.ctrlKey && "ctrl", e.altKey && "alt", e.shiftKey && "shift", e.metaKey && "cmd", k].filter(Boolean).join("-");
}

// Normalise a binding name to comboOf's order: "shift-ctrl-T" -> "ctrl-shift-t".
export function normal(combo) {
  const parts = combo.toLowerCase().endsWith("--") ? [...combo.slice(0, -2).split("-"), "-"] : combo.split("-");
  const key = parts.pop();
  const mods = new Set(parts.map((p) => p.toLowerCase()));
  return [mods.has("ctrl") && "ctrl", mods.has("alt") && "alt", mods.has("shift") && "shift", (mods.has("cmd") || mods.has("super")) && "cmd", key.toLowerCase()].filter(Boolean).join("-");
}

export function buildKeymap(user) {
  const merged = { ...DEFAULT_KEYS.global, ...(user?.global ?? {}) };
  return Object.fromEntries(Object.entries(merged).map(([k, v]) => [normal(k), v]));
}

// "space.select:3" -> ["space.select", "3"]; objects -> [command, args].
export function parseAction(action) {
  if (typeof action === "object" && action) return [action.command, action.args ?? {}];
  const i = action.indexOf(":");
  return i < 0 ? [action, undefined] : [action.slice(0, i), action.slice(i + 1)];
}

const MAC = /Mac/.test(navigator.platform);
export function prettyKey(combo) {
  if (!combo) return "";
  const parts = combo.endsWith("--") ? [...combo.slice(0, -2).split("-"), "-"] : combo.split("-");
  const names = { ctrl: MAC ? "⌃" : "Ctrl+", shift: MAC ? "⇧" : "Shift+", alt: MAC ? "⌥" : "Alt+", cmd: MAC ? "⌘" : "Super+" };
  return parts.map((p) => names[p] ?? (p.length === 1 ? p.toUpperCase() : p[0].toUpperCase() + p.slice(1))).join("");
}

// Our key listener is registered when this module loads, before Excalidraw
// mounts: Excalidraw also listens on window (capture) and would otherwise see
// Ctrl+Shift+P / Ctrl+Shift+G first. The App sets keyHandler.current.
export const keyHandler = { current: null };
window.addEventListener("keydown", (e) => {
  if (keyHandler.current?.(e)) { e.preventDefault(); e.stopImmediatePropagation(); }
}, true);
