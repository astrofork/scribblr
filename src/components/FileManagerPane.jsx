// Files app, Nautilus-style: places on the left, a path bar with back /
// forward / up, icon grid (with image thumbnails) or list view, search,
// multi-select, copy / cut / paste, drag onto a folder to move, rename (F2),
// trash (Delete), open (double-click / Enter): Scribblr files open in their
// app, everything else in its system app.
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { useApp } from "../ctx.js";
import { Icon } from "../icons.jsx";
import { api, kindOf, tilde } from "../api.js";
import { FileIcon } from "../apps/fileIcon.jsx";

const clip = { paths: [], cut: false }; // shared by every Files tab
const IMG = /\.(png|jpe?g|gif|webp|svg|bmp|avif|ico)$/i;
// const CODE = /\.(js|jsx|ts|tsx|py|rs|go|c|cpp|h|java|kt|rb|php|sh|lua|json|toml|ya?ml|md|txt|html|css|sql)$/i;
const fmtSize = (n) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : n < 1073741824 ? `${(n / 1048576).toFixed(1)} MB` : `${(n / 1073741824).toFixed(1)} GB`);
const fmtDate = (s) => (s ? new Date(s * 1000).toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "");
const shown = (e) => (kindOf(e.path) ? e.name.replace(/\.(excalidraw|note|calendar)$/, "") : e.name);

