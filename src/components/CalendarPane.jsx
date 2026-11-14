// Calendar, the Notion way. Two views of the same items:
//  - Calendar: a month grid (Sunday first, like Notion), every item a card
//    with a checkbox; today in a red circle; weekends shaded.
//  - Timeline: days run left to right, items are bars you drag to move or
//    stretch; a red line marks today.
// Every item is a page: click a card and it opens in a side peek with its
// properties (date, done, calendar) and a full Notion-style note. Click a
// day's number for that day's note. Pages and day notes live in the space's
// hidden `.scribblr/` folder, so they never clutter your files.
// Several calendars per space (each a .calendar file with a colour).
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useApp } from "../ctx.js";
import { api, baseName, flatten, kindOf } from "../api.js";
import { Icon } from "../icons.jsx";
import { SPACE_COLORS, uid } from "../store.js";
import NotePane from "./NotePane.jsx";

const pad = (n) => String(n).padStart(2, "0");
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parse = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const diffDays = (a, b) => Math.round((parse(b) - parse(a)) / 86400000);
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const creating = new Set();

const PAGE_DOC = JSON.stringify({ type: "scribblr-note", version: 1, blocks: [], scribblr: { links: [], tags: [] } });
async function ensureNote(path) {
  if (!(await api.exists(path))) await api.writeText(path, PAGE_DOC);
  return path;
}

function useCalendars(space, drawings, refresh) {
  const files = useMemo(() => flatten(drawings[space?.folder] ?? []).filter((d) => kindOf(d.path) === "calendar").map((d) => d.path), [drawings, space]);
  const [cals, setCals] = useState({});
  const dirty = useRef(new Set());
  const timers = useRef({});
  const load = useCallback(async () => {
    const next = {};
    for (const f of files) {
      if (dirty.current.has(f)) continue;
      try { next[f] = JSON.parse(await api.readText(f)); } catch { /* skip */ }
    }
    setCals((c) => {
      const out = {};
      for (const f of files) out[f] = dirty.current.has(f) ? c[f] : next[f] ?? c[f];
      return JSON.stringify(out) === JSON.stringify(c) ? c : out;
    });
  }, [files]);
  useEffect(() => { load(); const t = setInterval(load, 3000); return () => clearInterval(t); }, [load]);
  // A space always has a calendar (made once even if several panes open).
  useEffect(() => {
    if (space && drawings[space.folder] && !files.length && !creating.has(space.folder)) {
      creating.add(space.folder);
      api.createItem(space.folder, "Calendar", ".calendar").then(() => refresh()).finally(() => setTimeout(() => creating.delete(space.folder), 4000));
    }
  }, [files.length, space, drawings]); // eslint-disable-line react-hooks/exhaustive-deps
  const update = (path, fn) => setCals((c) => {
    const doc = fn(structuredClone(c[path]));
    dirty.current.add(path);
    clearTimeout(timers.current[path]);
    timers.current[path] = setTimeout(async () => { await api.writeText(path, JSON.stringify(doc)); dirty.current.delete(path); }, 250);
    return { ...c, [path]: doc };
  });
  return { files, cals, update };
}

