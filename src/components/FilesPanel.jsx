// The side panel (Herdr's Files / Changes stack): Files or Links.
// Files is a real file manager for the space's folder: every file (code,
// PDFs, images, notes...), lazy folders, new file / folder / drawing / note,
// rename, duplicate, move (drag onto a folder), trash, reveal, copy path.
// Scribblr files open in their app; anything else opens in its system app.
import React, { useCallback, useEffect, useRef, useState } from "react";
import { useApp } from "../ctx.js";
import { Icon } from "../icons.jsx";
import { api, tilde, kindOf, KIND_ICON } from "../api.js";
import LinksPanel from "./LinksPanel.jsx";
import { FileIcon } from "../apps/fileIcon.jsx";

const iconFor = (e) => (e.dir ? "folder" : KIND_ICON[kindOf(e.path)] ?? "file");
const label = (e) => (kindOf(e.path) ? e.name.replace(/\.(excalidraw|note|calendar)$/, "") : e.name);

function FilesBody() {
  const { space, home, openAny, openMenu, fileOps, tab } = useApp();
  const root = space.folder;
  const storeKey = `files.open.${root}`;
  const [open, setOpen] = useState(() => { try { return new Set(JSON.parse(localStorage.getItem(storeKey) ?? "[]")); } catch { return new Set(); } });
  const [kids, setKids] = useState({});
  const [hidden, setHidden] = useState(false);
  const [dropOn, setDropOn] = useState(null);
  // Selection: plain click opens; Ctrl-click toggles, Shift-click selects a
  // range (nothing opens), then Delete / right-click acts on all of them.
  const [sel, setSel] = useState(() => new Set());
  const [anchor, setAnchor] = useState(null);
  const openRef = useRef(open);
  openRef.current = open;

  const load = useCallback(async () => {
    const dirs = [root, ...[...openRef.current].filter((d) => d.startsWith(root))];
    const next = {};
    for (const d of dirs) next[d] = await api.listDir(d, hidden).catch(() => null);
    setKids((k) => (JSON.stringify(k) === JSON.stringify(next) ? k : next));
  }, [root, hidden]);
  useEffect(() => { load(); const t = setInterval(load, 2500); return () => clearInterval(t); }, [load]);
  useEffect(() => { try { localStorage.setItem(storeKey, JSON.stringify([...open])); } catch { /* ok */ } load(); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { fileOps.current.reloadFiles = load; }, [load, fileOps]);

  const current = new Set();
  const walk = (n) => (n.type === "pane" ? n.file && current.add(n.file) : (walk(n.a), walk(n.b)));
  if (tab) walk(tab.root);

  const toggle = (p) => setOpen((o) => { const n = new Set(o); n.has(p) ? n.delete(p) : n.add(p); return n; });
  const drop = async (e, dir) => {
    e.preventDefault(); e.stopPropagation(); setDropOn(null);
    const from = e.dataTransfer.getData("application/x-scribblr-path");
    if (from && from !== dir && !dir.startsWith(from + "/") && from.slice(0, from.lastIndexOf("/")) !== dir) await fileOps.current.move(from, dir);
    load();
  };
  const dropProps = (dir) => ({
    onDragOver: (e) => { if (e.dataTransfer.types.includes("application/x-scribblr-path")) { e.preventDefault(); e.stopPropagation(); setDropOn(dir); } },
    onDragLeave: () => setDropOn((d) => (d === dir ? null : d)),
    onDrop: (e) => drop(e, dir),
  });

  // The rows in screen order, for Shift ranges.
  const order = [];
  const collect = (dir) => { for (const e of kids[dir] ?? []) { order.push(e.path); if (e.dir && open.has(e.path)) collect(e.path); } };
  collect(root);
  const clickRow = (ev, e) => {
    if (ev.shiftKey && anchor) {
      const a = order.indexOf(anchor), b = order.indexOf(e.path);
      if (a >= 0 && b >= 0) { const n = new Set(ev.ctrlKey ? sel : []); for (let i = Math.min(a, b); i <= Math.max(a, b); i++) n.add(order[i]); setSel(n); }
      return;
    }
    if (ev.ctrlKey || ev.metaKey) {
      setSel((s) => { const n = new Set(s); n.has(e.path) ? n.delete(e.path) : n.add(e.path); return n; });
      setAnchor(e.path);
      return;
    }
    setSel(new Set([e.path])); setAnchor(e.path);
    if (e.dir) toggle(e.path); else openAny(e.path);
  };
  const selected = [...sel].filter((p) => order.includes(p));
  const onKey = (ev) => {
    if (ev.target.tagName === "INPUT") return;
    if (ev.key === "Delete" && selected.length) { fileOps.current.trashMany(selected); setSel(new Set()); ev.stopPropagation(); }
    else if (ev.key === "Escape") setSel(new Set());
    else if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === "a") { setSel(new Set(order)); ev.preventDefault(); }
  };

  const rows = (dir, depth) => (kids[dir] ?? []).map((e) => (
    <div key={e.path}>
      <div
        className={`file-row ${current.has(e.path) ? "on" : ""} ${sel.has(e.path) ? "picked" : ""} ${dropOn === e.path ? "drop" : ""}`}
        style={{ paddingLeft: 8 + depth * 14 + (e.dir ? 0 : 17) }}
        draggable
        onDragStart={(ev) => { ev.dataTransfer.setData("application/x-scribblr-path", e.path); ev.dataTransfer.effectAllowed = "move"; }}
        {...(e.dir ? dropProps(e.path) : {})}
        onClick={(ev) => clickRow(ev, e)}
        onContextMenu={(ev) => {
          ev.preventDefault(); ev.stopPropagation();
          const many = sel.has(e.path) && selected.length > 1;
          if (!sel.has(e.path)) { setSel(new Set([e.path])); setAnchor(e.path); }
          openMenu(ev, "fs", { ...e, reload: load, many: many ? selected : null, clear: () => setSel(new Set()) });
        }}
        title={e.name}
      >
        {e.dir && <Icon name={open.has(e.path) ? "chevron-down" : "chevron-right"} size={11} className="dim" />}
        <FileIcon name={e.name} dir={e.dir} open={open.has(e.path)} size={16} />
        <span className="truncate">{label(e)}</span>
      </div>
      {e.dir && open.has(e.path) && rows(e.path, depth + 1)}
    </div>
  ));

  return (
    <>
      <div className="panel-head">
        <span className="truncate" title={root}>{tilde(root, home)}</span>
        <span className="grow" />
        <button className="icon-btn" title="New drawing" onClick={() => fileOps.current.create(root, "drawing")}><Icon name="pen" size={14} /></button>
        <button className="icon-btn" title="New note" onClick={() => fileOps.current.create(root, "note")}><Icon name="file-text" size={14} /></button>
        <button className="icon-btn" title="New file" onClick={() => fileOps.current.create(root, "file")}><Icon name="file" size={14} /></button>
        <button className="icon-btn" title="New folder" onClick={() => fileOps.current.create(root, "folder")}><Icon name="folder-plus" size={14} /></button>
        <button className={`icon-btn ${hidden ? "on" : ""}`} title="Show hidden files" onClick={() => setHidden((h) => !h)}><Icon name="eye" size={14} /></button>
        <button className="icon-btn" title="Refresh" onClick={load}><Icon name="refresh" size={14} /></button>
      </div>
      {selected.length > 1 && (
        <div className="sel-bar">
          <span>{selected.length} selected</span><span className="grow" />
          <button onClick={() => { fileOps.current.trashMany(selected); setSel(new Set()); }}><Icon name="trash" size={13} /> Trash</button>
          <button onClick={() => setSel(new Set())}>Clear</button>
        </div>
      )}
      <div className={`panel-body ${dropOn === root ? "drop" : ""}`} tabIndex={0} onKeyDown={onKey} {...dropProps(root)}
        onContextMenu={(ev) => { ev.preventDefault(); openMenu(ev, "fs", { dir: true, path: root, name: space.name, root: true, reload: load }); }}>
        {kids[root] === null ? <div className="section-empty">This folder doesn't exist yet. Make something in it to create it.</div>
          : kids[root]?.length === 0 ? <div className="section-empty">Empty folder. Right-click for New…</div>
            : rows(root, 0)}
      </div>
    </>
  );
}

export default function SidePanel() {
  const { space, state, dispatch } = useApp();
  const drag = (e) => {
    e.preventDefault();
    const startX = e.clientX, startW = state.panel.width;
    const move = (ev) => dispatch({ type: "panel.width", width: startW - (ev.clientX - startX) });
    const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); document.body.classList.remove("resizing"); };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    document.body.classList.add("resizing");
  };
  if (!space) return null;
  return (
    <div className="files-panel" style={{ width: state.panel.width }}>
      <div className="panel-resize" onPointerDown={drag} />
      {state.panel.view === "links" ? <LinksPanel /> : <FilesBody key={space.folder} />}
    </div>
  );
}