export default function FileManagerPane({ pane }) {
  const { dispatch, home, space, openAny, openMenu, fileOps, state } = useApp();
  const [cwd, setCwd] = useState(pane.cwd ?? space?.folder ?? home);
  const [back, setBack] = useState([]);
  const [fwd, setFwd] = useState([]);
  const [items, setItems] = useState([]);
  const [error, setError] = useState(null);
  const [sel, setSel] = useState(new Set());
  const [anchor, setAnchor] = useState(null);
  const [view, setView] = useState(() => localStorage.getItem("fm.view") ?? "grid");
  const [hidden, setHidden] = useState(false);
  const [query, setQuery] = useState("");
  const [dropOn, setDropOn] = useState(null);
  const [renaming, setRenaming] = useState(null);
  const box = useRef(null);

  const load = useCallback(async () => {
    try {
      const list = await api.listDir(cwd, hidden);
      setItems((old) => (JSON.stringify(old) === JSON.stringify(list) ? old : list));
      setError(null);
    } catch (e) { setError(String(e)); setItems([]); }
  }, [cwd, hidden]);
  useEffect(() => { load(); const t = setInterval(load, 2500); return () => clearInterval(t); }, [load]);
  useEffect(() => { dispatch({ type: "pane.cwd", pane: pane.id, cwd }); setSel(new Set()); }, [cwd]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { try { localStorage.setItem("fm.view", view); } catch { /* ok */ } }, [view]);

  const go = (dir) => { if (dir === cwd) return; setBack((b) => [...b, cwd]); setFwd([]); setCwd(dir); setQuery(""); };
  const goBack = () => back.length && (setFwd((f) => [cwd, ...f]), setCwd(back[back.length - 1]), setBack((b) => b.slice(0, -1)));
  const goFwd = () => fwd.length && (setBack((b) => [...b, cwd]), setCwd(fwd[0]), setFwd((f) => f.slice(1)));
  // "C:/Users/me" on Windows, "/home/me" elsewhere.
  const drive = /^[A-Za-z]:/.test(cwd) ? cwd.slice(0, 2) : "";
  const up = () => { let p = cwd.slice(0, cwd.lastIndexOf("/")); if (!p || p === drive) p = drive ? drive + "/" : "/"; go(p); };

  const list = useMemo(() => (query ? items.filter((e) => e.name.toLowerCase().includes(query.toLowerCase())) : items), [items, query]);
  const selected = list.filter((e) => sel.has(e.path));

  const open = (e, split) => (e.dir ? go(e.path) : openAny(e.path, split));
  const click = (ev, e, i) => {
    const n = new Set(ev.ctrlKey || ev.metaKey ? sel : []);
    if (ev.shiftKey && anchor !== null) {
      const a = Math.min(anchor, i), b = Math.max(anchor, i);
      for (let k = a; k <= b; k++) n.add(list[k].path);
    } else if ((ev.ctrlKey || ev.metaKey) && sel.has(e.path)) n.delete(e.path);
    else n.add(e.path);
    if (!ev.shiftKey) setAnchor(i);
    setSel(n);
  };

  const paste = async () => {
    if (!clip.paths.length) return;
    if (clip.cut) { for (const p of clip.paths) await fileOps.current.move(p, cwd); clip.paths = []; }
    else await api.copyPaths(clip.paths, cwd).catch((e) => setError(String(e)));
    load();
  };
  const trash = () => fileOps.current.trashMany?.(selected.map((e) => e.path));
  const finishRename = async (e, name) => {
    setRenaming(null);
    if (!name || name === shown(e)) return;
    await fileOps.current.rename?.(e.path, name);
    load();
  };

  const onKey = (ev) => {
    if (renaming || ev.target.tagName === "INPUT") return;
    const k = ev.key, c = ev.ctrlKey || ev.metaKey;
    if (c && k.toLowerCase() === "a") { setSel(new Set(list.map((e) => e.path))); ev.preventDefault(); }
    else if (c && k.toLowerCase() === "c" && selected.length) { clip.paths = selected.map((e) => e.path); clip.cut = false; }
    else if (c && k.toLowerCase() === "x" && selected.length) { clip.paths = selected.map((e) => e.path); clip.cut = true; }
    else if (c && k.toLowerCase() === "v") paste();
    else if (k === "Delete" && selected.length) trash();
    else if (k === "F2" && selected.length === 1) setRenaming(selected[0].path);
    else if (k === "Enter" && selected.length) selected.forEach((e) => open(e));
    else if (k === "Backspace" || (ev.altKey && k === "ArrowLeft")) goBack();
    else if (ev.altKey && k === "ArrowRight") goFwd();
    else if (ev.altKey && k === "ArrowUp") up();
    else if (k === "Escape") setSel(new Set());
    else return;
    ev.stopPropagation();
  };

  const dropProps = (dir) => ({
    onDragOver: (ev) => { if (ev.dataTransfer.types.includes("application/x-scribblr-paths")) { ev.preventDefault(); ev.stopPropagation(); setDropOn(dir); } },
    onDragLeave: () => setDropOn((d) => (d === dir ? null : d)),
    onDrop: async (ev) => {
      ev.preventDefault(); ev.stopPropagation(); setDropOn(null);
      const paths = JSON.parse(ev.dataTransfer.getData("application/x-scribblr-paths") || "[]");
      for (const p of paths) if (p !== dir && !dir.startsWith(p + "/") && p.slice(0, p.lastIndexOf("/")) !== dir) await fileOps.current.move(p, dir);
      load();
    },
  });

  const places = [
    { label: "Home", icon: "monitor", folder: "home", path: home },
    ...state.spaces.map((sp) => ({ label: sp.name, icon: "layers", path: sp.folder })),
    ...["Desktop", "Documents", "Downloads", "Pictures", "Music", "Videos", "Projects"].map((n) => ({ label: n, icon: "folder", folder: n, path: `${home}/${n}` })),
    ...(space ? [{ label: "Trash", icon: "trash", folder: "trash", path: `${space.folder}/.trash` }] : []),
  ];
  const crumbs = useMemo(() => {
    const parts = cwd.split("/").filter(Boolean);
    return parts.map((p, i) => ({ name: p, path: drive ? (i === 0 ? p + "/" : parts.slice(0, i + 1).join("/")) : "/" + parts.slice(0, i + 1).join("/") }));
  }, [cwd, drive]);

  const item = (e, i) => {
    const on = sel.has(e.path);
    const thumb = !e.dir && IMG.test(e.name) && e.size < 30e6;
    const common = {
      key: e.path,
      draggable: renaming !== e.path,
      onDragStart: (ev) => {
        const paths = on ? selected.map((x) => x.path) : [e.path];
        ev.dataTransfer.setData("application/x-scribblr-paths", JSON.stringify(paths));
        ev.dataTransfer.setData("application/x-scribblr-path", paths[0]);
        ev.dataTransfer.effectAllowed = "move";
      },
      ...(e.dir ? dropProps(e.path) : {}),
      onClick: (ev) => { ev.stopPropagation(); click(ev, e, i); },
      onDoubleClick: () => open(e),
      onContextMenu: (ev) => { ev.preventDefault(); ev.stopPropagation(); if (!on) setSel(new Set([e.path])); openMenu(ev, "fs", { ...e, reload: load, fm: { copy: () => { clip.paths = (on ? selected : [e]).map((x) => x.path); clip.cut = false; }, cut: () => { clip.paths = (on ? selected : [e]).map((x) => x.path); clip.cut = true; }, paste, rename: () => setRenaming(e.path) } }); },
      title: e.name,
    };
    const name = renaming === e.path
      ? <input className="fm-rename" autoFocus defaultValue={shown(e)} onClick={(ev) => ev.stopPropagation()} onFocus={(ev) => ev.target.select()}
          onBlur={(ev) => finishRename(e, ev.target.value.trim())} onKeyDown={(ev) => { if (ev.key === "Enter") ev.target.blur(); if (ev.key === "Escape") setRenaming(null); ev.stopPropagation(); }} />
      : <span className="fm-name">{shown(e)}</span>;
    if (view === "list") {
      return (
        <div {...common} className={`fm-row ${on ? "on" : ""} ${dropOn === e.path ? "drop" : ""} ${clip.cut && clip.paths.includes(e.path) ? "cut" : ""}`}>
          <FileIcon name={e.name} dir={e.dir} size={18} />
          {name}
          <span className="fm-meta">{e.dir ? "" : fmtSize(e.size)}</span>
          <span className="fm-meta wide">{fmtDate(e.modified)}</span>
        </div>
      );
    }
    return (
      <div {...common} className={`fm-tile ${on ? "on" : ""} ${dropOn === e.path ? "drop" : ""} ${clip.cut && clip.paths.includes(e.path) ? "cut" : ""}`}>
        <div className="fm-thumb">
          {thumb ? <img src={convertFileSrc(e.path)} alt="" loading="lazy" draggable={false} />
            : <FileIcon name={e.name} dir={e.dir} size={52} />}
        </div>
        {name}
      </div>
    );
  };

  return (
    <div className="fm" ref={box} tabIndex={0} onKeyDown={onKey}>
      <div className="fm-bar">
        <button className="icon-btn" title="Back (Alt+←)" disabled={!back.length} onClick={goBack}><Icon name="chevron-left" size={16} /></button>
        <button className="icon-btn" title="Forward (Alt+→)" disabled={!fwd.length} onClick={goFwd}><Icon name="chevron-right" size={16} /></button>
        <div className="fm-path">
          {!drive && <button onClick={() => go("/")}>/</button>}
          {crumbs.map((c, i) => (
            <React.Fragment key={c.path}>
              {i > 0 && <span className="dim">/</span>}
              <button className={c.path === cwd ? "on" : ""} onClick={() => go(c.path)} {...dropProps(c.path)}>{c.path === home ? "Home" : c.name}</button>
            </React.Fragment>
          ))}
        </div>
        <input className="fm-search" placeholder="Search" value={query} onChange={(e) => setQuery(e.target.value)} />
        <button className="icon-btn" title="New folder" onClick={() => fileOps.current.create(cwd, "folder")}><Icon name="folder-plus" size={15} /></button>
        <button className={`icon-btn ${hidden ? "on" : ""}`} title="Show hidden files" onClick={() => setHidden((h) => !h)}><Icon name="eye" size={15} /></button>
        <button className="icon-btn" title={view === "grid" ? "List view" : "Grid view"} onClick={() => setView((v) => (v === "grid" ? "list" : "grid"))}><Icon name={view === "grid" ? "layers" : "square"} size={15} /></button>
      </div>
      <div className="fm-body">
        <div className="fm-places">
          {places.map((p) => (
            <button key={p.path + p.label} className={`fm-place ${cwd === p.path ? "on" : ""}`} onClick={() => go(p.path)} {...dropProps(p.path)}>
              {p.folder ? <FileIcon name={p.folder} dir size={17} /> : <Icon name={p.icon} size={14} />}<span className="truncate">{p.label}</span>
            </button>
          ))}
        </div>
        <div className={`fm-main ${view} ${dropOn === cwd ? "drop" : ""}`} {...dropProps(cwd)}
          onClick={() => setSel(new Set())}
          onContextMenu={(ev) => { ev.preventDefault(); openMenu(ev, "fs", { dir: true, path: cwd, name: cwd.split("/").pop(), root: true, reload: load, fm: { paste } }); }}>
          {error && <div className="section-empty">{error}</div>}
          {view === "list" && list.length > 0 && <div className="fm-row head"><span /><span className="fm-name">Name</span><span className="fm-meta">Size</span><span className="fm-meta wide">Modified</span></div>}
          {list.map(item)}
          {!error && !list.length && <div className="fm-empty">{query ? "Nothing matches" : "This folder is empty"}</div>}
        </div>
      </div>
      <div className="fm-status">
        {selected.length ? `${selected.length} selected` : `${list.length} item${list.length === 1 ? "" : "s"}`} · {tilde(cwd, home)}
        {clip.paths.length > 0 && <span className="dim"> · {clip.paths.length} on clipboard ({clip.cut ? "cut" : "copied"})</span>}
      </div>
    </div>
  );
}
