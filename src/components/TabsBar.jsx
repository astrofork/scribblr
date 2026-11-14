// Herdr's tab bar (42px): tabs as rounded chips, + for a new drawing, and the
// side panel buttons (Files) on the right.
import React, { useRef } from "react";
import { useApp } from "../ctx.js";
import { Icon } from "../icons.jsx";
import { tabName, tabIcon } from "./Sidebar.jsx";
import { getCurrentWindow } from "@tauri-apps/api/window";

// Windows and macOS have no tiling WM to manage the frameless window, so the
// tab bar gets minimise / maximise / close (Linux tiling WMs don't need them).
const WINDOW_BUTTONS = /Windows|Macintosh/.test(navigator.userAgent);

export default function TabsBar() {
  const { state, space, tab, dispatch, run, openMenu, termTitles } = useApp();
  const pressed = useRef(null);
  const tabs = space?.tabs ?? [];
  return (
    <div
      className="tabs-bar"
      data-tauri-drag-region
      onPointerUp={() => { pressed.current = null; }}
      onWheel={(e) => { if (Math.abs(e.deltaY) >= 1) run(e.deltaY > 0 ? "tab.prev" : "tab.next"); }}
    >
      <div className="tab-scroll" data-tauri-drag-region>
        {tabs.map((t, i) => (
          <div
            key={t.id}
            className={`tab ${t.id === tab?.id ? "on" : ""}`}
            onPointerDown={(e) => { if (e.button !== 0) return; e.stopPropagation(); pressed.current = i; if (e.detail === 2) run("tab.rename", { id: t.id }); }}
            onPointerUp={(e) => {
              e.stopPropagation();
              const from = pressed.current; pressed.current = null;
              if (from !== null && from !== i) dispatch({ type: "tab.move", id: tabs[from].id, index: i });
              else dispatch({ type: "tab.select", id: t.id });
            }}
            onContextMenu={(e) => { e.preventDefault(); openMenu(e, "tab", t); }}
          >
            <Icon name={tabIcon(t)} size={13} className="dim" />
            <span className="tab-name truncate">{t.zoomed ? `${tabName(t, termTitles)} Z` : tabName(t, termTitles)}</span>
            {t.id === tab?.id && (
              <button className="tab-close" onPointerDown={(e) => e.stopPropagation()} onPointerUp={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); dispatch({ type: "tab.close", id: t.id }); }}>
                <Icon name="close" size={12} />
              </button>
            )}
          </div>
        ))}
      </div>
      {space && <button className="icon-btn dim" title="New…" onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); run("app.newmenu", { x: r.left, y: r.bottom }); }}>+</button>}
      {space && (
        <button className="panel-btn" title="Graph view (Ctrl+Shift+G)" onClick={() => run("graph.open")}>
          <Icon name="graph" size={14} /> Graph
        </button>
      )}
      {space && ["files", "links"].map((v) => (
        <button key={v} className={`panel-btn ${state.panel.open && (state.panel.view ?? "files") === v ? "on" : ""}`} onClick={() => run("panel.toggle", v)}>
          <Icon name={v === "files" ? "files" : "link"} size={14} /> {v === "files" ? "Files" : "Links"}
        </button>
      ))}
      {WINDOW_BUTTONS && (
        <div className="win-buttons">
          <button title="Minimise" onClick={() => getCurrentWindow().minimize()}>—</button>
          <button title="Maximise" onClick={() => getCurrentWindow().toggleMaximize()}>▢</button>
          <button className="close" title="Close" onClick={() => getCurrentWindow().close()}>✕</button>
        </div>
      )}
    </div>
  );
}
