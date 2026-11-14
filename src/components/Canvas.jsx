// One Excalidraw editor bound to one .excalidraw file: loads it and autosaves
// it. Links to other drawings are the file's metadata (save_drawing keeps them).
import React, { useEffect, useRef, useState, memo } from "react";
import { Excalidraw, MainMenu, serializeAsJSON, getSceneVersion } from "@excalidraw/excalidraw";
import { openUrl } from "@tauri-apps/plugin-opener";
import { api } from "../api.js";

function Canvas({ file, dark, onApi, paneId, registry }) {
  const [initial, setInitial] = useState(undefined); // undefined: loading, null: missing
  const saved = useRef(null);     // the text last written
  const pending = useRef(null);   // text waiting for the debounce
  const baseline = useRef(null);  // scene key at load: opening a file never rewrites it
  const timer = useRef(null);
  const apiRef = useRef(null);

  const flush = () => {
    clearTimeout(timer.current);
    const text = pending.current;
    pending.current = null;
    if (text && text !== saved.current) {
      saved.current = text;
      return api.saveDrawing(file, text).catch((e) => console.error("save failed", file, e));
    }
    return Promise.resolve();
  };

  useEffect(() => {
    let alive = true;
    baseline.current = null;
    api.readText(file).then((text) => {
      if (!alive) return;
      saved.current = text;
      let d = {};
      try { d = JSON.parse(text || "{}"); } catch { d = {}; }
      const { theme: _t, collaborators: _c, ...appState } = d.appState ?? {};
      setInitial({ elements: d.elements ?? [], appState, files: d.files ?? {}, scrollToContent: true });
    }).catch(() => { if (alive) setInitial(null); });
    if (registry) registry.current[paneId] = { file, flush };
    return () => {
      alive = false;
      flush();
      if (registry?.current[paneId]?.file === file) delete registry.current[paneId];
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file]);

  useEffect(() => {
    const save = () => flush();
    window.addEventListener("beforeunload", save);
    return () => window.removeEventListener("beforeunload", save);
  });

  const onChange = (elements, appState, files) => {
    const key = `${getSceneVersion(elements)}|${appState.viewBackgroundColor}|${Object.keys(files).length}|${appState.gridModeEnabled}`;
    if (baseline.current === null) { baseline.current = key; return; }
    if (key === baseline.current && !pending.current) return;
    baseline.current = key;
    pending.current = serializeAsJSON(elements, appState, files, "local");
    clearTimeout(timer.current);
    timer.current = setTimeout(flush, 400);
  };

  // Web links on shapes open in the browser (the webview can't open windows).
  const onLinkOpen = (element, event) => {
    const link = element.link ?? "";
    event.preventDefault();
    if (/^(https?|mailto):/i.test(link)) openUrl(link).catch(() => {});
  };

  if (initial === undefined) return <div className="canvas-msg" />;
  if (initial === null) return <div className="canvas-msg">This drawing is gone from disk.</div>;
  return (
    <Excalidraw
      initialData={initial}
      excalidrawAPI={(a) => { apiRef.current = a; onApi?.(a); }}
      onChange={onChange}
      onLinkOpen={onLinkOpen}
      theme={dark ? "dark" : "light"}
      UIOptions={{ canvasActions: { toggleTheme: false } }}
    >
      <MainMenu>
        <MainMenu.DefaultItems.LoadScene />
        <MainMenu.DefaultItems.Export />
        <MainMenu.DefaultItems.SaveAsImage />
        <MainMenu.DefaultItems.SearchMenu />
        <MainMenu.DefaultItems.CommandPalette />
        <MainMenu.DefaultItems.Help />
        <MainMenu.DefaultItems.ClearCanvas />
        <MainMenu.Separator />
        <MainMenu.DefaultItems.ChangeCanvasBackground />
      </MainMenu>
    </Excalidraw>
  );
}

export default memo(Canvas);
