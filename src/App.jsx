// Scribblr: Herdr's window for studying, coding and planning. Sidebar
// (spaces + what's open), tab bar, Hyprland-style tiled panes (drawings,
// notes, terminals, calendars, graph), Files / Links panel, status bar.
import React, { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { api, baseName, kindOf } from "./api.js";
import { disposeMissing } from "./apps/terminal.js";
import { setWebContext, closeMissingWebs } from "./apps/web.js";
import { Ctx } from "./ctx.js";
import { reducer, initialState, activeSpace, activeTab, panesOf, allPaneIds } from "./store.js";
import { allThemes, applyTheme } from "./theme.js";
import { buildKeymap, comboOf, parseAction, keyHandler } from "./keys.js";
import Sidebar from "./components/Sidebar.jsx";
import TabsBar from "./components/TabsBar.jsx";
import Workspace from "./components/Workspace.jsx";
import SidePanel from "./components/FilesPanel.jsx";
import StatusBar from "./components/StatusBar.jsx";
import { Palette, Picker, Prompt, Confirm, Menu, Settings, Help, LinkPicker, NewMenu, spaceColors } from "./components/Overlays.jsx";
import { buildGraph, GRAPH } from "./links.js";

const darkQuery = window.matchMedia("(prefers-color-scheme: dark)");
const ZOOMS = [0.6, 0.7, 0.8, 0.9, 1, 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.8, 2];

export default function App() {
  const [state, dispatch] = useReducer(reducer, initialState);
  const [ready, setReady] = useState(false);
  const [home, setHome] = useState("");
  const [themeFiles, setThemeFiles] = useState([]);
  const [keymap, setKeymap] = useState(buildKeymap(null));
  const [drawings, setDrawings] = useState({});
  const [overlay, setOverlay] = useState(null);
  const [sysDark, setSysDark] = useState(darkQuery.matches);
  const apis = useRef({});
  const canvases = useRef({});
  const [linkIndex, setLinkIndex] = useState([]);
  const [epoch, setEpoch] = useState(0);
  const lastDisk = useRef({ d: null, l: null });
  const [kitty, setKitty] = useState({});
  const [termTitles, setTermTitles] = useState({});
  const setTermTitle = useCallback((id, t) => setTermTitles((m) => (m[id] === t ? m : { ...m, [id]: t })), []);
  const fileOps = useRef({});
  const stateRef = useRef(state);
  stateRef.current = state;

  // --- load ---
  useEffect(() => {
    (async () => {
      const h = await api.home();
      setHome(h);
      setThemeFiles(await api.userThemes().catch(() => []));
      setKitty(await api.kittyConfig().catch(() => ({})));
      try { setKeymap(buildKeymap(JSON.parse((await api.readConfig("keys.json")) ?? "{}"))); } catch { /* defaults */ }
      let saved = null;
      try { saved = JSON.parse((await api.readConfig("state.json")) ?? "null"); } catch { saved = null; }
      if (!saved) {
        // First start: Herdr's zoom, and one space in ~/Scribblr.
        let zoom = null;
        try { zoom = JSON.parse((await api.herdrSettings()) ?? "{}").zoom ?? null; } catch { /* none */ }
        saved = { ...initialState, look: { ...initialState.look, zoom } };
        dispatch({ type: "init", state: saved });
        dispatch({ type: "space.add", name: "Scribblr", folder: `${h}/Scribblr` });
      } else dispatch({ type: "init", state: saved });
      setReady(true);
    })();
    const onTheme = (e) => setSysDark(e.matches);
    darkQuery.addEventListener("change", onTheme);
    return () => darkQuery.removeEventListener("change", onTheme);
  }, []);

  // --- save (debounced) ---
  useEffect(() => {
    if (!ready) return;
    const t = setTimeout(() => api.writeConfig("state.json", JSON.stringify(state, null, 1)), 400);
    return () => clearTimeout(t);
  }, [state, ready]);

  // Terminals whose panes closed end their shells.
  useEffect(() => { if (ready) { const ids = allPaneIds(state); disposeMissing(ids); closeMissingWebs(ids); } }, [state, ready]);

  // --- drawings on disk, per space folder ---
  const refresh = useCallback(async () => {
    const out = {};
    const folders = stateRef.current.spaces.map((sp) => sp.folder);
    for (const f of folders) out[f] = await api.listDrawings(f).catch(() => []);
    const links = await api.linkIndex(folders).catch(() => []);
    // Only a real change on disk updates the app (the poll runs every 3s;
    // new-but-equal objects re-rendered everything and made the graph blink).
    const dKey = JSON.stringify(out), lKey = JSON.stringify(links);
    if (dKey !== lastDisk.current.d) { lastDisk.current.d = dKey; setDrawings(out); }
    if (lKey !== lastDisk.current.l) { lastDisk.current.l = lKey; setLinkIndex(links); }
  }, []);
  useEffect(() => { if (ready) refresh(); }, [ready, state.spaces.length, refresh]);
  useEffect(() => {
    const t = setInterval(refresh, 3000);
    const f = () => refresh();
    window.addEventListener("focus", f);
    return () => { clearInterval(t); window.removeEventListener("focus", f); };
  }, [refresh]);

  // --- look ---
  const themes = useMemo(() => allThemes(themeFiles), [themeFiles]);
  const dark = state.look.appearance ? state.look.appearance === "dark" : sysDark;
  const theme = themes.find((t) => t.name === (dark ? state.look.dark : state.look.light)) ?? themes.find((t) => t.light === !dark) ?? themes[0];
  useEffect(() => { applyTheme(theme); }, [theme]);
  useEffect(() => { getCurrentWebview().setZoom(state.look.zoom ?? 1).catch(() => {}); }, [state.look.zoom]);

  const space = activeSpace(state);
  const tab = activeTab(state);
  const graph = useMemo(() => buildGraph(linkIndex, state.spaces), [linkIndex, state.spaces]);
  const graphRef = useRef(graph);
  graphRef.current = graph;

  // Write every open drawing to disk now (before renames and link rewrites).
  const flushAll = useCallback(() => Promise.all(Object.values(canvases.current).map((c) => c.flush())), []);

  // --- actions ---
  const openFile = useCallback((file, spaceId) => dispatch({ type: "tab.open", file, space: spaceId }), []);

  // Hyprland's dwindle: split the focused pane along its longer side.
  const autoDir = () => {
    const t = activeTab(stateRef.current);
    const el = t && document.querySelector(`[data-pane="${t.focused}"]`);
    if (!el) return "right";
    const r = el.getBoundingClientRect();
    return r.width >= r.height ? "right" : "down";
  };
  // Open something as a new tile in this tab (or a tab of its own).
  const tile = useCallback((file, extra, inTab) => dispatch({ type: "pane.open", file, extra, dir: autoDir(), tab: inTab }), []);

  const EXT = { drawing: ".excalidraw", note: ".note", calendar: ".calendar" };
  // A new drawing / note in the space folder; `open`: "tab" | "tile" | falsy.
  const newItem = useCallback(async (kind, open, folder) => {
    const sp = activeSpace(stateRef.current);
    if (!sp) return null;
    const file = await api.createItem(folder ?? sp.folder, "Untitled", EXT[kind] ?? ".excalidraw");
    await refresh();
    if (open === true || open === "tab") dispatch({ type: "tab.open", file });
    else if (open === "tile") tile(file);
    return file;
  }, [refresh, tile]); // eslint-disable-line react-hooks/exhaustive-deps
  const newDrawing = useCallback((inTab) => newItem("drawing", inTab), [newItem]);

  // Any file from the Files panel: Scribblr kinds open inside (Ctrl: as a
  // tile), anything else in its system app.
  const openAny = useCallback((path, split) => {
    if (kindOf(path)) return split ? tile(path) : dispatch({ type: "tab.open", file: path });
    api.openPath(path).catch(() => {});
  }, [tile]);

  // Follow [[name]]: open the drawing (Ctrl: to the right); if it doesn't
  // exist yet, make it next to the drawing that links to it.
  const openLink = useCallback(async (name, from, split) => {
    let path = graphRef.current.resolve(name, from);
    if (!path) {
      const sp = (from && graphRef.current.spaceOf(from)) || activeSpace(stateRef.current);
      if (!sp) return;
      const folder = from ? from.slice(0, from.lastIndexOf("/")) : sp.folder;
      // A page linked from a note becomes a note; otherwise a drawing.
      path = await api.createItem(folder, name, kindOf(from) === "note" ? ".note" : ".excalidraw");
      await refresh();
    }
    if (split && activeTab(stateRef.current)) tile(path);
    else dispatch({ type: "tab.open", file: path });
  }, [refresh, tile]);

  // Links live on the drawing itself (file metadata), never on shapes.
  const focusedDrawing = () => {
    const t = activeTab(stateRef.current);
    const f = t && panesOf(t.root).find((p) => p.id === t.focused)?.file;
    return f && !f.startsWith("scribblr:") ? f : null;
  };
  const linksOf = (file) => (graphRef.current.outgoing.get(file) ?? []).map((o) => o.name);
  const insertLink = useCallback(async (name, file) => {
    const f = file ?? focusedDrawing();
    if (!f || !name) return;
    await api.setLinks(f, [...linksOf(f), name]);
    refresh();
  }, [refresh]);
  const removeLink = useCallback(async (name, file) => {
    const f = file ?? focusedDrawing();
    if (!f) return;
    await api.setLinks(f, linksOf(f).filter((n) => n.toLowerCase() !== name.toLowerCase()));
    refresh();
  }, [refresh]);

  const renameFile = useCallback((file) => {
    if (!file) return;
    setOverlay({ kind: "prompt", title: "Rename", value: baseName(file), onDone: async (name) => {
      if (!name || name === baseName(file)) return;
      try {
        await flushAll();
        const to = await api.rename(file, name);
        dispatch({ type: "path.moved", from: file, to });
        // Obsidian-style: links to the old name now point at the new one.
        if (kindOf(file)) {
          const n = await api.rewriteLinks(stateRef.current.spaces.map((sp) => sp.folder), baseName(file), baseName(to));
          if (n > 0) setEpoch((e) => e + 1);
        }
        refresh(); fileOps.current.reloadFiles?.();
      }
      catch (e) { setOverlay({ kind: "confirm", title: "Couldn't rename", detail: String(e), confirm: "OK", onYes: () => {} }); }
    } });
  }, [refresh, flushAll]);

  const trashFile = useCallback((file, sp) => {
    setOverlay({ kind: "confirm", title: "Move to trash?", detail: `"${file.split("/").pop()}" moves to ${sp.name}/.trash — you can get it back from there.`, confirm: "Move to trash",
      onYes: async () => {
        await flushAll(); await api.trash(file, sp.folder);
        dispatch({ type: "file.trashed", from: file });
        dispatch({ type: "path.moved", from: file, to: "/dev/null/trashed" });
        refresh(); fileOps.current.reloadFiles?.();
      } });
  }, [refresh, flushAll]);

  // The Files panel's actions.
  fileOps.current.create = (dir, type) => {
    const titles = { drawing: "New drawing", note: "New note", file: "New file (with its extension, e.g. main.py)", folder: "New folder" };
    setOverlay({ kind: "prompt", title: titles[type], value: type === "folder" ? "New folder" : type === "file" ? "" : "Untitled", confirm: "Create", onDone: async (name) => {
      if (!name) return;
      try {
        if (type === "folder") await api.createDir(dir, name);
        else if (type === "file") { const p = await api.createFile(dir, name); if (kindOf(p)) openAny(p); }
        else { const p = await api.createItem(dir, name, EXT[type]); await refresh(); dispatch({ type: "tab.open", file: p }); }
        refresh(); fileOps.current.reloadFiles?.();
      } catch (e) { setOverlay({ kind: "confirm", title: "Couldn't create it", detail: String(e), confirm: "OK", onYes: () => {} }); }
    } });
  };
  // Several files at once: one question, then all of them to the trash.
  fileOps.current.trashMany = (paths) => {
    const sp = activeSpace(stateRef.current);
    if (!sp || !paths.length) return;
    if (paths.length === 1) return trashFile(paths[0], sp);
    setOverlay({ kind: "confirm", title: `Move ${paths.length} items to trash?`, detail: `They move to ${sp.name}/.trash — you can get them back from there.`, confirm: "Move to trash",
      onYes: async () => {
        await flushAll();
        for (const p of paths) {
          try { await api.trash(p, sp.folder); dispatch({ type: "file.trashed", from: p }); dispatch({ type: "path.moved", from: p, to: "/dev/null/trashed" }); }
          catch (e) { console.error("trash failed", p, e); }
        }
        refresh(); fileOps.current.reloadFiles?.();
      } });
  };
  fileOps.current.trash = (p) => { const sp = activeSpace(stateRef.current); if (sp) trashFile(p, sp); };
  fileOps.current.rename = async (from, name) => {
    try {
      await flushAll();
      const to = await api.rename(from, name);
      dispatch({ type: "path.moved", from, to });
      if (kindOf(from)) await api.rewriteLinks(stateRef.current.spaces.map((x) => x.folder), baseName(from), baseName(to));
      refresh();
    } catch (e) { setOverlay({ kind: "confirm", title: "Couldn't rename", detail: String(e), confirm: "OK", onYes: () => {} }); }
  };
  fileOps.current.move = async (from, toDir) => {
    try {
      await flushAll();
      const to = await api.move(from, toDir);
      dispatch({ type: "path.moved", from, to });
      refresh();
    } catch (e) { setOverlay({ kind: "confirm", title: "Couldn't move it", detail: String(e), confirm: "OK", onYes: () => {} }); }
  };

  const focusedFile = () => { const t = activeTab(stateRef.current); return t && panesOf(t.root).find((p) => p.id === t.focused)?.file; };

  const run = useCallback(async (cmd, arg) => {
    const s = stateRef.current;
    const sp = activeSpace(s);
    const obj = arg && typeof arg === "object" ? arg : {};
    switch (cmd) {
      case "space.new": {
        const folder = await openDialog({ directory: true, title: "Choose a folder for the new space" });
        if (folder) dispatch({ type: "space.add", name: folder.split("/").filter(Boolean).pop() ?? folder, folder });
        return;
      }
      case "space.select": return dispatch({ type: "space.select", index: Number(arg) });
      case "space.next": case "space.prev": return dispatch({ type: cmd });
      case "space.rename": {
        const target = s.spaces.find((x) => x.id === obj.id) ?? sp;
        if (target) setOverlay({ kind: "prompt", title: "Rename space", value: target.name, onDone: (name) => name && dispatch({ type: "space.rename", id: target.id, name }) });
        return;
      }
      case "space.remove": {
        const target = s.spaces.find((x) => x.id === obj.id) ?? sp;
        if (target) setOverlay({ kind: "confirm", title: "Remove space?", detail: `"${target.name}" leaves the sidebar. Its drawings stay in ${target.folder}.`, confirm: "Remove", onYes: () => dispatch({ type: "space.remove", id: target.id }) });
        return;
      }
      case "tab.new": return newDrawing(true);
      case "app.newmenu": return setOverlay((o) => (o?.kind === "newmenu" ? null : { kind: "newmenu", x: obj.x, y: obj.y }));
      // New things open in a new tab of this space; { split: true } tiles
      // them next to the focused pane instead (the split buttons do that).
      case "new.drawing": return newItem("drawing", obj.split ? "tile" : "tab");
      case "new.note": return newItem("note", obj.split ? "tile" : "tab");
      case "new.terminal": return sp && tile("scribblr:terminal", { cwd: obj.cwd ?? sp.folder }, !obj.split);
      // Calendar and graph: one tab each per space (selected if already open).
      case "new.files": return sp && tile("scribblr:files", { cwd: obj.cwd ?? sp.folder }, !obj.split);
      case "new.web": return sp && tile("scribblr:web", obj.url ? { url: obj.url } : undefined, !obj.split);
      case "calendar.open": return sp && (obj.split ? tile("scribblr:calendar") : dispatch({ type: "tab.open", file: "scribblr:calendar" }));
      case "pane.full": {
        // Leaving focus mode also leaves a web page's ultra fit.
        const t = activeTab(s);
        const p = t && panesOf(t.root).find((x) => x.id === (obj.pane ?? t.focused));
        if (p?.ultra) dispatch({ type: "pane.patch", pane: p.id, patch: { ultra: false } });
        return dispatch({ type: "pane.full", pane: obj.pane });
      }
      // Ultra fit (F11): a web app fills the whole window, nothing else —
      // no sidebar, tabs, pane header or browser toolbar. F11 / Ctrl+Shift+F
      // (or Esc) brings everything back. Can be turned off in Settings.
      case "web.ultra": {
        if (s.look.webUltra === false) return;
        const t = activeTab(s);
        const id = obj.pane ?? t?.focused;
        const p = t && panesOf(t.root).find((x) => x.id === id);
        if (!p || p.file !== "scribblr:web" || !p.url) return;
        const on = !p.ultra;
        dispatch({ type: "pane.patch", pane: p.id, patch: { ultra: on } });
        dispatch({ type: "pane.full", pane: p.id, on });
        setTimeout(() => api.webNav(`web-${p.id}`, "focus").catch(() => {}), 60);
        return;
      }
      case "pane.swap": return dispatch({ type: "pane.swap", dir: arg });
      case "tab.select": return dispatch({ type: "tab.select", index: Number(arg) });
      case "tab.next": case "tab.prev": return dispatch({ type: cmd });
      case "tab.close": return dispatch({ type: "tab.close", id: obj.id });
      case "tab.rename": {
        const t = sp?.tabs.find((x) => x.id === obj.id) ?? activeTab(s);
        return renameFile(t && (panesOf(t.root).find((p) => p.id === t.focused)?.file ?? panesOf(t.root)[0]?.file));
      }
      case "pane.split": {
        if (!activeTab(s)) return;
        return dispatch({ type: "pane.split", dir: typeof arg === "string" ? arg : obj.dir ?? "right", pane: obj.pane });
      }
      case "pane.close": return dispatch({ type: "pane.close", pane: obj.pane });
      case "pane.zoom": return dispatch({ type: "pane.zoom", pane: obj.pane });
      case "pane.go": return dispatch({ type: "pane.go", dir: arg });
      case "layout.toggle": return dispatch({ type: "sidebar.toggle" });
      case "panel.toggle": return dispatch({ type: "panel.toggle", view: typeof arg === "string" ? arg : obj.view });
      case "graph.open": return sp && (obj.split ? tile(GRAPH) : dispatch({ type: "tab.open", file: GRAPH }));
      case "link.insert": {
        const f = focusedDrawing();
        if (f) setOverlay({ kind: "linkpicker", file: f });
        return;
      }
      case "file.rename": return renameFile(obj.file ?? focusedFile());
      case "file.trash": { const f = obj.file ?? focusedFile(); return f && sp && trashFile(f, sp); }
      case "app.palette": return setOverlay((o) => (o?.kind === "palette" ? null : { kind: "palette" }));
      case "app.picker": return setOverlay((o) => (o?.kind === "picker" ? null : { kind: "picker" }));
      case "app.settings": return setOverlay((o) => (o?.kind === "settings" ? null : { kind: "settings" }));
      case "app.help": return setOverlay((o) => (o?.kind === "help" ? null : { kind: "help" }));
      case "app.zoom_in": case "app.zoom_out": {
        const z = s.look.zoom ?? 1;
        const next = cmd === "app.zoom_in" ? ZOOMS.find((v) => v > z + 0.001) ?? z : [...ZOOMS].reverse().find((v) => v < z - 0.001) ?? z;
        return dispatch({ type: "look", look: { zoom: next } });
      }
      case "app.zoom_reset": return dispatch({ type: "look", look: { zoom: 1 } });
      case "app.theme": return dispatch({ type: "look", look: dark ? { dark: arg } : { light: arg } });
      default: console.warn("unknown command", cmd);
    }
  }, [newDrawing, newItem, tile, renameFile, trashFile, dark]);

  const commands = useMemo(() => [
    { id: "tab.new", title: "New drawing (new tab)" },
    { id: "new.drawing", title: "New drawing (tile)" },
    { id: "new.note", title: "New note" },
    { id: "new.terminal", title: "New terminal" },
    { id: "calendar.open", title: "Open calendar" },
    { id: "new.files", title: "New Files window" },
    { id: "new.web", title: "New web app" },
    { id: "web.ultra", title: "Ultra fit: web app fills the whole window" },
    { id: "pane.full", title: "Focus mode (pane fills the window)" },
    { id: "pane.swap", arg: "left", title: "Swap pane left" },
    { id: "pane.swap", arg: "right", title: "Swap pane right" },
    { id: "app.picker", title: "Open drawing…" },
    { id: "space.new", title: "New space (add a folder)" },
    { id: "space.rename", title: "Rename space" },
    { id: "space.remove", title: "Remove space" },
    { id: "space.next", title: "Next space" },
    { id: "space.prev", title: "Previous space" },
    { id: "tab.rename", title: "Rename drawing" },
    { id: "file.trash", title: "Move drawing to trash" },
    { id: "tab.close", title: "Close tab" },
    { id: "tab.next", title: "Next tab" },
    { id: "tab.prev", title: "Previous tab" },
    { id: "pane.split", arg: "right", title: "Split right" },
    { id: "pane.split", arg: "down", title: "Split down" },
    { id: "pane.close", title: "Close pane" },
    { id: "pane.zoom", title: "Zoom pane" },
    { id: "graph.open", title: "Open graph view" },
    { id: "link.insert", title: "Link this drawing to…" },
    { id: "panel.toggle", arg: "links", title: "Toggle links and backlinks" },
    { id: "layout.toggle", arg: "sidebar", title: "Toggle sidebar" },
    { id: "panel.toggle", arg: "files", title: "Toggle files" },
    { id: "app.settings", title: "Settings" },
    { id: "app.help", title: "Keyboard shortcuts" },
    { id: "app.zoom_in", title: "Zoom in" },
    { id: "app.zoom_out", title: "Zoom out" },
    { id: "app.zoom_reset", title: "Reset zoom" },
    ...themes.map((t) => ({ id: "app.theme", arg: t.name, title: `Theme: ${t.name}` })),
  ], [themes]);

  // --- keys (capture phase, before Excalidraw; see keys.js) ---
  useEffect(() => {
    keyHandler.current = (e) => {
      const combo = comboOf(e);
      if (!combo) return false;
      const action = keymap[combo];
      if (!action) return false;
      const typing = /^(INPUT|TEXTAREA)$/.test(e.target.tagName) || e.target.isContentEditable;
      if (typing && !combo.includes("ctrl") && !combo.includes("alt")) return false;
      const [cmd, arg] = parseAction(action);
      if (overlay && !["app.palette", "app.picker", "app.settings", "app.help", "link.insert"].includes(cmd)) return false;
      run(cmd, arg);
      return true;
    };
    return () => { keyHandler.current = null; };
  }, [keymap, run, overlay]);

  // --- right-click menus ---
  const openMenu = useCallback((e, kind, target) => {
    const s = stateRef.current;
    const sp = activeSpace(s);
    let items = [];
    if (kind === "space") items = [
      { icon: "square-pen", label: "Rename", run: () => run("space.rename", { id: target.id }) },
      { colors: spaceColors(theme, target.color, (c) => dispatch({ type: "space.color", id: target.id, color: c })) },
      "-",
      { icon: "x", label: "Remove space", danger: true, run: () => run("space.remove", { id: target.id }) },
    ];
    if (kind === "tab") items = [
      { icon: "square-pen", label: "Rename drawing", run: () => run("tab.rename", { id: target.id }) },
      { icon: "split-right", label: "Split right", run: () => { dispatch({ type: "tab.select", id: target.id }); dispatch({ type: "pane.split", dir: "right" }); } },
      "-",
      { icon: "close", label: "Close tab", run: () => dispatch({ type: "tab.close", id: target.id }) },
    ];
    if (kind === "file") items = [
      { icon: "pen", label: "Open", run: () => openFile(target.path) },
      { icon: "split-right", label: "Open to the right", run: () => (activeTab(s) ? dispatch({ type: "pane.split", dir: "right", file: target.path }) : openFile(target.path)) },
      { icon: "square-pen", label: "Rename", run: () => renameFile(target.path) },
      "-",
      { icon: "archive", label: "Move to trash", danger: true, run: () => trashFile(target.path, sp) },
    ];
    if (kind === "fs" && target.many) {
      items = [
        { icon: "copy", label: `Copy ${target.many.length} paths`, run: () => navigator.clipboard.writeText(target.many.join("\n")).catch(() => {}) },
        "-",
        { icon: "trash", label: `Move ${target.many.length} items to trash`, danger: true, run: () => { fileOps.current.trashMany(target.many); target.clear?.(); } },
      ];
    } else if (kind === "fs") {
      const p = target.path, dir = target.dir ? p : p.slice(0, p.lastIndexOf("/"));
      const k = kindOf(p);
      items = [
        ...(!target.dir ? [
          { icon: "file", label: k ? "Open" : "Open with system app", run: () => openAny(p) },
          ...(k ? [{ icon: "split-right", label: "Open as a tile", run: () => openAny(p, true) }, { icon: "globe", label: "Open with system app", run: () => api.openPath(p) }] : []),
          "-",
        ] : []),
        ...(target.fm ? [
          ...(!target.root ? [{ icon: "copy", label: "Copy", run: () => target.fm.copy() }, { icon: "split-right", label: "Cut", run: () => target.fm.cut() }] : []),
          { icon: "file", label: "Paste", run: () => target.fm.paste() },
          "-",
        ] : []),
        { icon: "pen", label: "New drawing here", run: () => fileOps.current.create(dir, "drawing") },
        { icon: "file-text", label: "New note here", run: () => fileOps.current.create(dir, "note") },
        { icon: "file", label: "New file here", run: () => fileOps.current.create(dir, "file") },
        { icon: "folder-plus", label: "New folder here", run: () => fileOps.current.create(dir, "folder") },
        { icon: "terminal", label: "Terminal here", run: () => run("new.terminal", { cwd: dir }) },
        "-",
        ...(!target.root ? [
          { icon: "square-pen", label: "Rename", run: () => (target.fm ? target.fm.rename() : renameFile(p)) },
          { icon: "copy", label: "Duplicate", run: async () => { await flushAll(); await api.duplicate(p); refresh(); target.reload?.(); } },
        ] : []),
        { icon: "copy", label: "Copy path", run: () => navigator.clipboard.writeText(p).catch(() => {}) },
        { icon: "folder-open", label: "Show in file manager", run: () => api.openPath(p, true) },
        ...(!target.root ? ["-", { icon: "trash", label: "Move to trash", danger: true, run: () => trashFile(p, sp) }] : []),
      ];
    }
    setOverlay({ kind: "menu", x: e.clientX, y: e.clientY, items });
  }, [run, theme, openFile, renameFile, trashFile, openAny, flushAll, refresh]);

  // Web views follow zoom, hide under menus and dialogs, and report pages.
  useEffect(() => {
    setWebContext({
      zoom: state.look.zoom ?? 1,
      overlay: !!overlay,
      onKey: ({ label, action }) => {
        const pane = label.slice(4);
        if (action === "ultra") run("web.ultra", { pane });
        else if (action === "full") run("pane.full", { pane });
        else if (action === "escape") {
          const t = activeTab(stateRef.current);
          const p = t && panesOf(t.root).find((x) => x.id === pane);
          if (p?.ultra) run("web.ultra", { pane });
        }
      },
      onEvent: ({ label, url, title }) => dispatch({ type: "pane.patch", pane: label.slice(4), patch: title && !/^[\w.-]+$/.test(title) ? { url, title } : { url } }),
    });
  }, [state.look.zoom, overlay, run]);

  if (!ready || !theme) return null;
  const close = () => setOverlay(null);
  const ctx = { state, dispatch, run, space, tab, home, theme, themes, dark, drawings, refresh, keymap, commands, apis, canvases, epoch, graph, openFile, openLink, insertLink, removeLink, newDrawing, newItem, openAny, tile, openMenu, kitty, termTitles, setTermTitle, fileOps };

  return (
    <Ctx.Provider value={ctx}>
      <div className={`window ${tab?.full ? "focus-mode" : ""}`}>
        <Sidebar />
        <main className="work">
          <TabsBar />
          <div className="work-body">
            <Workspace />
            {state.panel.open && space && <SidePanel />}
          </div>
          <StatusBar />
        </main>
        {overlay?.kind === "palette" && <Palette close={close} />}
        {overlay?.kind === "picker" && <Picker close={close} />}
        {overlay?.kind === "newmenu" && <NewMenu {...overlay} close={close} />}
        {overlay?.kind === "linkpicker" && <LinkPicker file={overlay.file} close={close} />}
        {overlay?.kind === "settings" && <Settings close={close} />}
        {overlay?.kind === "help" && <Help close={close} />}
        {overlay?.kind === "prompt" && <Prompt {...overlay} close={close} />}
        {overlay?.kind === "confirm" && <Confirm {...overlay} close={close} />}
        {overlay?.kind === "menu" && <Menu {...overlay} close={close} />}
      </div>
    </Ctx.Provider>
  );
}
