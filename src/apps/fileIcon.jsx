// The VS Code (Material Icon Theme) icon for a file or folder.
import React from "react";
import map from "./fileicons.json";

export function fileIconName(name, dir, open) {
  const n = name.toLowerCase();
  if (dir) return (open ? map.foldersOpen[n] : map.folders[n]) ?? (open ? map.folderOpen : map.folder);
  if (map.names[n]) return map.names[n];
  // Longest extension first: "tar.gz" before "gz", "d.ts" before "ts".
  const parts = n.split(".");
  for (let i = 1; i < parts.length; i++) {
    const e = parts.slice(i).join(".");
    if (map.ext[e]) return map.ext[e];
  }
  return map.file;
}

export function FileIcon({ name, dir, open, size = 16, className = "" }) {
  return <img className={`file-icon ${className}`} src={`./fileicons/${fileIconName(name, dir, open)}.svg`} width={size} height={size} alt="" draggable={false} />;
}
