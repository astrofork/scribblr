// The Links side panel: what the focused drawing links to, and what links
// back to it (backlinks). Unmade links can be created with one click.
import React from "react";
import { useApp } from "../ctx.js";
import { Icon } from "../icons.jsx";
import { baseName, tilde } from "../api.js";
import { panesOf } from "../store.js";
import { isGraph } from "../links.js";

export default function LinksPanel() {
  const { tab, graph, openFile, openLink, run, home, dispatch, removeLink } = useApp();
  const file = tab && panesOf(tab.root).find((p) => p.id === tab.focused)?.file;
  const real = file && !isGraph(file) && !file.startsWith("scribblr:") ? file : null;
  const outs = real ? graph.outgoing.get(real) ?? [] : [];
  const backs = real ? [...new Set(graph.backlinks.get(real) ?? [])] : [];
  const row = (key, icon, label, detail, onClick, ghost, onSplit, onRemove) => (
    <div key={key} className={`file-row link-row ${ghost ? "ghost" : ""}`} onClick={onClick} onContextMenu={(e) => { e.preventDefault(); onSplit?.(); }} title={ghost ? "Not made yet: click to create it" : "Click to open · right-click to open to the right"}>
      <Icon name={icon} size={13} className="dim" />
      <span className="truncate">{label}</span>
      <span className="grow" />
      {detail && <span className="row-detail truncate">{detail}</span>}
      {onRemove && <button className="link-x" title="Remove link" onClick={(e) => { e.stopPropagation(); onRemove(); }}><Icon name="x" size={12} /></button>}
    </div>
  );
  const folder = (p) => tilde(p.slice(0, p.lastIndexOf("/")), home);
  return (
    <>
      <div className="panel-head">
        <span className="truncate">{real ? baseName(real) : "No drawing focused"}</span>
        <span className="grow" />
        <button className="icon-btn" title="Link this drawing to… (Ctrl+Shift+L)" onClick={() => run("link.insert")}><Icon name="link" size={14} /></button>
        <button className="icon-btn" title="Graph view (Ctrl+Shift+G)" onClick={() => run("graph.open")}><Icon name="graph" size={14} /></button>
      </div>
      <div className="panel-body">
        <div className="panel-sub">Links <span className="dim">{outs.length || ""}</span></div>
        {outs.map((o) => row("o" + o.name, "link", o.name, o.path ? folder(o.path) : "not made yet",
          () => openLink(o.name, real, false), !o.path, () => openLink(o.name, real, true), () => removeLink(o.name, real)))}
        {real && (
          <div className="file-row link-row add" onClick={() => run("link.insert")}>
            <Icon name="plus" size={13} className="dim" /><span>Link a drawing…</span><span className="grow" /><span className="row-key">Ctrl+Shift+L</span>
          </div>
        )}
        <div className="panel-sub">Backlinks <span className="dim">{backs.length || ""}</span></div>
        {backs.map((p) => row("b" + p, "pen", baseName(p), folder(p), () => openFile(p), false, () => dispatch({ type: "pane.split", dir: "right", file: p })))}
        {real && !backs.length && <div className="section-empty">No drawing links here yet.</div>}
      </div>
    </>
  );
}
