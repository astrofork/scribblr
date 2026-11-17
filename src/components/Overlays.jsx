// Herdr's overlays: command palette, picker, prompt (rename / name), right-click
// menus, settings, help. One at a time, Esc closes.
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useApp } from "../ctx.js";
import { Icon } from "../icons.jsx";
import { baseName, tilde, flatten, kindOf, KIND_ICON } from "../api.js";
import { prettyKey } from "../keys.js";
import { SPACE_COLORS } from "../store.js";
import { APPS } from "../apps/registry.js";

const score = (q, text) => {
  if (!q) return 1;
  const t = text.toLowerCase(); q = q.toLowerCase();
  if (t.includes(q)) return 100 - t.indexOf(q);
  let i = 0;
  for (const ch of t) if (ch === q[i]) i++;
  return i === q.length ? 1 : 0;
};

function useEsc(close) {
  useEffect(() => {
    const k = (e) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); } };
    window.addEventListener("keydown", k, true);
    return () => window.removeEventListener("keydown", k, true);
  }, [close]);
}

function ListDialog({ placeholder, items, onPick, close, extra }) {
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const listRef = useRef(null);
  useEsc(close);
  const shown = useMemo(() => items.map((it) => ({ it, s: score(q, it.label + " " + (it.detail ?? "")) })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s).map((x) => x.it).slice(0, 200).concat(extra ? extra(q) : []), [q, items, extra]);
  useEffect(() => setSel(0), [q]);
  useEffect(() => { listRef.current?.children[sel]?.scrollIntoView({ block: "nearest" }); }, [sel]);
  return (
    <div className="scrim" onPointerDown={close}>
      <div className="dialog list-dialog" onPointerDown={(e) => e.stopPropagation()}>
        <input
          autoFocus className="dialog-input" placeholder={placeholder} value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => Math.min(s + 1, shown.length - 1)); }
            else if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)); }
            else if (e.key === "Enter" && shown[sel]) { close(); onPick(shown[sel]); }
          }}
        />
        <div className="dialog-list" ref={listRef}>
          {shown.map((it, i) => (
            <div key={it.id} className={`dialog-row ${i === sel ? "on" : ""}`} onPointerEnter={() => setSel(i)} onClick={() => { close(); onPick(it); }}>
              {it.icon && <Icon name={it.icon} size={14} className="dim" />}
              <span className="truncate">{it.label}</span>
              <span className="grow" />
              {it.detail && <span className="row-detail truncate">{it.detail}</span>}
              {it.key && <span className="row-key">{prettyKey(it.key)}</span>}
            </div>
          ))}
          {!shown.length && <div className="section-empty">Nothing matches</div>}
        </div>
      </div>
    </div>
  );
}

export function Palette({ close }) {
  const { commands, keymap, run } = useApp();
  const keyOf = (id) => Object.entries(keymap).find(([, v]) => v === id || (typeof v === "string" && v.split(":")[0] === id && !v.includes(":")))?.[0];
  const items = commands.filter((c) => c.title).map((c) => ({ id: c.id + (c.arg ?? ""), label: c.title, key: keyOf(c.arg ? `${c.id}:${c.arg}` : c.id), cmd: c }));
  return <ListDialog placeholder="Type a command" items={items} close={close} onPick={(it) => run(it.cmd.id, it.cmd.arg)} />;
}

export function Picker({ close }) {
  const { state, drawings, home, openFile, dispatch } = useApp();
  const icon = (p) => KIND_ICON[kindOf(p)] ?? "file";
  const items = [
    ...state.spaces.map((sp) => ({ id: "s" + sp.id, icon: "layers", label: sp.name, detail: "space · " + tilde(sp.folder, home), space: sp })),
    ...state.spaces.flatMap((sp) => flatten(drawings[sp.folder] ?? []).map((d) => ({ id: d.path, icon: icon(d.path), label: baseName(d.path), detail: sp.name, file: d.path, space: sp }))),
  ];
  return (
    <ListDialog placeholder="Find a drawing, note, calendar or space" items={items} close={close}
      onPick={(it) => (it.file ? openFile(it.file, it.space.id) : dispatch({ type: "space.select", id: it.space.id }))} />
  );
}

export function Prompt({ title, value, confirm, onDone, close }) {
  const [v, setV] = useState(value ?? "");
  useEsc(close);
  return (
    <div className="scrim" onPointerDown={close}>
      <div className="dialog prompt" onPointerDown={(e) => e.stopPropagation()}>
        <div className="dialog-title">{title}</div>
        <input autoFocus className="dialog-input boxed" value={v} onFocus={(e) => e.target.select()} onChange={(e) => setV(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { close(); onDone(v.trim()); } }} />
        <div className="dialog-actions">
          <button className="ghost-btn" onClick={close}>Cancel</button>
          <button className="solid-btn" onClick={() => { close(); onDone(v.trim()); }}>{confirm ?? "Save"}</button>
        </div>
      </div>
    </div>
  );
}

