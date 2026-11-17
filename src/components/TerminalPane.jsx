// A terminal pane: shows its session (see apps/terminal.js), refits on resize,
// reports its title and folder to the pane header, closes when the shell exits.
import React, { useEffect, useRef } from "react";
import { useApp } from "../ctx.js";
import { getSession, attach, refit, retheme } from "../apps/terminal.js";
import { api } from "../api.js";

export default function TerminalPane({ pane, focused }) {
  const { kitty, theme, dispatch, setTermTitle, space, state } = useApp();
  const mode = state.look.termColors ?? "app";
  const opts = { fontSize: state.look.termFontSize ?? undefined, useKittyFont: state.look.termFont === "kitty" };
  const optsKey = JSON.stringify(opts);
  const box = useRef(null);
  const sess = useRef(null);

  useEffect(() => {
    const s = getSession(pane.id, {
      cwd: pane.cwd ?? space?.folder,
      kitty, theme, mode, opts,
      onTitle: (t) => setTermTitle(pane.id, t),
      // Like kitty: the window closes when its shell ends.
      onExit: () => dispatch({ type: "pane.close", pane: pane.id }),
    });
    sess.current = s;
    attach(s, box.current, kitty?.shell);
    const ro = new ResizeObserver(() => refit(s));
    ro.observe(box.current);
    // The shell's folder, for the header and the next start.
    const t = setInterval(() => {
      api.termCwd(pane.id).then((cwd) => cwd && dispatch({ type: "pane.cwd", pane: pane.id, cwd })).catch(() => {});
    }, 3000);
    return () => { ro.disconnect(); clearInterval(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pane.id]);

  useEffect(() => { if (sess.current) { retheme(sess.current, kitty, theme, mode, opts); sess.current.el.parentElement && (sess.current.el.parentElement.style.background = sess.current.look.theme.background); } }, [theme, kitty, mode, optsKey]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (focused) sess.current?.term.focus(); }, [focused]);

  return <div className="terminal-pane" ref={box} style={{ background: sess.current?.look.theme.background ?? theme.colors.background }} onPointerDown={() => sess.current?.term.focus()} />;
}
