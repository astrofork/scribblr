// The panes, framed like Herdr's: gap 8, radius 10, a 30px header (icon,
// name, folder; links, background, split, focus, close). Every tab of every
// space stays mounted (hidden when not shown): drawings keep their undo
// history and terminals keep running while you move around. Zoom (inside the
// tab) and focus mode (the whole window) are CSS, so nothing reloads.
import React, { useRef, useState } from "react";
import { useApp } from "../ctx.js";
import { Icon } from "../icons.jsx";
import Canvas from "./Canvas.jsx";
import GraphView from "./GraphView.jsx";
import TerminalPane from "./TerminalPane.jsx";
import NotePane from "./NotePane.jsx";
import CalendarPane from "./CalendarPane.jsx";
import FileManagerPane from "./FileManagerPane.jsx";
import WebPane from "./WebPane.jsx";
import BgPicker from "./BgPicker.jsx";
import { baseName, tilde, flatten, kindOf, KIND_ICON } from "../api.js";
import { panesOf } from "../store.js";

import { APPS, appFor } from "../apps/registry.js";

export const paneKind = (p) => appFor(p.file)?.id ?? null;

function Split({ node, tab }) {
  const { dispatch } = useApp();
  const ref = useRef(null);
  const row = node.dir === "row";
  const r = node.ratio ?? 0.5;
  const drag = (e) => {
    e.preventDefault();
    const box = ref.current.getBoundingClientRect();
    const move = (ev) => {
      const ratio = row ? (ev.clientX - box.left) / box.width : (ev.clientY - box.top) / box.height;
      dispatch({ type: "pane.ratio", split: node.id, ratio });
    };
    const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); document.body.classList.remove("resizing"); };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    document.body.classList.add("resizing");
  };
  return (
    <div ref={ref} className={`split ${row ? "row" : "col"}`}>
      <div className="split-part" style={{ flex: `${r} 1 0` }}><Node node={node.a} tab={tab} /></div>
      <div className={`divider ${row ? "v" : "h"}`} onPointerDown={drag} />
      <div className="split-part" style={{ flex: `${1 - r} 1 0` }}><Node node={node.b} tab={tab} /></div>
    </div>
  );
}

