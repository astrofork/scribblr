// Herdr's status bar (28px): where the space lives, how many drawings, and
// the palette key as actually bound.
import React from "react";
import { useApp } from "../ctx.js";
import { Icon } from "../icons.jsx";
import { tilde, flatten } from "../api.js";
import { prettyKey } from "../keys.js";

export default function StatusBar() {
  const { space, home, drawings, keymap, run } = useApp();
  const count = space ? flatten(drawings[space.folder] ?? []).length : 0;
  const key = Object.entries(keymap).find(([, v]) => v === "app.palette")?.[0];
  return (
    <div className="status-bar">
      <span className="st"><Icon name="monitor" size={13} /> This computer</span>
      {space && <span className="st"><Icon name="folder" size={13} /> {tilde(space.folder, home)}</span>}
      {space && <span className="st"><span className="dot" /> {count} item{count === 1 ? "" : "s"}</span>}
      <span className="grow" />
      <button className="st hint" onClick={() => run("app.palette")}>{key ? `${prettyKey(key)}  commands` : "commands"}</button>
    </div>
  );
}
