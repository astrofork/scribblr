// Graph view: every drawing is a dot, every [[link]] a line, like Obsidian's
// graph. Links to drawings that don't exist yet are faint ghosts. Drag to pan,
// wheel to zoom, drag a dot to move it, click to open (Ctrl: to the right),
// hover to light up its neighbours.
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useApp } from "../ctx.js";

export default function GraphView() {
  const { graph, space, theme, openFile, openLink, dispatch, tab, state } = useApp();
  const [scope, setScope] = useState("space");
  const [ghosts, setGhosts] = useState(true);
  const canvasRef = useRef(null);
  const sim = useRef({ nodes: new Map(), cam: { x: 0, y: 0, k: 1 }, hover: null, drag: null, alpha: 1, dirty: true, key: null });
  const colors = theme.colors;

  // Which drawings are focused in other panes of this tab: drawn in accent.
  const current = useMemo(() => {
    const s = new Set();
    const walk = (n) => (n.type === "pane" ? n.file && s.add(n.file) : (walk(n.a), walk(n.b)));
    for (const sp of state.spaces) for (const t of sp.tabs) if (sp.id === state.activeSpace && t.id === tab?.id) walk(t.root);
    return s;
  }, [state, tab]);

  // Nodes and edges in scope; positions survive data refreshes.
  const data = useMemo(() => {
    const inScope = (p) => scope === "all" || graph.spaceOf(p)?.id === space?.id;
    const nodes = [...graph.nodes.values()].filter((n) => inScope(n.path)).map((n) => ({ id: n.path, label: n.name, ghost: false }));
    const ids = new Set(nodes.map((n) => n.id));
    const edges = [];
    for (const e of graph.edges) {
      if (!ids.has(e.from)) continue;
      if (e.to.startsWith("ghost:")) {
        if (!ghosts) continue;
        if (!ids.has(e.to)) { ids.add(e.to); nodes.push({ id: e.to, label: e.name, ghost: true }); }
      } else if (!ids.has(e.to)) continue;
      if (e.from !== e.to) edges.push([e.from, e.to]);
    }
    const degree = new Map();
    for (const [a, b] of edges) { degree.set(a, (degree.get(a) ?? 0) + 1); degree.set(b, (degree.get(b) ?? 0) + 1); }
    return { nodes, edges, degree };
  }, [graph, scope, ghosts, space]);

  // Latest data for the draw loop (one loop for the view's lifetime).
  const live = useRef({ data, colors, current });
  live.current = { data, colors, current };

  useEffect(() => {
    const S = sim.current;
    const key = data.nodes.map((n) => n.id).join("|") + "#" + data.edges.map((e) => e.join(">")).join("|");
    S.dirty = true;
    if (key === S.key) return; // same graph: keep positions, don't shake it
    S.key = key;
    const next = new Map();
    data.nodes.forEach((n, i) => {
      const old = S.nodes.get(n.id);
      const a = (i / Math.max(1, data.nodes.length)) * Math.PI * 2;
      next.set(n.id, old ? { ...old, ...n } : { ...n, x: Math.cos(a) * 120 + Math.random() * 10, y: Math.sin(a) * 120 + Math.random() * 10, vx: 0, vy: 0 });
    });
    S.nodes = next;
    S.alpha = Math.max(S.alpha, 0.5);
  }, [data]);
  useEffect(() => { sim.current.dirty = true; }, [colors, current]);

  useEffect(() => {
    const cv = canvasRef.current;
    const ctx2d = cv.getContext("2d");
    const S = sim.current;
    let raf, w = 0, h = 0;
    const ro = new ResizeObserver(() => {
      const r = cv.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) return;
      const dpr = window.devicePixelRatio || 1;
      if (Math.round(r.width * dpr) === cv.width && Math.round(r.height * dpr) === cv.height) return;
      w = r.width; h = r.height;
      cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
      ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);
      S.dirty = true;
    });
    ro.observe(cv);

    const step = () => {
      raf = requestAnimationFrame(step);
      // A hidden tab keeps its graph but doesn't draw it.
      if (document.hidden || cv.closest(".hidden-tab") || !w) { S.dirty = true; return; }
      const { data } = live.current;
      const ns = [...S.nodes.values()];
      const moving = S.alpha > 0.005;
      if (!moving && !S.dirty) return; // still: nothing to redraw
      S.dirty = false;
      if (moving) {
        for (let i = 0; i < ns.length; i++) {
          const a = ns[i];
          for (let j = i + 1; j < ns.length; j++) {
            const b = ns[j];
            let dx = a.x - b.x, dy = a.y - b.y, d2 = dx * dx + dy * dy || 0.01;
            if (d2 > 250000) continue;
            const f = (1400 / d2) * S.alpha;
            const d = Math.sqrt(d2);
            dx /= d; dy /= d;
            a.vx += dx * f; a.vy += dy * f; b.vx -= dx * f; b.vy -= dy * f;
          }
          a.vx -= a.x * 0.004 * S.alpha; a.vy -= a.y * 0.004 * S.alpha;
        }
        for (const [p, q] of data.edges) {
          const a = S.nodes.get(p), b = S.nodes.get(q);
          if (!a || !b) continue;
          const dx = b.x - a.x, dy = b.y - a.y, d = Math.sqrt(dx * dx + dy * dy) || 1;
          const f = ((d - 90) / d) * 0.06 * S.alpha;
          a.vx += dx * f; a.vy += dy * f; b.vx -= dx * f; b.vy -= dy * f;
        }
        for (const n of ns) {
          if (S.drag?.node === n) { n.vx = n.vy = 0; continue; }
          n.vx *= 0.82; n.vy *= 0.82; n.x += n.vx; n.y += n.vy;
        }
        S.alpha *= 0.985;
      }
      draw(ns);
    };

    const draw = (ns) => {
      const { data, colors, current } = live.current;
      const { x: cx, y: cy, k } = S.cam;
      ctx2d.clearRect(0, 0, w, h);
      ctx2d.fillStyle = colors.background;
      ctx2d.fillRect(0, 0, w, h);
      const toS = (n) => [w / 2 + (n.x + cx) * k, h / 2 + (n.y + cy) * k];
      const hov = S.hover;
      const near = new Set();
      if (hov) { near.add(hov.id); for (const [a, b] of data.edges) { if (a === hov.id) near.add(b); if (b === hov.id) near.add(a); } }
      ctx2d.lineWidth = 1;
      for (const [p, q] of data.edges) {
        const a = S.nodes.get(p), b = S.nodes.get(q);
        if (!a || !b) continue;
        const lit = hov && (p === hov.id || q === hov.id);
        ctx2d.strokeStyle = lit ? colors.accent : colors.input;
        ctx2d.globalAlpha = hov && !lit ? 0.25 : 1;
        const [x1, y1] = toS(a), [x2, y2] = toS(b);
        ctx2d.beginPath(); ctx2d.moveTo(x1, y1); ctx2d.lineTo(x2, y2); ctx2d.stroke();
      }
      ctx2d.font = `${Math.max(10, 11.5 * Math.min(1.3, k))}px Geist, system-ui, sans-serif`;
      ctx2d.textAlign = "center";
      for (const n of ns) {
        const [x, y] = toS(n);
        const r = (4 + Math.sqrt(data.degree.get(n.id) ?? 0) * 1.6) * Math.max(0.6, Math.min(1.6, k));
        const dimmed = hov && !near.has(n.id);
        ctx2d.globalAlpha = dimmed ? 0.2 : 1;
        const kindColor = /\.note$/.test(n.id) ? colors.ansi4 : /\.calendar$/.test(n.id) ? colors.ansi3 : colors.muted;
        ctx2d.fillStyle = n.ghost ? colors.dim : current.has(n.id) || hov?.id === n.id ? colors.accent : kindColor;
        ctx2d.beginPath(); ctx2d.arc(x, y, r, 0, Math.PI * 2);
        if (n.ghost) { ctx2d.strokeStyle = colors.dim; ctx2d.stroke(); } else ctx2d.fill();
        if (k > 0.55 || near.has(n.id)) {
          ctx2d.fillStyle = hov?.id === n.id ? colors.foreground : n.ghost ? colors.dim : colors.muted;
          ctx2d.fillText(n.label, x, y + r + 13);
        }
      }
      ctx2d.globalAlpha = 1;
      if (!ns.length) {
        ctx2d.fillStyle = colors.dim;
        ctx2d.fillText("No drawings yet", w / 2, h / 2);
      }
    };
    raf = requestAnimationFrame(step);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, []);

  // --- pointer ---
  const world = (e) => {
    const r = canvasRef.current.getBoundingClientRect();
    const { x, y, k } = sim.current.cam;
    return [(e.clientX - r.left - r.width / 2) / k - x, (e.clientY - r.top - r.height / 2) / k - y];
  };
  const hit = (e) => {
    const [wx, wy] = world(e);
    const k = sim.current.cam.k;
    let best = null, bd = (12 / k) ** 2;
    for (const n of sim.current.nodes.values()) {
      const d = (n.x - wx) ** 2 + (n.y - wy) ** 2;
      if (d < bd) { bd = d; best = n; }
    }
    return best;
  };
  const onDown = (e) => {
    const S = sim.current;
    const n = hit(e);
    S.drag = { node: n, sx: e.clientX, sy: e.clientY, cam: { ...S.cam }, moved: false };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onMove = (e) => {
    const S = sim.current;
    if (S.drag) {
      const dx = e.clientX - S.drag.sx, dy = e.clientY - S.drag.sy;
      if (Math.abs(dx) + Math.abs(dy) > 3) S.drag.moved = true;
      if (S.drag.node) { const [wx, wy] = world(e); S.drag.node.x = wx; S.drag.node.y = wy; S.alpha = Math.max(S.alpha, 0.3); }
      else { S.cam.x = S.drag.cam.x + dx / S.cam.k; S.cam.y = S.drag.cam.y + dy / S.cam.k; S.dirty = true; }
    } else {
      const n = hit(e);
      if (n !== S.hover) { S.hover = n; S.dirty = true; canvasRef.current.style.cursor = n ? "pointer" : "default"; }
    }
  };
  const onUp = (e) => {
    const S = sim.current;
    const d = S.drag;
    S.drag = null;
    if (d && !d.moved && d.node) {
      const split = e.ctrlKey || e.metaKey;
      if (d.node.ghost) openLink(d.node.label, null, split);
      else if (split) dispatch({ type: "pane.split", dir: "right", file: d.node.id });
      else openFile(d.node.id);
    }
  };
  const onWheel = (e) => {
    const S = sim.current;
    const [wx, wy] = world(e);
    const k = Math.max(0.15, Math.min(4, S.cam.k * Math.exp(-e.deltaY * 0.0015)));
    const r = canvasRef.current.getBoundingClientRect();
    S.cam.k = k;
    S.cam.x = (e.clientX - r.left - r.width / 2) / k - wx;
    S.cam.y = (e.clientY - r.top - r.height / 2) / k - wy;
    S.dirty = true;
  };

  const seg = (on, label, fn) => <button className={`seg small ${on ? "on" : ""}`} onClick={fn}>{label}</button>;
  return (
    <div className="graph-view">
      <canvas ref={canvasRef} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerLeave={() => { sim.current.hover = null; sim.current.dirty = true; }} onWheel={onWheel} />
      <div className="graph-controls">
        {seg(scope === "space", "This space", () => setScope("space"))}
        {seg(scope === "all", "All spaces", () => setScope("all"))}
        {seg(ghosts, "Unmade links", () => setGhosts((g) => !g))}
        <button className="seg small" onClick={() => { sim.current.cam = { x: 0, y: 0, k: 1 }; sim.current.alpha = 0.8; sim.current.dirty = true; }}>Re-center</button>
      </div>
      <div className="graph-count">{data.nodes.filter((n) => !n.ghost).length} items · {data.edges.length} links</div>
    </div>
  );
}
