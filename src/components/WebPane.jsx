// A web app in a pane: Notion, Docs, Gmail, ChatGPT... a real browser view
// with its own toolbar. Logins are kept per space.
import React, { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useApp } from "../ctx.js";
import { Icon } from "../icons.jsx";
import { mountWeb, unmountWeb, navWeb, webLabel, subscribeWeb, webState } from "../apps/web.js";

const QUICK = [
  ["Notion", "https://www.notion.so"],
  ["Google Docs", "https://docs.google.com"],
  ["Gmail", "https://mail.google.com"],
  ["Google Calendar", "https://calendar.google.com"],
  ["ChatGPT", "https://chatgpt.com"],
  ["Claude", "https://claude.ai"],
  ["GitHub", "https://github.com"],
  ["YouTube", "https://www.youtube.com"],
];
const normal = (u) => {
  const v = u.trim();
  if (!v) return null;
  if (/^https?:\/\//i.test(v)) return v;
  if (/^[\w-]+(\.[\w-]+)+(\/.*)?$/.test(v)) return "https://" + v;
  return "https://duckduckgo.com/?q=" + encodeURIComponent(v);
};

export default function WebPane({ pane }) {
  const { dispatch, space, run, state } = useApp();
  const box = useRef(null);
  const label = webLabel(pane.id);
  const [draft, setDraft] = useState(pane.url ?? "");
  const live = useSyncExternalStore(subscribeWeb, () => webState(label));
  const ultraOn = state.look.webUltra !== false;
  useEffect(() => setDraft(pane.url ?? ""), [pane.url]);

  useEffect(() => {
    if (!pane.url || !box.current) return undefined;
    mountWeb(label, box.current, pane.url, space?.id ?? "default");
    return () => unmountWeb(label);
  }, [label, !!pane.url]); // eslint-disable-line react-hooks/exhaustive-deps

  const go = (u) => {
    const url = normal(u);
    if (!url) return;
    if (pane.url) navWeb(label, "go", url);
    dispatch({ type: "pane.patch", pane: pane.id, patch: { url } });
  };

  return (
    <div className="web-pane">
      <div className="web-bar">
        <button className="icon-btn" title="Back" disabled={!pane.url} onClick={() => navWeb(label, "back")}><Icon name="chevron-left" size={15} /></button>
        <button className="icon-btn" title="Forward" disabled={!pane.url} onClick={() => navWeb(label, "forward")}><Icon name="chevron-right" size={15} /></button>
        {live.loading
          ? <button className="icon-btn" title="Stop" onClick={() => navWeb(label, "stop")}><Icon name="refresh" size={14} className="spin" /></button>
          : <button className="icon-btn" title="Reload" disabled={!pane.url} onClick={() => navWeb(label, "reload")}><Icon name="refresh" size={14} /></button>}
        <input className="web-url" value={draft} placeholder="Search or type a web address" spellCheck={false}
          onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => e.key === "Enter" && go(draft)} onFocus={(e) => e.target.select()} />
        <div className="web-zoom" title="Page zoom (Ctrl + / Ctrl − / Ctrl 0 inside the page)">
          <button disabled={!pane.url} onClick={() => navWeb(label, "zoom-out")}>−</button>
          <button disabled={!pane.url} onClick={() => navWeb(label, "zoom-reset")}>{Math.round((live.zoom ?? 1) * 100)}%</button>
          <button disabled={!pane.url} onClick={() => navWeb(label, "zoom-in")}>+</button>
        </div>
        {ultraOn && <button className="icon-btn" title="Ultra fit: only this page, whole window (F11)" disabled={!pane.url} onClick={() => run("web.ultra", { pane: pane.id })}><Icon name="maximize" size={14} /></button>}
        <button className="icon-btn" title="Open in your browser" disabled={!pane.url} onClick={() => openUrl(pane.url).catch(() => {})}><Icon name="globe" size={14} /></button>
        {live.loading && <div className="web-progress" style={{ width: `${Math.max(8, live.progress * 100)}%` }} />}
      </div>
      {pane.url ? <div className="web-view" ref={box} /> : (
        <div className="web-start">
          <div className="empty-title">Open a web app</div>
          <div className="dim">Logins stay with this space ({space?.name}).</div>
          <div className="empty-grid">
            {QUICK.map(([n, u]) => <button key={u} className="empty-card" onClick={() => go(u)}><Icon name="globe" size={18} />{n}</button>)}
          </div>
        </div>
      )}
    </div>
  );
}