export function Confirm({ title, detail, confirm, onYes, close }) {
  useEsc(close);
  return (
    <div className="scrim" onPointerDown={close}>
      <div className="dialog prompt" onPointerDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => { if (e.key === "Enter") { close(); onYes(); } }} tabIndex={-1} ref={(el) => el?.focus()}>
        <div className="dialog-title">{title} <span className="grow" /><span className="row-key">Esc</span></div>
        <div className="dialog-detail">{detail}</div>
        <div className="dialog-actions">
          <button className="ghost-btn" onClick={close}>Cancel</button>
          <button className="solid-btn" onClick={() => { close(); onYes(); }}>{confirm ?? "Confirm"}</button>
        </div>
      </div>
    </div>
  );
}

export function Menu({ x, y, items, close }) {
  const ref = useRef(null);
  const [pos, setPos] = useState({ left: x, top: y });
  useEsc(close);
  useEffect(() => {
    const r = ref.current.getBoundingClientRect();
    setPos({ left: Math.min(x, window.innerWidth - r.width - 6), top: Math.min(y, window.innerHeight - r.height - 6) });
  }, [x, y]);
  return (
    <div className="scrim clear" onPointerDown={close} onContextMenu={(e) => { e.preventDefault(); close(); }}>
      <div className="menu" ref={ref} style={pos} onPointerDown={(e) => e.stopPropagation()}>
        {items.map((it, i) => it === "-" ? <div key={i} className="menu-sep" /> : it.colors ? (
          <div key={i} className="menu-colors">{it.colors.map((c) => <button key={c.name} className={`swatch ${c.on ? "on" : ""}`} style={{ background: c.value }} onClick={() => { close(); c.pick(); }} />)}</div>
        ) : (
          <button key={i} className={`menu-item ${it.danger ? "danger" : ""}`} onClick={() => { close(); it.run(); }}>
            {it.icon && <Icon name={it.icon} size={14} />}<span>{it.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

export function spaceColors(theme, current, pick) {
  return SPACE_COLORS.map((c) => ({ name: c, value: theme.colors[c], on: c === current, pick: () => pick(c) }));
}

export function Settings({ close }) {
  const { state, dispatch, themes, theme, run } = useApp();
  useEsc(close);
  const look = state.look;
  const card = (t, slot) => {
    const on = look[slot] === t.name;
    return (
      <button key={slot + t.name} className={`theme-card ${on ? "on" : ""}`} onClick={() => dispatch({ type: "look", look: { [slot]: t.name, appearance: slot } })}>
        <div className="theme-preview" style={{ background: t.colors.chrome }}>
          <div style={{ background: t.colors.canvas, borderColor: t.colors.border }} className="tp-main">
            <span style={{ background: t.colors.accent }} /><span style={{ background: t.colors.ansi2 }} /><span style={{ background: t.colors.ansi5 }} /><span style={{ background: t.colors.ansi3 }} />
          </div>
        </div>
        <div className="theme-name">{t.name}{t.source === "herdr" ? <span className="dim"> · herdr</span> : null}</div>
      </button>
    );
  };
  const seg = (v, label) => (
    <button className={`seg ${look.appearance === v ? "on" : ""}`} onClick={() => dispatch({ type: "look", look: { appearance: v } })}>{label}</button>
  );
  return (
    <div className="scrim" onPointerDown={close}>
      <div className="dialog settings" onPointerDown={(e) => e.stopPropagation()}>
        <div className="settings-head"><span>Settings</span><span className="grow" /><button className="icon-btn" onClick={close}><Icon name="x" size={15} /></button></div>
        <div className="settings-body">
          <div className="set-label">Appearance</div>
          <div className="segs">{seg(null, "System")}{seg("dark", "Dark")}{seg("light", "Light")}</div>
          <div className="set-label">Dark theme</div>
          <div className="theme-grid">{themes.filter((t) => !t.light).map((t) => card(t, "dark"))}</div>
          <div className="set-label">Light theme</div>
          <div className="theme-grid">{themes.filter((t) => t.light).map((t) => card(t, "light"))}</div>
          <div className="set-label">Terminal colours</div>
          <div className="segs">
            <button className={`seg ${(look.termColors ?? "app") === "app" ? "on" : ""}`} onClick={() => dispatch({ type: "look", look: { termColors: "app" } })}>Match the app theme</button>
            <button className={`seg ${look.termColors === "kitty" ? "on" : ""}`} onClick={() => dispatch({ type: "look", look: { termColors: "kitty" } })}>Kitty's colours</button>
          </div>
          <div className="set-label">Terminal font</div>
          <div className="segs">
            <button className={`seg ${look.termFont !== "kitty" ? "on" : ""}`} onClick={() => dispatch({ type: "look", look: { termFont: "herdr" } })}>Herdr style (JetBrains Mono)</button>
            <button className={`seg ${look.termFont === "kitty" ? "on" : ""}`} onClick={() => dispatch({ type: "look", look: { termFont: "kitty" } })}>From kitty.conf</button>
            <button className="seg" onClick={() => dispatch({ type: "look", look: { termFontSize: Math.max(8, (look.termFontSize ?? 14) - 1) } })}>−</button>
            <span className="seg-val">{look.termFontSize ?? 14}</span>
            <button className="seg" onClick={() => dispatch({ type: "look", look: { termFontSize: Math.min(32, (look.termFontSize ?? 14) + 1) } })}>+</button>
          </div>
          <div className="set-label">Web apps</div>
          <div className="segs">
            <button className={`seg ${look.webUltra !== false ? "on" : ""}`} onClick={() => dispatch({ type: "look", look: { webUltra: true } })}>Ultra fit on (F11)</button>
            <button className={`seg ${look.webUltra === false ? "on" : ""}`} onClick={() => dispatch({ type: "look", look: { webUltra: false } })}>Off</button>
          </div>
          <div className="set-label">Zoom</div>
          <div className="segs">
            <button className="seg" onClick={() => run("app.zoom_out")}>−</button>
            <span className="seg-val">{Math.round((look.zoom ?? 1) * 100)}%</span>
            <button className="seg" onClick={() => run("app.zoom_in")}>+</button>
            <button className="seg" onClick={() => run("app.zoom_reset")}>Reset</button>
          </div>
          <div className="set-note">
            Themes use Herdr's format: drop a <code>.json</code> in <code>~/.config/scribblr/themes/</code> (your Herdr themes show up too).
            Keys live in <code>~/.config/scribblr/keys.json</code>. Now showing <b>{theme.name}</b>.
          </div>
        </div>
      </div>
    </div>
  );
}

export function Help({ close }) {
  const { keymap } = useApp();
  useEsc(close);
  const rows = Object.entries(keymap).filter(([k]) => !/^(alt|ctrl)-[2-9]$/.test(k));
  return (
    <div className="scrim" onPointerDown={close}>
      <div className="dialog settings" onPointerDown={(e) => e.stopPropagation()}>
        <div className="settings-head"><span>Keyboard shortcuts</span><span className="grow" /><button className="icon-btn" onClick={close}><Icon name="x" size={15} /></button></div>
        <div className="settings-body help-grid">
          {rows.map(([k, v]) => (
            <React.Fragment key={k}><span className="row-key">{prettyKey(k)}</span><span>{typeof v === "string" ? v : v.command}</span></React.Fragment>
          ))}
        </div>
      </div>
    </div>
  );
}

// Ctrl+Shift+L: link the focused drawing to another drawing (metadata, not a shape).
export function LinkPicker({ file, close }) {
  const { state, drawings, insertLink, graph } = useApp();
  const self = baseName(file).toLowerCase();
  const have = new Set((graph.outgoing.get(file) ?? []).map((o) => o.name.toLowerCase()));
  const seen = new Set();
  const items = state.spaces.flatMap((sp) => flatten(drawings[sp.folder] ?? []).map((d) => ({ id: d.path, icon: "pen", label: baseName(d.path), detail: sp.name })))
    .filter((it) => {
      const k = it.label.toLowerCase();
      if (k === self || have.has(k) || seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  const extra = (q) => {
    const name = q.trim();
    const k = name.toLowerCase();
    return name && !seen.has(k) && !have.has(k) && k !== self ? [{ id: "new:" + name, icon: "plus", label: name, detail: "new drawing (made when you open it)", name }] : [];
  };
  return <ListDialog placeholder={`Link "${baseName(file)}" to…`} items={items} extra={extra} close={close} onPick={(it) => insertLink(it.name ?? it.label, file)} />;
}

// The "+" menu: what to open. Click = a new tab in this space; the small
// split button = as a tile next to the focused pane instead.
export function NewMenu({ x, y, close }) {
  const { run, keymap } = useApp();
  useEsc(close);
  const keyOf = (cmd) => Object.entries(keymap).find(([, v]) => v === cmd)?.[0];
  const items = APPS.map((a) => ({ icon: a.icon, label: a.label, cmd: a.command }));
  const left = Math.min(x ?? 200, window.innerWidth - 270);
  return (
    <div className="scrim clear" onPointerDown={close}>
      <div className="menu new-menu" style={{ left, top: (y ?? 40) + 4 }} onPointerDown={(e) => e.stopPropagation()}>
        <div className="menu-label">New tab</div>
        {items.map((it) => (
          <div key={it.cmd} className="menu-item split-item" onClick={() => { close(); run(it.cmd); }}>
            <Icon name={it.icon} size={15} /><span>{it.label}</span><span className="grow" />
            {keyOf(it.key ?? it.cmd) && <span className="row-key">{prettyKey(keyOf(it.key ?? it.cmd))}</span>}
            <button className="menu-tab-btn" title="Open as a split next to the focused pane" onClick={(e) => { e.stopPropagation(); close(); run(it.cmd, { split: true }); }}><Icon name="split-right" size={12} /></button>
          </div>
        ))}
        <div className="menu-sep" />
        <div className="menu-item" onClick={() => { close(); run("app.picker"); }}><Icon name="search" size={15} /><span>Open…</span><span className="grow" /><span className="row-key">{prettyKey(keyOf("app.picker"))}</span></div>
      </div>
    </div>
  );
}
