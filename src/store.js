// The app's state, the same shape as Herdr's: spaces, each with tabs; a tab
// is a tree of panes (splits), each pane shows one drawing file.
export const uid = (p) => p + Math.random().toString(36).slice(2, 10);
// A pane shows one thing: a file (drawing, note, calendar), the graph
// ("scribblr:graph"), the calendar view ("scribblr:calendar") or a terminal
// ("scribblr:terminal", with `cwd`).
export const newPane = (file = null, extra = {}) => ({ type: "pane", id: uid("p"), file, ...extra });
export const newTab = (file = null, extra = {}) => {
  const p = newPane(file, extra);
  return { id: uid("t"), name: null, root: p, focused: p.id, zoomed: null, full: null };
};
export const SPACE_COLORS = ["ansi6", "ansi3", "ansi4", "ansi5", "ansi2", "ansi1"];

export const initialState = {
  spaces: [],
  activeSpace: null,
  sidebar: { width: 268, collapsed: false },
  panel: { open: false, width: 368, view: "files" },
  look: { dark: "graphite", light: "paper", appearance: null, zoom: null },
};

// --- pane trees ---
export const panesOf = (node) => (node.type === "pane" ? [node] : [...panesOf(node.a), ...panesOf(node.b)]);
const mapNode = (node, fn) => {
  const r = fn(node);
  if (r !== node || node.type === "pane") return r;
  const a = mapNode(node.a, fn), b = mapNode(node.b, fn);
  return a === node.a && b === node.b ? node : { ...node, a, b };
};
const removePane = (node, id) => {
  if (node.type === "pane") return node.id === id ? null : node;
  const a = removePane(node.a, id), b = removePane(node.b, id);
  if (!a) return b;
  if (!b) return a;
  return a === node.a && b === node.b ? node : { ...node, a, b };
};
// Pane rectangles in a unit square, for alt+h/j/k/l.
export const rects = (node, x = 0, y = 0, w = 1, h = 1, out = []) => {
  if (node.type === "pane") { out.push({ id: node.id, x, y, w, h }); return out; }
  const r = node.ratio ?? 0.5;
  if (node.dir === "row") { rects(node.a, x, y, w * r, h, out); rects(node.b, x + w * r, y, w * (1 - r), h, out); }
  else { rects(node.a, x, y, w, h * r, out); rects(node.b, x, y + h * r, w, h * (1 - r), out); }
  return out;
};

// The pane next to the focused one in a direction (nearest centre).
export function neighbour(t, dir) {
  const rs = rects(t.root);
  const cur = rs.find((r) => r.id === t.focused);
  if (!cur) return null;
  const cx = cur.x + cur.w / 2, cy = cur.y + cur.h / 2, e = 1e-6;
  const cand = rs.filter((r) => r.id !== cur.id && (
    dir === "left" ? r.x + r.w <= cur.x + e : dir === "right" ? r.x >= cur.x + cur.w - e
      : dir === "up" ? r.y + r.h <= cur.y + e : r.y >= cur.y + cur.h - e));
  const d = (r) => Math.hypot(r.x + r.w / 2 - cx, r.y + r.h / 2 - cy);
  return cand.sort((p, q) => d(p) - d(q))[0]?.id ?? null;
}

export const allPaneIds = (s) => new Set(s.spaces.flatMap((sp) => sp.tabs.flatMap((t) => panesOf(t.root).map((p) => p.id))));

export const activeSpace = (s) => s.spaces.find((sp) => sp.id === s.activeSpace) ?? s.spaces[0] ?? null;
export const activeTab = (s) => {
  const sp = activeSpace(s);
  return sp?.tabs.find((t) => t.id === sp.activeTab) ?? sp?.tabs[0] ?? null;
};