export default function CalendarPane({ file }) {
  const { space, drawings, theme, refresh } = useApp();
  const { files, cals, update } = useCalendars(space, drawings, refresh);
  const [view, setView] = useState(() => localStorage.getItem("cal.view") ?? "calendar");
  const [cursor, setCursor] = useState(() => new Date());
  const [hidden, setHidden] = useState(() => new Set());
  const [peek, setPeek] = useState(null); // { item: {path,id} } | { day: "YYYY-MM-DD" }
  const [selDay, setSelDay] = useState(() => iso(new Date()));
  const [menu, setMenu] = useState(false);
  const [query, setQuery] = useState(null);
  const [scale, setScale] = useState("month");
  const tlRef = useRef(null);
  const today = iso(new Date());
  useEffect(() => { try { localStorage.setItem("cal.view", view); } catch { /* ok */ } }, [view]);

  const colorOf = (path) => { const c = cals[path]?.color ?? "ansi4"; return c.startsWith("#") ? c : theme.colors[c] ?? theme.colors.accent; };
  const target = file && files.includes(file) ? file : files.find((f) => !hidden.has(f)) ?? files[0];
  const items = useMemo(() => files.filter((f) => !hidden.has(f) && cals[f]).flatMap((f) => (cals[f].items ?? []).map((it) => ({ ...it, path: f })))
    .filter((it) => !query || (it.title ?? "").toLowerCase().includes(query.toLowerCase())), [files, hidden, cals, query]);
  const byDay = useMemo(() => {
    const m = {};
    for (const it of items) (m[it.date] ??= []).push(it);
    for (const k in m) m[k].sort((a, b) => (a.done - b.done) || (a.time ?? "99").localeCompare(b.time ?? "99") || (a.title ?? "").localeCompare(b.title ?? ""));
    return m;
  }, [items]);

  const pagesDir = space ? `${space.folder}/.scribblr` : null;
  const addItem = (date, title = "") => {
    if (!target) return null;
    const it = { id: uid("i"), date, end: null, title, done: false, time: null };
    update(target, (d) => ({ ...d, items: [...(d.items ?? []), it] }));
    return { path: target, id: it.id };
  };
  const edit = (path, id, patch) => update(path, (d) => ({ ...d, items: d.items.map((x) => (x.id === id ? { ...x, ...patch } : x)) }));
  const dropItem = (path, id) => { update(path, (d) => ({ ...d, items: d.items.filter((x) => x.id !== id) })); setPeek(null); };
  const moveCal = (from, id, to) => {
    if (from === to) return;
    const it = cals[from]?.items.find((x) => x.id === id);
    if (!it) return;
    update(from, (d) => ({ ...d, items: d.items.filter((x) => x.id !== id) }));
    update(to, (d) => ({ ...d, items: [...(d.items ?? []), it] }));
    setPeek({ item: { path: to, id } });
  };
  const newCalendar = async () => {
    const p = await api.createItem(space.folder, `Calendar ${files.length + 1}`, ".calendar");
    const used = Object.values(cals).map((c) => c.color);
    await api.writeText(p, JSON.stringify({ type: "scribblr-calendar", version: 1, color: SPACE_COLORS.find((c) => !used.includes(c)) ?? "ansi5", items: [], scribblr: { links: [] } }));
    refresh();
  };
  const openNew = (date) => { const r = addItem(date); if (r) setPeek({ item: r }); };

  // --- shared pieces ---
  const card = (it) => (
    <div key={it.id} className={`nc-card ${it.done ? "done" : ""}`} style={{ "--cal": colorOf(it.path) }} draggable
      onDragStart={(e) => { e.dataTransfer.setData("text/scribblr-item", JSON.stringify({ path: it.path, id: it.id })); e.dataTransfer.effectAllowed = "move"; }}
      onClick={(e) => { e.stopPropagation(); setPeek({ item: { path: it.path, id: it.id } }); }}>
      <input type="checkbox" checked={!!it.done} onClick={(e) => e.stopPropagation()} onChange={() => edit(it.path, it.id, { done: !it.done })} />
      <span className="nc-card-title">{it.time && <span className="nc-time">{it.time}</span>}{it.title || <span className="dim">Untitled</span>}</span>
      {it.end && it.end !== it.date && <span className="nc-span">→ {parse(it.end).getDate()}</span>}
    </div>
  );
  // Notion's list view: a page icon and title per row, a checkbox, and the
  // calendar and time quietly on the right.
  const pageRow = (it) => (
    <div key={it.id} className={`nl-row ${it.done ? "done" : ""}`} draggable
      onDragStart={(e) => { e.dataTransfer.setData("text/scribblr-item", JSON.stringify({ path: it.path, id: it.id })); e.dataTransfer.effectAllowed = "move"; }}
      onClick={() => setPeek({ item: { path: it.path, id: it.id } })}>
      <input type="checkbox" checked={!!it.done} onClick={(e) => e.stopPropagation()} onChange={() => edit(it.path, it.id, { done: !it.done })} />
      <Icon name="file-text" size={15} className="nl-icon" />
      <span className="nl-title">{it.title || "Untitled"}</span>
      <span className="grow" />
      {it.time && <span className="nl-meta">{it.time}</span>}
      {it.end && it.end !== it.date && <span className="nl-meta">→ {parse(it.end).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span>}
      <span className="nl-chip" style={{ "--cal": colorOf(it.path) }}>{baseName(it.path)}</span>
    </div>
  );
  const dropDay = (date) => ({
    onDragOver: (e) => { if (e.dataTransfer.types.includes("text/scribblr-item")) { e.preventDefault(); e.currentTarget.classList.add("drop"); } },
    onDragLeave: (e) => e.currentTarget.classList.remove("drop"),
    onDrop: (e) => {
      e.preventDefault(); e.currentTarget.classList.remove("drop");
      try {
        const d = JSON.parse(e.dataTransfer.getData("text/scribblr-item"));
        const it = cals[d.path]?.items.find((x) => x.id === d.id);
        if (!it) return;
        const len = it.end ? diffDays(it.date, it.end) : 0;
        edit(d.path, d.id, { date, end: len ? iso(addDays(parse(date), len)) : null });
      } catch { /* not ours */ }
    },
  });

  // --- calendar view: a small month on the left, the chosen day on the right ---
  const pickDay = (key) => { setSelDay(key); setPeek(null); };
  const mini = () => {
    const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    const start = addDays(first, -first.getDay());
    const days = Array.from({ length: 42 }, (_, i) => addDays(start, i));
    return (
      <div className="nc-mini">
        <div className="nc-mini-head">
          <div className="nc-title">{cursor.toLocaleDateString(undefined, { month: "long", year: "numeric" })}</div>
          <span className="grow" />
          <button className="icon-btn" onClick={() => step(-1)}><Icon name="chevron-left" size={14} /></button>
          <button className="nc-today" onClick={() => { setCursor(new Date()); pickDay(today); }}>Today</button>
          <button className="icon-btn" onClick={() => step(1)}><Icon name="chevron-right" size={14} /></button>
        </div>
        <div className="nc-mini-grid">
          {WEEKDAYS.map((w) => <div key={w} className="nc-mini-wd">{w[0]}</div>)}
          {days.map((d) => {
            const key = iso(d);
            const list = byDay[key] ?? [];
            const open = list.filter((x) => !x.done);
            return (
              <button key={key} {...dropDay(key)}
                className={`nc-mini-day ${d.getMonth() === cursor.getMonth() ? "" : "out"} ${key === today ? "today" : ""} ${key === selDay ? "sel" : ""}`}
                onClick={() => pickDay(key)} onDoubleClick={() => openNew(key)} title={list.length ? `${list.length} page${list.length > 1 ? "s" : ""}` : ""}>
                <span className="nc-mini-num">{d.getDate()}</span>
                <span className="nc-dots">{[...new Set(list.map((x) => x.path))].slice(0, 3).map((p) => <i key={p} style={{ background: open.some((x) => x.path === p) ? colorOf(p) : "var(--dim)" }} />)}</span>
              </button>
            );
          })}
        </div>
        <div className="nc-upcoming">
          <div className="pop-label">Coming up</div>
          {items.filter((x) => !x.done && x.date >= today).sort((a, b) => a.date.localeCompare(b.date)).slice(0, 8).map((it) => (
            <button key={it.id} className="nc-up-row" style={{ "--cal": colorOf(it.path) }} onClick={() => { setSelDay(it.date); setCursor(parse(it.date)); setPeek({ item: { path: it.path, id: it.id } }); }}>
              <i /><span className="truncate">{it.title || "Untitled"}</span><span className="grow" />
              <span className="dim">{it.date === today ? "Today" : parse(it.date).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span>
            </button>
          ))}
          {!items.some((x) => !x.done && x.date >= today) && <div className="section-empty">Nothing planned. Double-click a day to add a page.</div>}
        </div>
      </div>
    );
  };

  // --- timeline (Notion "Timeline view") ---
  const DAYW = { week: 120, month: 44, quarter: 16 }[scale];
  const tlStart = useMemo(() => addDays(new Date(cursor.getFullYear(), cursor.getMonth(), 1), -45), [cursor]);
  const TL_DAYS = 200;
  useEffect(() => {
    if (view !== "timeline" || !tlRef.current) return;
    const x = diffDays(iso(tlStart), iso(cursor)) * DAYW - tlRef.current.clientWidth / 3;
    tlRef.current.scrollLeft = Math.max(0, x);
  }, [view, tlStart, DAYW]); // eslint-disable-line react-hooks/exhaustive-deps
  const timeline = () => {
    const days = Array.from({ length: TL_DAYS }, (_, i) => addDays(tlStart, i));
    const rows = items.slice().sort((a, b) => a.date.localeCompare(b.date));
    const todayX = diffDays(iso(tlStart), today) * DAYW;
    const dragBar = (e, it, mode) => {
      e.preventDefault(); e.stopPropagation();
      const x0 = e.clientX;
      const orig = { date: it.date, end: it.end ?? it.date };
      let moved = false;
      const move = (ev) => {
        const dd = Math.round((ev.clientX - x0) / DAYW);
        if (dd) moved = true;
        if (mode === "move") edit(it.path, it.id, { date: iso(addDays(parse(orig.date), dd)), end: orig.end !== orig.date ? iso(addDays(parse(orig.end), dd)) : null });
        else {
          const end = addDays(parse(orig.end), dd);
          edit(it.path, it.id, { end: end <= parse(orig.date) ? null : iso(end) });
        }
      };
      const upFn = () => {
        window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", upFn);
        if (!moved && mode === "move") setPeek({ item: { path: it.path, id: it.id } });
      };
      window.addEventListener("pointermove", move); window.addEventListener("pointerup", upFn);
    };
    return (
      <div className="nc-timeline" ref={tlRef}>
        <div className="nc-tl-inner" style={{ width: TL_DAYS * DAYW }}>
          <div className="nc-tl-head">
            {days.map((d, i) => (
              <div key={i} className={`nc-tl-day ${iso(d) === today ? "today" : ""}`} style={{ left: i * DAYW, width: DAYW }}>
                {d.getDate() === 1 && <span className="nc-tl-month">{d.toLocaleDateString(undefined, { month: "short" })}</span>}
                {(DAYW >= 30 || d.getDay() === 1) && <span className="nc-tl-num">{d.getDate()}</span>}
              </div>
            ))}
          </div>
          <div className="nc-tl-body" style={{ minHeight: (rows.length + 2) * 36 }}>
            {days.map((d, i) => (d.getDay() === 0 || d.getDay() === 6) && <div key={i} className="nc-tl-weekend" style={{ left: i * DAYW, width: DAYW }} />)}
            <div className="nc-tl-today" style={{ left: todayX + DAYW / 2 }} />
            <button className="nc-tl-new" style={{ left: todayX + 8 }} onClick={() => openNew(today)}>
              <Icon name="plus" size={13} /> New
            </button>
            {rows.map((it, r) => {
              const x = diffDays(iso(tlStart), it.date) * DAYW;
              const w = ((it.end ? diffDays(it.date, it.end) : 0) + 1) * DAYW;
              return (
                <div key={it.id} className={`nc-bar ${it.done ? "done" : ""}`} style={{ left: x + 2, width: Math.max(DAYW - 4, w - 4), top: 40 + r * 36, "--cal": colorOf(it.path) }}
                  onPointerDown={(e) => dragBar(e, it, "move")}>
                  <input type="checkbox" checked={!!it.done} onPointerDown={(e) => e.stopPropagation()} onChange={() => edit(it.path, it.id, { done: !it.done })} />
                  <span className="truncate">{it.title || "Untitled"}</span>
                  <span className="nc-bar-grip" onPointerDown={(e) => dragBar(e, it, "end")} />
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  };

  // --- side peek: an item's page, or a day's note ---
  const pk = peek ?? (view === "calendar" ? { day: selDay } : null);
  const peekItem = pk?.item && cals[pk.item.path]?.items.find((x) => x.id === pk.item.id);
  const peekFile = pagesDir && (peekItem ? `${pagesDir}/pages/${peekItem.id}.note` : pk?.day ? `${pagesDir}/days/${pk.day}.note` : null);
  const [peekReady, setPeekReady] = useState(null);
  useEffect(() => { setPeekReady(null); if (peekFile) ensureNote(peekFile).then(() => setPeekReady(peekFile)); }, [peekFile]);

  const step = (n) => setCursor((c) => new Date(c.getFullYear(), c.getMonth() + n, 1));
  const title = cursor.toLocaleDateString(undefined, { month: "long", year: "numeric" });

  return (
    <div className="ncal">
      <div className="nc-top">
        <div className="nc-views">
          <button className={`nc-view ${view === "calendar" ? "on" : ""}`} onClick={() => setView("calendar")}><Icon name="calendar" size={14} /> Calendar view</button>
          <button className={`nc-view ${view === "timeline" ? "on" : ""}`} onClick={() => setView("timeline")}><Icon name="layers" size={14} /> Timeline</button>
        </div>
        <span className="grow" />
        {query !== null && <input className="nc-search" autoFocus placeholder="Search pages" value={query} onChange={(e) => setQuery(e.target.value)} onBlur={() => !query && setQuery(null)} />}
        <button className="icon-btn" title="Search" onClick={() => setQuery((q) => (q === null ? "" : null))}><Icon name="search" size={15} /></button>
        <div className="nc-menu-wrap">
          <button className={`icon-btn ${menu ? "on" : ""}`} title="Calendars" onClick={() => setMenu((m) => !m)}><Icon name="palette" size={15} /></button>
          {menu && (
            <div className="popover nc-menu" onPointerDown={(e) => e.stopPropagation()}>
              <div className="pop-label">Calendars in this space</div>
              {files.map((f) => (
                <div key={f} className="nc-cal-row">
                  <button className="cal-dot" style={{ background: hidden.has(f) ? "transparent" : colorOf(f), borderColor: colorOf(f) }}
                    onClick={() => setHidden((h) => { const n = new Set(h); n.has(f) ? n.delete(f) : n.add(f); return n; })} title="Show / hide" />
                  <span className="truncate">{baseName(f)}</span>
                  <span className="grow" />
                  {SPACE_COLORS.map((c) => <button key={c} className={`mini-swatch ${cals[f]?.color === c ? "on" : ""}`} style={{ background: theme.colors[c] }} onClick={() => update(f, (d) => ({ ...d, color: c }))} />)}
                </div>
              ))}
              <button className="nc-cal-row add" onClick={newCalendar}><Icon name="plus" size={12} /> New calendar</button>
              <div className="pop-label">New pages go to <b>{target ? baseName(target) : "—"}</b></div>
            </div>
          )}
        </div>
        <div className="nc-new">
          <button className="nc-new-main" onClick={() => openNew(view === "calendar" ? selDay : today)}>New</button>
          <button className="nc-new-more" title="Today's note" onClick={() => { setSelDay(today); setCursor(new Date()); setPeek(view === "calendar" ? null : { day: today }); }}><Icon name="chevron-down" size={13} /></button>
        </div>
      </div>
      {view === "timeline" && <div className="nc-nav">
        <div className="nc-title">{title}</div>
        <span className="grow" />
        {view === "timeline" && (
          <select className="nc-scale" value={scale} onChange={(e) => setScale(e.target.value)}>
            <option value="week">Week</option><option value="month">Month</option><option value="quarter">Quarter</option>
          </select>
        )}
        <button className="icon-btn" onClick={() => step(-1)}><Icon name="chevron-left" size={15} /></button>
        <button className="nc-today" onClick={() => setCursor(new Date())}>Today</button>
        <button className="icon-btn" onClick={() => step(1)}><Icon name="chevron-right" size={15} /></button>
      </div>}
      <div className="nc-main" onClick={() => setMenu(false)}>
        {view === "calendar" ? (
          <div className="nc-split">
            {mini()}
            <div className="nc-detail">
              <div className="nc-peek-bar">
                {peekItem
                  ? <button className="icon-btn" title="Back to the day" onClick={() => setPeek(null)}><Icon name="chevron-left" size={15} /></button>
                  : <Icon name="calendar" size={14} className="dim" />}
                <span className="dim">{peekItem ? `${baseName(pk.item.path)} · ${parse(peekItem.date).toLocaleDateString(undefined, { month: "short", day: "numeric" })}` : "Day"}</span>
                <span className="grow" />
                {peekItem && <button className="icon-btn" title="Delete page" onClick={() => dropItem(pk.item.path, peekItem.id)}><Icon name="trash" size={14} /></button>}
              </div>
              {pk && peekReady === peekFile && (peekItem || pk.day) && (
                <div className="nc-peek-body">
              {peekItem ? (
                <NotePane key={peekFile} file={peekFile} compact title={peekItem.title} onTitle={(t) => edit(pk.item.path, peekItem.id, { title: t })}>
                  <div className="nc-props">
                    <div className="nc-prop"><span><Icon name="calendar" size={13} /> Date</span>
                      <div className="nc-prop-val">
                        <input type="date" value={peekItem.date} onChange={(e) => e.target.value && edit(pk.item.path, peekItem.id, { date: e.target.value, end: peekItem.end && peekItem.end < e.target.value ? null : peekItem.end })} />
                        <span className="dim">→</span>
                        <input type="date" value={peekItem.end ?? ""} min={peekItem.date} onChange={(e) => edit(pk.item.path, peekItem.id, { end: e.target.value || null })} />
                        <input type="time" value={peekItem.time ?? ""} onChange={(e) => edit(pk.item.path, peekItem.id, { time: e.target.value || null })} />
                      </div>
                    </div>
                    <div className="nc-prop"><span><Icon name="check" size={13} /> Done</span>
                      <div className="nc-prop-val"><input type="checkbox" checked={!!peekItem.done} onChange={() => edit(pk.item.path, peekItem.id, { done: !peekItem.done })} /></div>
                    </div>
                    <div className="nc-prop"><span><Icon name="layers" size={13} /> Calendar</span>
                      <div className="nc-prop-val">
                        <select value={pk.item.path} onChange={(e) => moveCal(pk.item.path, peekItem.id, e.target.value)}>
                          {files.map((f) => <option key={f} value={f}>{baseName(f)}</option>)}
                        </select>
                      </div>
                    </div>
                  </div>
                </NotePane>
              ) : (
                <NotePane key={peekFile} file={peekFile} compact title={parse(pk.day).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" })}>
                  <div className="nc-props">
                    <div className="nl-head"><Icon name="file-text" size={13} /> Pages <span className="dim">{(byDay[pk.day] ?? []).length || ""}</span></div>
                    <div className="nl-list">
                      {(byDay[pk.day] ?? []).map((it) => pageRow(it))}
                      <button className="nl-row nl-new" onClick={() => openNew(pk.day)}><Icon name="plus" size={14} /><span>New page</span></button>
                    </div>
                  </div>
                </NotePane>
              )}
            </div>
              )}
            </div>
          </div>
        ) : timeline()}
        {view !== "calendar" && pk && peekReady === peekFile && (peekItem || pk.day) && (
          <div className="nc-peek" onClick={(e) => e.stopPropagation()}>
            <div className="nc-peek-bar">
              <button className="icon-btn" title="Close" onClick={() => setPeek(null)}><Icon name="chevron-right" size={15} /></button>
              <span className="dim">{peekItem ? baseName(pk.item.path) : "Day note"}</span>
              <span className="grow" />
              {peekItem && <button className="icon-btn" title="Delete page" onClick={() => dropItem(pk.item.path, peekItem.id)}><Icon name="trash" size={14} /></button>}
            </div>
            <div className="nc-peek-body">
              {peekItem ? (
                <NotePane key={peekFile} file={peekFile} compact title={peekItem.title} onTitle={(t) => edit(pk.item.path, peekItem.id, { title: t })}>
                  <div className="nc-props">
                    <div className="nc-prop"><span><Icon name="calendar" size={13} /> Date</span>
                      <div className="nc-prop-val">
                        <input type="date" value={peekItem.date} onChange={(e) => e.target.value && edit(pk.item.path, peekItem.id, { date: e.target.value, end: peekItem.end && peekItem.end < e.target.value ? null : peekItem.end })} />
                        <span className="dim">→</span>
                        <input type="date" value={peekItem.end ?? ""} min={peekItem.date} onChange={(e) => edit(pk.item.path, peekItem.id, { end: e.target.value || null })} />
                        <input type="time" value={peekItem.time ?? ""} onChange={(e) => edit(pk.item.path, peekItem.id, { time: e.target.value || null })} />
                      </div>
                    </div>
                    <div className="nc-prop"><span><Icon name="check" size={13} /> Done</span>
                      <div className="nc-prop-val"><input type="checkbox" checked={!!peekItem.done} onChange={() => edit(pk.item.path, peekItem.id, { done: !peekItem.done })} /></div>
                    </div>
                    <div className="nc-prop"><span><Icon name="layers" size={13} /> Calendar</span>
                      <div className="nc-prop-val">
                        <select value={pk.item.path} onChange={(e) => moveCal(pk.item.path, peekItem.id, e.target.value)}>
                          {files.map((f) => <option key={f} value={f}>{baseName(f)}</option>)}
                        </select>
                      </div>
                    </div>
                  </div>
                </NotePane>
              ) : (
                <NotePane key={peekFile} file={peekFile} compact title={parse(pk.day).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" })}>
                  <div className="nc-props">
                    <div className="nl-head"><Icon name="file-text" size={13} /> Pages <span className="dim">{(byDay[pk.day] ?? []).length || ""}</span></div>
                    <div className="nl-list">
                      {(byDay[pk.day] ?? []).map((it) => pageRow(it))}
                      <button className="nl-row nl-new" onClick={() => openNew(pk.day)}><Icon name="plus" size={14} /><span>New page</span></button>
                    </div>
                  </div>
                </NotePane>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
