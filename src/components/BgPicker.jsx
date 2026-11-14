// Canvas background, the Obsidian-plugin way: swatches plus a real color
// picker (the system's) and a hex field, instead of typing a number only.
import React, { useEffect, useRef, useState } from "react";

const LIGHT = ["#ffffff", "#f8f9fa", "#f5faff", "#fffce8", "#fdf8f6", "#f3f0e8", "#eef5ee", "#f4f0fb"];
const DARK = ["#121212", "#17191d", "#1a1528", "#1e1e2e", "#1a1b26", "#1d2021", "#2e3440", "#21252b"];

export default function BgPicker({ getApi, onClose }) {
  const api = getApi();
  const [color, setColor] = useState(api?.getAppState().viewBackgroundColor ?? "#ffffff");
  const [hex, setHex] = useState(color);
  const ref = useRef(null);

  useEffect(() => {
    const out = (e) => { if (ref.current && !ref.current.contains(e.target)) onClose(); };
    const esc = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("pointerdown", out, true);
    document.addEventListener("keydown", esc, true);
    return () => { document.removeEventListener("pointerdown", out, true); document.removeEventListener("keydown", esc, true); };
  }, [onClose]);

  const apply = (c) => {
    setColor(c); setHex(c);
    getApi()?.updateScene({ appState: { viewBackgroundColor: c } });
  };
  const swatch = (c) => (
    <button key={c} className={`swatch ${c.toLowerCase() === color.toLowerCase() ? "on" : ""}`} style={{ background: c }} title={c} onClick={() => apply(c)} />
  );

  return (
    <div className="popover bg-picker" ref={ref} onPointerDown={(e) => e.stopPropagation()}>
      <div className="pop-label">Light</div>
      <div className="swatches">{LIGHT.map(swatch)}</div>
      <div className="pop-label">Dark</div>
      <div className="swatches">{DARK.map(swatch)}</div>
      <div className="pop-label">Custom</div>
      <div className="custom-row">
        <label className="native-color" style={{ background: color }}>
          <input type="color" value={/^#[0-9a-f]{6}$/i.test(color) ? color : "#ffffff"} onInput={(e) => apply(e.target.value)} />
        </label>
        <input
          className="hex"
          value={hex}
          spellCheck={false}
          onChange={(e) => {
            setHex(e.target.value);
            const v = e.target.value.trim();
            if (/^#?([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(v)) apply(v.startsWith("#") ? v : "#" + v);
          }}
        />
        <button className="pill" onClick={() => apply("transparent")}>None</button>
      </div>
    </div>
  );
}
