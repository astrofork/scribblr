// Kitty's cursor trail for xterm.js: when the cursor jumps, a soft shape
// stretches from where it was to where it is and shrinks into it. The
// leading corners arrive fast, the trailing ones slow (cursor_trail_decay).
export function attachCursorTrail(s) {
  const { term, el, look } = s;
  if (!look.trail) return () => {};
  const cv = document.createElement("canvas");
  cv.className = "cursor-trail";
  el.appendChild(cv);
  const g = cv.getContext("2d");
  let corners = null; // 4 points, current
  let target = null;  // 4 points
  let raf = 0, last = 0;
  const [fast, slow] = [Math.max(0.02, look.trailDecay[0] ?? 0.1), Math.max(0.05, look.trailDecay[1] ?? 0.4)];

  const cell = () => {
    const screen = el.querySelector(".xterm-screen");
    if (!screen || !term.cols) return null;
    const r = screen.getBoundingClientRect(), host = el.getBoundingClientRect();
    return { w: r.width / term.cols, h: r.height / term.rows, ox: r.left - host.left, oy: r.top - host.top };
  };
  const rectFor = (c) => {
    const b = term.buffer.active;
    const x = c.ox + b.cursorX * c.w, y = c.oy + (b.cursorY) * c.h;
    const w = look.cursorStyle === "bar" ? Math.max(2, c.w * 0.12) : c.w;
    return [[x, y], [x + w, y], [x + w, y + c.h], [x, y + c.h]];
  };
  const size = () => {
    const r = el.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
    cv.width = Math.round(r.width * dpr); cv.height = Math.round(r.height * dpr);
    cv.style.width = r.width + "px"; cv.style.height = r.height + "px";
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
  };

  const frame = (now) => {
    const dt = Math.min(0.05, (now - last) / 1000 || 0.016);
    last = now;
    g.clearRect(0, 0, cv.width, cv.height);
    if (!corners || !target) { raf = 0; return; }
    // Corners nearest the direction of travel are "leading".
    const cx = (target[0][0] + target[2][0]) / 2, cy = (target[0][1] + target[2][1]) / 2;
    const ox = (corners[0][0] + corners[2][0]) / 2, oy = (corners[0][1] + corners[2][1]) / 2;
    const dx = cx - ox, dy = cy - oy;
    let moving = false;
    corners = corners.map((p, i) => {
      const t = target[i];
      const lead = (t[0] - cx) * dx + (t[1] - cy) * dy >= 0;
      const k = 1 - Math.exp(-dt / ((lead ? fast : slow) / 3));
      const nx = p[0] + (t[0] - p[0]) * k, ny = p[1] + (t[1] - p[1]) * k;
      if (Math.abs(nx - t[0]) + Math.abs(ny - t[1]) > 0.5) moving = true;
      return [nx, ny];
    });
    if (!moving) { corners = target; g.clearRect(0, 0, cv.width, cv.height); raf = 0; return; }
    g.fillStyle = look.theme.cursor;
    g.globalAlpha = 0.55;
    g.beginPath();
    corners.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
    g.closePath();
    g.fill();
    raf = requestAnimationFrame(frame);
  };

  const onMove = () => {
    const c = cell();
    if (!c) return;
    const next = rectFor(c);
    if (target && corners) {
      const jump = Math.abs(next[0][0] - target[0][0]) / c.w + Math.abs(next[0][1] - target[0][1]) / c.h;
      if (jump >= look.trailThreshold) {
        if (cv.width !== Math.round(el.getBoundingClientRect().width * (window.devicePixelRatio || 1))) size();
        corners = target.map((p) => [...p]);
        target = next;
        if (!raf) { last = performance.now(); raf = requestAnimationFrame(frame); }
        return;
      }
    }
    target = next;
    corners = next;
  };
  size();
  const d1 = term.onCursorMove(onMove);
  const d2 = term.onResize(() => { size(); target = corners = null; });
  return () => { d1.dispose(); d2.dispose(); cancelAnimationFrame(raf); cv.remove(); };
}