function EmptyPane({ pane }) {
  const { dispatch, space, drawings, newItem } = useApp();
  const list = flatten(drawings[space?.folder] ?? []);
  const set = (file, extra) => dispatch({ type: "pane.file", pane: pane.id, file, ...extra });
  return (
    <div className="empty-pane">
      <div className="empty-title">Open something</div>
      <div className="empty-grid">
        {APPS.map((a) => (
          <button key={a.id} className="empty-card" onClick={async () => set(a.special ?? await newItem(a.id))}>
            <Icon name={a.icon} size={18} />{a.label}
          </button>
        ))}
      </div>
      <div className="empty-list">
        {list.map((d) => (
          <button key={d.path} className="empty-row" onClick={() => set(d.path)}>
            <Icon name={KIND_ICON[kindOf(d.path)] ?? "file"} size={13} /> <span className="truncate">{baseName(d.path)}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function Pane({ pane, tab }) {
  const { dispatch, run, dark, home, apis, canvases, epoch, graph: links, termTitles } = useApp();
  const [picker, setPicker] = useState(false);
  const kind = paneKind(pane);
  const focused = tab.focused === pane.id;
  const multi = panesOf(tab.root).length > 1;
  const full = tab.full === pane.id;
  const zoomed = tab.zoomed === pane.id;
  const real = pane.file && !pane.file.startsWith("scribblr:");
  const linkCount = real ? (links.outgoing.get(pane.file)?.length ?? 0) + new Set(links.backlinks.get(pane.file) ?? []).size : 0;
  const host = (u) => { try { return new URL(u).host.replace(/^www\./, ""); } catch { return ""; } };
  const name = kind === "terminal" ? termTitles[pane.id] || "Terminal" : kind === "web" ? pane.title || host(pane.url) || "Web app"
    : kind === "files" ? (pane.cwd ?? "").split("/").pop() || "Files" : kind === "graph" ? "Graph" : pane.file === "scribblr:calendar" ? "Calendar" : pane.file ? baseName(pane.file) : "Empty";
  const where = kind === "terminal" || kind === "files" ? pane.cwd : kind === "web" ? host(pane.url) : real ? pane.file.slice(0, pane.file.lastIndexOf("/")) : "";
  const btn = (title, icon, cmd, args) => (
    <button key={title} className="ph-btn" title={title} onClick={(e) => { e.stopPropagation(); run(cmd, { pane: pane.id, ...args }); }}>
      <Icon name={icon} size={14} />
    </button>
  );
  return (
    <div data-pane={pane.id}
      className={`pane ${focused && (multi || full) ? "focused" : ""} ${full ? "pane-full" : ""} ${full && pane.ultra ? "ultra" : ""} ${zoomed && !full ? "pane-zoomed" : ""}`}
      onPointerDownCapture={() => !focused && dispatch({ type: "pane.focus", pane: pane.id })}>
      <div className="pane-head" onDoubleClick={() => run("pane.full", { pane: pane.id })}>
        <Icon name={KIND_ICON[kind] ?? "file"} size={14} className="dim" />
        <div className="ph-name truncate">{name}</div>
        <div className="ph-folder truncate">{tilde(where, home)}</div>
        <div className="ph-actions">
          {real && (
            <button className="ph-btn ph-links" title="Links (Ctrl+Shift+L to add)" onClick={(e) => { e.stopPropagation(); dispatch({ type: "pane.focus", pane: pane.id }); dispatch({ type: "panel.toggle", view: "links", open: true }); }}>
              <Icon name="link" size={13} />{linkCount > 0 && <span>{linkCount}</span>}
            </button>
          )}
          {kind === "drawing" && (
            <div className="ph-bg-wrap">
              <button className="ph-btn" title="Canvas background" onClick={(e) => { e.stopPropagation(); setPicker((v) => !v); }}><Icon name="palette" size={14} /></button>
              {picker && <BgPicker getApi={() => apis.current[pane.id]} onClose={() => setPicker(false)} />}
            </div>
          )}
          {btn("Split right", "split-right", "pane.split", { dir: "right" })}
          {btn("Split down", "split-down", "pane.split", { dir: "down" })}
          {btn(full ? "Exit focus mode (Ctrl+Shift+F)" : "Focus mode: fill the window (Ctrl+Shift+F)", full ? "minimize" : "maximize", "pane.full")}
          {btn("Close", "close", "pane.close")}
        </div>
      </div>
      <div className="pane-body">
        {kind === "graph" ? <GraphView />
          : kind === "terminal" ? <TerminalPane pane={pane} focused={focused} />
            : kind === "files" ? <FileManagerPane pane={pane} />
            : kind === "web" ? <WebPane pane={pane} />
            : kind === "calendar" ? <CalendarPane file={pane.file === "scribblr:calendar" ? null : pane.file} />
              : kind === "note" ? <NotePane file={pane.file} />
                : kind === "drawing" ? (
                  <Canvas key={pane.file + ":" + epoch} file={pane.file} dark={dark} paneId={pane.id} registry={canvases}
                    onApi={(a) => { apis.current[pane.id] = a; }} />
                ) : <EmptyPane pane={pane} />}
      </div>
    </div>
  );
}

function Node({ node, tab }) {
  return node.type === "pane" ? <Pane pane={node} tab={tab} /> : <Split node={node} tab={tab} />;
}

export default function Workspace() {
  const { state, space, tab, newItem, run } = useApp();
  return (
    <div className="panes-stack">
      {!space && (
        <div className="welcome">
          <img src="./scribblr.png" width="72" height="72" alt="" />
          <div className="welcome-title">Welcome to Scribblr</div>
          <div className="welcome-sub">A space is a folder: drawings, notes, calendars and terminals. Add one to start.</div>
          <button className="solid-btn" onClick={() => run("space.new")}>Add a space</button>
        </div>
      )}
      {space && !tab && (
        <div className="welcome">
          <div className="welcome-title">{space.name}</div>
          <div className="welcome-sub">Nothing open in this space.</div>
          <div className="welcome-actions">
            <button className="solid-btn" onClick={() => newItem("drawing", true)}>New drawing</button>
            <button className="ghost-btn" onClick={() => newItem("note", true)}>New note</button>
            <button className="ghost-btn" onClick={() => run("new.terminal", { tab: true })}>Terminal</button>
            <button className="ghost-btn" onClick={() => run("calendar.open", { tab: true })}>Calendar</button>
          </div>
        </div>
      )}
      {state.spaces.flatMap((sp) => sp.tabs.map((t) => (
        <div key={t.id} className={`panes ${sp.id === space?.id && t.id === tab?.id ? "" : "hidden-tab"}`}>
          <Node node={t.root} tab={t} />
        </div>
      )))}
    </div>
  );
}
