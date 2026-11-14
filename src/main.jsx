import "./asset-path.js";
import "./keys.js"; // registers the app's key listener before Excalidraw's
import React from "react";
import { createRoot } from "react-dom/client";
import "@excalidraw/excalidraw/index.css";
import "./styles.css";
import App from "./App.jsx";

// No browser menu (Back / Forward / Reload) on right-click: Scribblr has its
// own menus. Text fields keep the system's Cut / Copy / Paste menu.
document.addEventListener("contextmenu", (e) => {
  const t = e.target;
  const editable = t.closest?.("input, textarea, [contenteditable='true']");
  if (!editable || t.closest?.(".excalidraw")) e.preventDefault();
});

createRoot(document.getElementById("root")).render(<App />);
