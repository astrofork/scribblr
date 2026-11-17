// Kitty's look and keys, from your own ~/.config/kitty/kitty.conf (and its
// includes): font, size, cursor, padding, colours, scrollback, and the
// clipboard / scroll / font-size mappings. Defaults are kitty's defaults.
const MAC = /Mac/.test(navigator.platform);

// Kitty matches font names loosely ("JetBrains Mono Nerd Font" finds
// "JetBrainsMono Nerd Font"); the webview needs exact names, so try the
// usual spellings, then Nerd Font symbols for prompt icons.
function fontStack(fam) {
  const names = [];
  if (fam) {
    names.push(fam);
    const m = /^(.*?)\s*(Nerd Font.*)$/i.exec(fam);
    if (m) {
      const tight = m[1].replace(/\s+/g, "");
      names.push(`${tight} ${m[2]}`, `${tight} Nerd Font Mono`, `${tight} NF`, `${tight} NFM`, m[1]);
    }
  }
  names.push("JetBrainsMono Nerd Font Mono", "JetBrainsMono Nerd Font", "Symbols Nerd Font Mono", "Symbols Nerd Font", "JetBrains Mono");
  return [...new Set(names)].map((n) => `"${n}"`).join(", ") + ", monospace";
}

// Font, size, cursor, padding and scrollback come from kitty.conf; the
// colours always follow Scribblr's theme, so the terminal matches the app.
// Herdr's terminal look: JetBrains Mono 14 (scaled by the app zoom), a
// little line spacing, 12/14 px padding. kitty.conf's font size is used only
// when "Terminal font: kitty" is chosen in Settings.
export function kittyLook(k = {}, theme, mode = "app", opts = {}) {
  const app = theme?.colors ?? {};
  // "kitty": your kitty.conf colours (where set); "app": Scribblr's theme.
  const kc = (key) => (mode === "kitty" && k[key] && /^#?[0-9a-f]{3,8}$/i.test(k[key]) ? (k[key].startsWith("#") ? k[key] : "#" + k[key]) : null);
  const t = { ...app };
  for (let i = 0; i < 16; i++) t[`ansi${i}`] = kc(`color${i}`) ?? app[`ansi${i}`];
  t.background = kc("background") ?? app.background;
  t.terminal_foreground = kc("foreground") ?? app.terminal_foreground;
  t.cursor = kc("cursor") ?? app.cursor;
  t.selection = kc("selection_background") ?? app.selection;
  const light = (() => { const m = /^#?([0-9a-f]{6})/i.exec(t.background ?? ""); if (!m) return false; const n = parseInt(m[1], 16); return ((n >> 16) * 299 + ((n >> 8) & 255) * 587 + (n & 255) * 114) / 1000 > 140; })();
  const names = ["black", "red", "green", "yellow", "blue", "magenta", "cyan", "white"];
  const colors = {};
  names.forEach((n, i) => {
    colors[n] = t[`ansi${i}`];
    colors["bright" + n[0].toUpperCase() + n.slice(1)] = t[`ansi${i + 8}`];
  });
  const fam = (k.font_family && k.font_family !== "monospace" ? k.font_family : null);
  const shape = (k.cursor_shape ?? "block").toLowerCase();
  const num = (v, d) => (Number.isFinite(parseFloat(v)) ? parseFloat(v) : d);
  return {
    fontFamily: fontStack(opts.useKittyFont ? fam : null),
    fontSize: opts.fontSize ?? (opts.useKittyFont ? Math.max(6, Math.round(num(k.font_size, 14))) : 14),
    lineHeight: 1.1,
    cursorStyle: shape === "beam" ? "bar" : shape === "underline" ? "underline" : "block",
    cursorBlink: k.cursor_blink_interval !== "0",
    scrollback: Math.min(100000, parseInt(k.scrollback_lines ?? "2000", 10) || 2000),
    padding: opts.useKittyFont ? Math.min(40, parseInt((k.window_padding_width ?? "6").split(/\s+/)[0], 10) || 6) : null,
    // kitty's cursor trail: on when cursor_trail > 0 (yours is 1).
    trail: num(k.cursor_trail, 0) > 0,
    // Keeps text readable when a prompt's colours were made for another theme.
    minimumContrastRatio: light ? 4.5 : 3,
    trailDecay: (k.cursor_trail_decay ?? "0.1 0.4").split(/\s+/).map((x) => num(x, 0.25)),
    trailThreshold: num(k.cursor_trail_start_threshold, 2),
    theme: {
      background: t.background ?? "#000000",
      foreground: t.terminal_foreground ?? t.foreground ?? "#dddddd",
      cursor: t.cursor ?? t.foreground ?? "#cccccc",
      cursorAccent: t.background ?? "#000000",
      selectionBackground: t.selection ?? "#44475a",
      ...colors,
    },
  };
}

// kitty_mod is ctrl+shift on Linux (cmd on macOS).
const KMOD = (e) => (MAC ? e.metaKey : e.ctrlKey && e.shiftKey);

function parseMaps(k) {
  return Object.entries(k).filter(([key]) => key.startsWith("map ")).map(([, v]) => {
    const [combo, ...action] = v.split(/\s+/);
    return { combo: combo.toLowerCase(), action: action.join(" ") };
  });
}

function comboMatches(combo, e) {
  const parts = combo.replace("kitty_mod", MAC ? "cmd" : "ctrl+shift").split("+");
  const key = parts.pop();
  const want = new Set(parts);
  const names = { plus: "+", equal: "=", minus: "-", underscore: "_", page_up: "pageup", page_down: "pagedown", kp_add: "+", kp_subtract: "-", kp_0: "0" };
  const k = e.key.toLowerCase() === " " ? "space" : e.key.toLowerCase();
  const target = names[key] ?? key;
  return k === target && e.ctrlKey === want.has("ctrl") && e.shiftKey === (want.has("shift") || (target.length === 1 && /[+_]/.test(target) && e.shiftKey)) && e.altKey === want.has("alt");
}

function run(action, s) {
  const t = s.term;
  const [name, ...args] = action.split(/\s+/);
  switch (name) {
    case "copy_to_clipboard": if (t.hasSelection()) navigator.clipboard.writeText(t.getSelection()); return true;
    case "copy_or_interrupt":
      if (t.hasSelection()) { navigator.clipboard.writeText(t.getSelection()); t.clearSelection(); return true; }
      return false; // let ^C through
    case "paste_from_clipboard": navigator.clipboard.readText().then((x) => t.paste(x)).catch(() => {}); return true;
    case "scroll_page_up": t.scrollPages(-1); return true;
    case "scroll_page_down": t.scrollPages(1); return true;
    case "scroll_line_up": t.scrollLines(-1); return true;
    case "scroll_line_down": t.scrollLines(1); return true;
    case "scroll_home": t.scrollToTop(); return true;
    case "scroll_end": t.scrollToBottom(); return true;
    case "clear_terminal": t.clear(); return true;
    case "change_font_size": {
      const v = args[args.length - 1];
      s.fontSize = v === "0" ? s.baseFont : v.startsWith("+") || v.startsWith("-") ? Math.max(6, s.fontSize + parseFloat(v)) : parseFloat(v);
      t.options.fontSize = s.fontSize;
      // Refit and tell the shell the new size (vim/nvim redraw for it).
      // (The new cell size is measured a moment later, so fit twice.)
      requestAnimationFrame(() => { s.refit?.(); setTimeout(() => s.refit?.(), 90); });
      return true;
    }
    default: return null; // not ours
  }
}

// Kitty's default shortcuts, then the user's `map` lines (later wins).
const DEFAULTS = [
  ["kitty_mod+c", "copy_to_clipboard"], ["kitty_mod+v", "paste_from_clipboard"],
  ["shift+insert", "paste_from_clipboard"],
  ["kitty_mod+up", "scroll_line_up"], ["kitty_mod+down", "scroll_line_down"],
  ["kitty_mod+page_up", "scroll_page_up"], ["kitty_mod+page_down", "scroll_page_down"],
  ["kitty_mod+home", "scroll_home"], ["kitty_mod+end", "scroll_end"],
  ["kitty_mod+equal", "change_font_size all +2.0"], ["kitty_mod+plus", "change_font_size all +2.0"],
  ["kitty_mod+minus", "change_font_size all -2.0"], ["kitty_mod+backspace", "change_font_size all 0"],
  ["kitty_mod+delete", "clear_terminal reset active"],
];

// xterm's key hook: false = we handled it (xterm ignores the key).
export function kittyAction(e, s, look) {
  if (e.type !== "keydown") return true;
  s.maps ??= [...DEFAULTS.map(([combo, action]) => ({ combo, action })), ...parseMaps(s.kitty ?? {})];
  for (let i = s.maps.length - 1; i >= 0; i--) {
    const m = s.maps[i];
    if (!comboMatches(m.combo, e)) continue;
    const r = run(m.action, s);
    if (r === null) continue;
    if (r) { e.preventDefault(); return false; }
    return true;
  }
  void KMOD; void look;
  return true;
}