const withSpace = (s, id, fn) => ({ ...s, spaces: s.spaces.map((sp) => (sp.id === id ? fn(sp) : sp)) });
const withTab = (s, fn, tabId) => {
  const sp = activeSpace(s);
  if (!sp) return s;
  const tid = tabId ?? sp.activeTab;
  return withSpace(s, sp.id, (x) => ({ ...x, tabs: x.tabs.map((t) => (t.id === tid ? fn(t) : t)) }));
};
const move = (arr, from, to) => {
  const a = [...arr];
  const [it] = a.splice(from, 1);
  a.splice(Math.max(0, Math.min(a.length, to)), 0, it);
  return a;
};
const cycle = (list, cur, d) => {
  if (!list.length) return null;
  const i = list.findIndex((x) => x.id === cur);
  return list[(i + d + list.length) % list.length].id;
};

export function reducer(s, a) {
  switch (a.type) {
    case "init": return { ...initialState, ...a.state, panel: { ...initialState.panel, ...(a.state?.panel ?? {}) }, look: { ...initialState.look, ...(a.state?.look ?? {}) } };

    // --- spaces ---
    case "space.add": {
      const used = s.spaces.map((x) => x.color);
      const color = SPACE_COLORS.reduce((best, c) => (used.filter((u) => u === c).length < used.filter((u) => u === best).length ? c : best));
      const space = { id: uid("s"), name: a.name, folder: a.folder, color, tabs: [], activeTab: null };
      return { ...s, spaces: [...s.spaces, space], activeSpace: space.id };
    }
    case "space.select": {
      const id = a.id ?? s.spaces[a.index - 1]?.id;
      return id ? { ...s, activeSpace: id } : s;
    }
    case "space.next": return { ...s, activeSpace: cycle(s.spaces, s.activeSpace, 1) };
    case "space.prev": return { ...s, activeSpace: cycle(s.spaces, s.activeSpace, -1) };
    case "space.move": {
      const from = s.spaces.findIndex((x) => x.id === a.id);
      return from < 0 ? s : { ...s, spaces: move(s.spaces, from, a.index) };
    }
    case "space.rename": return withSpace(s, a.id, (sp) => ({ ...sp, name: a.name }));
    case "space.color": return withSpace(s, a.id, (sp) => ({ ...sp, color: a.color }));
    case "space.remove": {
      const spaces = s.spaces.filter((x) => x.id !== a.id);
      return { ...s, spaces, activeSpace: s.activeSpace === a.id ? spaces[0]?.id ?? null : s.activeSpace };
    }

    // --- tabs ---
    case "tab.open": {
      // A drawing already open in this space is selected, not opened twice.
      const sp = s.spaces.find((x) => x.id === (a.space ?? s.activeSpace));
      if (!sp) return s;
      const hit = a.file && !a.fresh && a.file !== "scribblr:terminal" && sp.tabs.find((t) => panesOf(t.root).some((p) => p.file === a.file));
      if (hit) {
        const pane = panesOf(hit.root).find((p) => p.file === a.file);
        return withSpace({ ...s, activeSpace: sp.id }, sp.id, (x) => ({
          ...x, activeTab: hit.id, tabs: x.tabs.map((t) => (t.id === hit.id ? { ...t, focused: pane.id } : t)),
        }));
      }
      const tab = newTab(a.file ?? null, a.extra);
      return withSpace({ ...s, activeSpace: sp.id }, sp.id, (x) => {
        const at = x.tabs.findIndex((t) => t.id === x.activeTab);
        const tabs = [...x.tabs];
        tabs.splice(at < 0 ? tabs.length : at + 1, 0, tab);
        return { ...x, tabs, activeTab: tab.id };
      });
    }
    case "tab.select": {
      const sp = activeSpace(s);
      const id = a.id ?? sp?.tabs[a.index - 1]?.id;
      return id ? withSpace(s, sp.id, (x) => ({ ...x, activeTab: id })) : s;
    }
    case "tab.next": case "tab.prev": {
      const sp = activeSpace(s);
      return sp ? withSpace(s, sp.id, (x) => ({ ...x, activeTab: cycle(x.tabs, x.activeTab, a.type === "tab.next" ? 1 : -1) })) : s;
    }
    case "tab.close": {
      const sp = activeSpace(s);
      if (!sp) return s;
      const id = a.id ?? sp.activeTab;
      const i = sp.tabs.findIndex((t) => t.id === id);
      const tabs = sp.tabs.filter((t) => t.id !== id);
      const next = sp.activeTab === id ? tabs[Math.min(i, tabs.length - 1)]?.id ?? null : sp.activeTab;
      return withSpace(s, sp.id, (x) => ({ ...x, tabs, activeTab: next }));
    }
    case "tab.rename": return withTab(s, (t) => ({ ...t, name: a.name || null }), a.id);
    case "tab.move": {
      const sp = activeSpace(s);
      const from = sp?.tabs.findIndex((t) => t.id === a.id) ?? -1;
      return from < 0 ? s : withSpace(s, sp.id, (x) => ({ ...x, tabs: move(x.tabs, from, a.index) }));
    }

    // --- panes ---
    // Hyprland-style: a new thing tiles next to the focused pane (the caller
    // picks the direction from its shape); with no tab open it gets a tab.
    case "pane.open": {
      const sp = activeSpace(s);
      if (!sp) return s;
      if (!activeTab(s) || a.tab) return reducer(s, { type: "tab.open", file: a.file, extra: a.extra, fresh: true });
      return reducer(s, { type: "pane.split", dir: a.dir, file: a.file, extra: a.extra });
    }
    case "pane.split": return withTab(s, (t) => {
      const target = a.pane ?? t.focused;
      const fresh = newPane(a.file ?? null, a.extra);
      const root = mapNode(t.root, (n) => (n.type === "pane" && n.id === target
        ? { type: "split", id: uid("x"), dir: a.dir === "down" ? "column" : "row", ratio: 0.5, a: n, b: fresh } : n));
      return { ...t, root, focused: fresh.id, zoomed: null };
    });
    case "pane.close": {
      // The pane's own tab, in whichever space (a shell can exit in the background).
      let sp = activeSpace(s), t = activeTab(s);
      if (a.pane) {
        for (const x of s.spaces) for (const y of x.tabs) if (panesOf(y.root).some((p) => p.id === a.pane)) { sp = x; t = y; }
      }
      if (!t || !sp) return s;
      const id = a.pane ?? t.focused;
      const root = removePane(t.root, id);
      if (!root) {
        const i = sp.tabs.findIndex((x) => x.id === t.id);
        const tabs = sp.tabs.filter((x) => x.id !== t.id);
        const next = sp.activeTab === t.id ? tabs[Math.min(i, tabs.length - 1)]?.id ?? null : sp.activeTab;
        return withSpace(s, sp.id, (x) => ({ ...x, tabs, activeTab: next }));
      }
      const focused = panesOf(root).some((p) => p.id === t.focused) ? t.focused : panesOf(root)[0].id;
      const fixed = { ...t, root, focused, zoomed: t.zoomed === id ? null : t.zoomed, full: t.full === id ? null : t.full };
      return withSpace(s, sp.id, (x) => ({ ...x, tabs: x.tabs.map((y) => (y.id === t.id ? fixed : y)) }));
    }
    case "pane.focus": return withTab(s, (t) => (t.focused === a.pane ? t : { ...t, focused: a.pane }));
    case "pane.zoom": return withTab(s, (t) => ({ ...t, zoomed: t.zoomed ? null : a.pane ?? t.focused }));
    // Focus mode: one pane fills the whole window (sidebar, bars, panel hidden).
    case "pane.full": return withTab(s, (t) => {
      const id = a.pane ?? t.focused;
      const on = a.on ?? !t.full;
      return { ...t, full: on ? id : null, focused: id };
    });
    // Alt+Shift+H/J/K/L: trade places with the neighbour in that direction.
    case "pane.swap": return withTab(s, (t) => {
      const target = neighbour(t, a.dir);
      if (!target) return t;
      const all = panesOf(t.root);
      const A = all.find((p) => p.id === t.focused), B = all.find((p) => p.id === target);
      const root = mapNode(t.root, (n) => (n.type !== "pane" ? n : n.id === A.id ? B : n.id === B.id ? A : n));
      return { ...t, root };
    });
    // Fields a pane's app keeps (a web page's url and title...), in any tab.
    case "pane.patch": return { ...s, spaces: s.spaces.map((sp) => ({ ...sp, tabs: sp.tabs.map((t) => ({
      ...t, root: mapNode(t.root, (n) => (n.type === "pane" && n.id === a.pane && Object.keys(a.patch).some((k) => n[k] !== a.patch[k]) ? { ...n, ...a.patch } : n)),
    })) })) };
    case "pane.cwd": return { ...s, spaces: s.spaces.map((sp) => ({ ...sp, tabs: sp.tabs.map((t) => ({
      ...t, root: mapNode(t.root, (n) => (n.type === "pane" && n.id === a.pane && n.cwd !== a.cwd ? { ...n, cwd: a.cwd } : n)),
    })) })) };
    case "pane.go": return withTab(s, (t) => {
      const best = neighbour(t, a.dir);
      return best ? { ...t, focused: best, zoomed: null } : t;
    });
    case "pane.file": return withTab(s, (t) => ({
      ...t, root: mapNode(t.root, (n) => (n.type === "pane" && n.id === a.pane ? { ...n, file: a.file, ...(a.cwd ? { cwd: a.cwd } : {}) } : n)),
    }));
    case "pane.ratio": return withTab(s, (t) => ({
      ...t, root: mapNode(t.root, (n) => (n.id === a.split ? { ...n, ratio: Math.max(0.12, Math.min(0.88, a.ratio)) } : n)),
    }));

    // --- files changed on disk ---
    // A file or folder moved/renamed: every pane under it follows.
    case "path.moved": {
      const fix = (n) => {
        if (n.type !== "pane") return n;
        const f = n.file, c = n.cwd;
        const nf = f && (f === a.from || f.startsWith(a.from + "/")) ? a.to + f.slice(a.from.length) : f;
        const nc = c && (c === a.from || c.startsWith(a.from + "/")) ? a.to + c.slice(a.from.length) : c;
        return nf === f && nc === c ? n : { ...n, file: nf, cwd: nc };
      };
      return { ...s, spaces: s.spaces.map((sp) => ({ ...sp, tabs: sp.tabs.map((t) => ({ ...t, root: mapNode(t.root, fix) })) })) };
    }
    case "file.renamed": case "file.trashed": {
      const to = a.type === "file.renamed" ? a.to : null;
      const fix = (n) => (n.type === "pane" && n.file === a.from ? { ...n, file: to } : n);
      return { ...s, spaces: s.spaces.map((sp) => ({ ...sp, tabs: sp.tabs.map((t) => ({ ...t, root: mapNode(t.root, fix) })) })) };
    }

    // --- chrome ---
    case "sidebar.toggle": return { ...s, sidebar: { ...s.sidebar, collapsed: !s.sidebar.collapsed } };
    case "panel.toggle": {
      // Herdr's panel buttons: the shown view's button closes it, another switches.
      const view = a.view ?? s.panel.view ?? "files";
      const open = a.open ?? !(s.panel.open && (s.panel.view ?? "files") === view);
      return { ...s, panel: { ...s.panel, open, view } };
    }
    case "panel.width": return { ...s, panel: { ...s.panel, width: Math.max(260, Math.min(900, a.width)) } };
    case "look": return { ...s, look: { ...s.look, ...a.look } };
    default: return s;
  }
}
