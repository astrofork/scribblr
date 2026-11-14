// Themes in Herdr's format. Built-ins are Herdr's own palettes (graphite, ink,
// moss, paper, atom-one-dark, nightbloom); theme files from
// ~/.config/scribblr/themes and ~/.config/herdr-app/themes are added too.
import builtin from "./themes/builtin.json";

const hex = (c) => {
  const m = /^#?([0-9a-f]{6})/i.exec(c ?? "");
  const n = m ? parseInt(m[1], 16) : 0;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const toHex = (rgb) => "#" + rgb.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0")).join("");
const mix = (a, b, t) => toHex(hex(a).map((v, i) => v + (hex(b)[i] - v) * t));
const lum = (c) => {
  const [r, g, b] = hex(c).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

// Panel colors from a terminal palette, the way Herdr derives them.
export function derive(file) {
  const bg = file.background ?? "#17191d";
  const fg = file.foreground ?? "#eeeeef";
  const ansi = file.ansi ?? [];
  const light = lum(bg) > 0.5;
  const black = "#000000", white = "#ffffff";
  const shade = light ? black : white;
  const c = {
    background: bg, surface: bg, foreground: fg, terminal_foreground: fg,
    selection: file.selection ?? mix(bg, fg, 0.25), cursor: file.cursor ?? fg,
    canvas: light ? mix(bg, black, 0.02) : mix(bg, black, 0.2),
    chrome: light ? mix(bg, black, 0.055) : mix(bg, black, 0.32),
    popover: light ? bg : mix(bg, white, 0.07),
    raised: light ? mix(bg, black, 0.035) : mix(bg, white, 0.1),
    hover: shade + (light ? "0c" : "0e"), selected: shade + (light ? "12" : "17"),
    border: shade + (light ? "17" : "18"), input: shade + (light ? "26" : "24"),
    muted: mix(fg, bg, 0.38), dim: mix(fg, bg, 0.58),
    accent: ansi[4] ?? "#96b2d7", accent_foreground: light ? white : bg,
    solid: fg, solid_foreground: bg, ring: mix(fg, bg, 0.3),
    working: ansi[3] ?? "#e5c07b", blocked: ansi[1] ?? "#f0705f", done: ansi[4] ?? "#76a8ff",
    idle: mix(fg, bg, 0.58), unknown: mix(fg, bg, 0.58),
  };
  ansi.forEach((v, i) => { c[`ansi${i}`] = v; });
  return { light, colors: { ...c, ...(file.colors ?? {}) } };
}

export function allThemes(userFiles) {
  const out = builtin.map((t) => ({ ...t, source: "built-in" }));
  for (const f of userFiles ?? []) {
    try {
      const t = derive(JSON.parse(f.json));
      const at = out.findIndex((o) => o.name === f.name);
      const entry = { name: f.name, light: t.light, colors: t.colors, source: f.source };
      // A built-in palette Herdr already derived stays; other files are added.
      if (at < 0) out.push(entry);
      else if (f.source === "scribblr") out[at] = entry;
    } catch { /* a broken theme file is skipped */ }
  }
  return out;
}

export function applyTheme(t) {
  const root = document.documentElement;
  for (const [k, v] of Object.entries(t.colors)) root.style.setProperty(`--${k.replace(/_/g, "-")}`, v);
  root.dataset.appearance = t.light ? "light" : "dark";
}
