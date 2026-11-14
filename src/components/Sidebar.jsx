// Herdr's sidebar: brand row (46px), Spaces, a second list (here: open
// drawings, where Herdr lists agents), and the footer (Settings, Add).
// Folded (ctrl+shift+b) it becomes a 44px rail.
import React, { useState } from "react";
import { useApp } from "../ctx.js";
import { Icon } from "../icons.jsx";
import { baseName, flatten, kindOf, KIND_ICON } from "../api.js";
import { panesOf } from "../store.js";
import { isGraph } from "../links.js";

const SPECIAL = { "scribblr:graph": ["Graph", "graph"], "scribblr:terminal": ["Terminal", "terminal"], "scribblr:calendar": ["Calendar", "calendar"], "scribblr:web": ["Web app", "globe"], "scribblr:files": ["Files", "folder-open"] };
const host = (u) => { try { return new URL(u).host.replace(/^www\./, ""); } catch { return ""; } };
const focusedPane = (t) => panesOf(t.root).find((p) => p.id === t.focused) ?? panesOf(t.root)[0];
const tabName = (t, titles) => {
  if (t.name) return t.name;
  const p = focusedPane(t);
  const f = p?.file;
  if (f === "scribblr:terminal" && titles?.[p.id]) return titles[p.id];
  if (f === "scribblr:web") return p.title || host(p.url) || "Web app";
  if (f === "scribblr:files") return (p.cwd ?? "").split("/").pop() || "Files";
  return SPECIAL[f]?.[0] ?? (f ? baseName(f) : "Empty");
};
const tabIcon = (t) => { const f = focusedPane(t)?.file; return SPECIAL[f]?.[1] ?? KIND_ICON[kindOf(f)] ?? "file"; };
void isGraph;

function Brand() {
  const { state, run } = useApp();
  const collapsed = state.sidebar.collapsed;
  return (
    <div className={`brand ${collapsed ? "rail" : ""}`} data-tauri-drag-region>
      {!collapsed && (
        <div className="brand-name" data-tauri-drag-region>
          <img src="./scribblr.png" width="20" height="20" alt="" className="brand-logo" />
          <span data-tauri-drag-region>Scribblr</span>
        </div>
      )}
      {!collapsed && <button className="icon-btn" title="Search" onClick={() => run("app.picker")}><Icon name="search" size={15} /></button>}
      <button className="icon-btn" title="Toggle sidebar" onClick={() => run("layout.toggle", "sidebar")}><Icon name="sidebar" size={15} /></button>
    </div>
  );
}

function Spaces() {
  const { state, dispatch, run, theme, drawings, openMenu } = useApp();
  const collapsed = state.sidebar.collapsed;
  const [drag, setDrag] = useState(null);
  const [over, setOver] = useState(null);
  const fill = (c) => (c?.startsWith("#") ? c : theme.colors[c] ?? theme.colors.ansi6);
  return (
    <div className="section">
      <div className={`section-head ${collapsed ? "rail" : ""}`}>
        {!collapsed && <span>Spaces</span>}
        <button className="icon-btn" title="New space" onClick={() => run("space.new")}><Icon name="plus" size={14} /></button>
      </div>
      <div className="section-list" onPointerUp={() => { setDrag(null); setOver(null); }}>
        {state.spaces.map((sp, i) => {
          const on = sp.id === state.activeSpace;
          const count = flatten(drawings[sp.folder] ?? []).length;
          if (collapsed) {
            return (
              <button key={sp.id} className={`rail-cell ${on ? "on" : ""}`} title={sp.name} onClick={() => dispatch({ type: "space.select", id: sp.id })}>
                {i + 1}
              </button>
            );
          }
          const from = state.spaces.findIndex((x) => x.id === drag);
          return (
            <div
              key={sp.id}
              className={`space-row ${on ? "on" : ""} ${drag === sp.id && over !== sp.id ? "dragging" : ""}`}
              onPointerDown={(e) => { if (e.button === 0) { setDrag(sp.id); setOver(sp.id); } }}
              onPointerEnter={() => drag && setOver(sp.id)}
              onPointerUp={(e) => {
                e.stopPropagation();
                if (drag && drag !== sp.id && over === sp.id) dispatch({ type: "space.move", id: drag, index: i });
                else if (drag === sp.id) dispatch({ type: "space.select", id: sp.id });
                setDrag(null); setOver(null);
              }}
              onContextMenu={(e) => { e.preventDefault(); openMenu(e, "space", sp); }}
            >
              {drag && over === sp.id && drag !== sp.id && <div className={`drop-line ${from < i ? "bottom" : "top"}`} />}
              <div className="space-badge" style={{ background: fill(sp.color) }}>{[...sp.name][0]?.toUpperCase() ?? "?"}</div>
              <div className="space-name truncate">{sp.name}</div>
              <div className="space-tail">{count ? `${count}` : ""}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function OpenDrawings() {
  const { state, dispatch, termTitles } = useApp();
  const collapsed = state.sidebar.collapsed;
  const rows = state.spaces.flatMap((sp) => sp.tabs.map((t) => ({ sp, t })));
  return (
    <div className="section">
      <div className={`section-head ${collapsed ? "rail" : ""}`}>
        {collapsed ? <Icon name="layers" size={13} /> : <span>Open</span>}
        {!collapsed && <span className="section-count">{rows.length || ""}</span>}
      </div>
      <div className="section-list">
        {rows.map(({ sp, t }) => {
          const on = sp.id === state.activeSpace && t.id === sp.activeTab;
          const go = () => { dispatch({ type: "space.select", id: sp.id }); dispatch({ type: "tab.select", id: t.id }); };
          const icon = tabIcon(t);
          if (collapsed) return <button key={t.id} className={`rail-cell ${on ? "on" : ""}`} title={tabName(t, termTitles)} onClick={go}><Icon name={icon} size={13} /></button>;
          return (
            <div key={t.id} className={`drawing-row ${on ? "on" : ""}`} onClick={go}>
              <Icon name={icon} size={13} className="dim" />
              <div className="truncate drawing-name">{tabName(t, termTitles)}{panesOf(t.root).length > 1 ? <span className="dim"> +{panesOf(t.root).length - 1}</span> : null}</div>
              <div className="drawing-space truncate">{sp.name}</div>
            </div>
          );
        })}
        {!rows.length && !collapsed && <div className="section-empty">Nothing open</div>}
      </div>
    </div>
  );
}

function Footer() {
  const { state, run } = useApp();
  const collapsed = state.sidebar.collapsed;
  const row = (id, icon, label, dim, cmd) => (
    <button key={id} className={`foot-row ${collapsed ? "rail" : ""} ${dim ? "dim" : ""}`} title={label} onClick={() => run(cmd)}>
      <Icon name={icon} size={14} />{!collapsed && <span>{label}</span>}
    </button>
  );
  return (
    <div className={`sidebar-footer ${collapsed ? "rail" : ""}`}>
      {row("settings", "settings", "Settings", false, "app.settings")}
      {row("add", "folder-plus", "Add folder as space", true, "space.new")}
    </div>
  );
}

export { tabName, tabIcon };
export default function Sidebar() {
  const { state } = useApp();
  return (
    <aside className={`sidebar ${state.sidebar.collapsed ? "collapsed" : ""}`} style={{ width: state.sidebar.collapsed ? 44 : state.sidebar.width }}>
      <Brand />
      <div className="sidebar-lists">
        <Spaces />
        <OpenDrawings />
      </div>
      <Footer />
    </aside>
  );
}
