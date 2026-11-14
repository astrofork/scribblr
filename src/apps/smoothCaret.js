// A text cursor that glides, like the terminal's kitty-style trail: the real
// caret is hidden and this one slides to each new place, stretching briefly
// on long jumps, then blinks. Used by notes (any contenteditable area).
export function attachSmoothCaret(scroller) {
  const caret = document.createElement("div");
  caret.className = "smooth-caret";
  const ghost = document.createElement("div");
  ghost.className = "smooth-caret ghost";
  scroller.appendChild(ghost);
  scroller.appendChild(caret);
  let last = null, raf = 0;

  const place = () => {
    raf = 0;
    const sel = document.getSelection();
    const ed = scroller.querySelector('[contenteditable="true"]');
    if (!sel || !sel.rangeCount || !sel.isCollapsed || !ed || !ed.contains(sel.anchorNode) || document.activeElement !== ed) {
      caret.classList.remove("blink"); caret.style.opacity = "0"; last = null; return;
    }
    const range = sel.getRangeAt(0).cloneRange();
    let r = range.getClientRects()[0];
    if (!r || (!r.height && !r.width)) {
      const el = sel.anchorNode.nodeType === 1 ? sel.anchorNode : sel.anchorNode.parentElement;
      const b = el.getBoundingClientRect();
      const lh = parseFloat(getComputedStyle(el).lineHeight) || 20;
      r = { left: b.left + (parseFloat(getComputedStyle(el).paddingLeft) || 0), top: b.top + (b.height - lh) / 2, height: lh };
    }
    const host = scroller.getBoundingClientRect();
    const x = r.left - host.left + scroller.scrollLeft;
    const y = r.top - host.top + scroller.scrollTop;
    const h = r.height;
    caret.style.opacity = "1";
    caret.style.height = `${h}px`;
    // A long jump leaves a fading trail from the old spot.
    if (last && (Math.abs(last.y - y) > h * 0.9 || Math.abs(last.x - x) > 40)) {
      ghost.style.transition = "none";
      ghost.style.height = `${last.h}px`;
      ghost.style.transform = `translate(${last.x}px, ${last.y}px)`;
      ghost.style.opacity = "0.45";
      void ghost.offsetWidth;
      ghost.style.transition = "";
      ghost.style.transform = `translate(${x}px, ${y}px)`;
      ghost.style.opacity = "0";
    }
    caret.style.transform = `translate(${x}px, ${y}px)`;
    caret.classList.remove("blink");
    void caret.offsetWidth;
    caret.classList.add("blink");
    last = { x, y, h };
  };
  const schedule = () => { if (!raf) raf = requestAnimationFrame(place); };
  // A small glow each keystroke, like ink landing.
  let typingTimer = 0;
  scroller.addEventListener("input", () => {
    caret.classList.add("typing");
    clearTimeout(typingTimer);
    typingTimer = setTimeout(() => caret.classList.remove("typing"), 140);
    schedule();
  });
  document.addEventListener("selectionchange", schedule);
  scroller.addEventListener("scroll", schedule);
  scroller.addEventListener("focusin", schedule);
  scroller.addEventListener("focusout", () => setTimeout(schedule, 0));
  const ro = new ResizeObserver(schedule);
  ro.observe(scroller);
  return () => {
    document.removeEventListener("selectionchange", schedule);
    ro.disconnect();
    cancelAnimationFrame(raf);
    caret.remove(); ghost.remove();
  };
}
