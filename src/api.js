// The Rust side (src-tauri/src/main.rs): config files, themes, the drawings on disk.
import { invoke } from "@tauri-apps/api/core";

export const api = {
  home: () => invoke("home_dir"),
  readConfig: (name) => invoke("read_config", { name }),
  writeConfig: (name, content) => invoke("write_config", { name, content }),
  userThemes: () => invoke("user_themes"),
  listDrawings: (folder) => invoke("list_drawings", { folder }),
  readText: (path) => invoke("read_text", { path }),
  writeText: (path, content) => invoke("write_text", { path, content }),
  createDrawing: (folder, name) => invoke("create_drawing", { folder, name }),
  rename: (from, toName) => invoke("rename_path", { from, toName }),
  trash: (path, spaceFolder) => invoke("trash_path", { path, spaceFolder }),
  exists: (path) => invoke("path_exists", { path }),
  herdrSettings: () => invoke("herdr_settings"),
  saveDrawing: (path, content) => invoke("save_drawing", { path, content }),
  setLinks: (path, links) => invoke("set_links", { path, links }),
  createItem: (folder, name, ext) => invoke("create_item", { folder, name, ext }),
  listDir: (path, hidden = false) => invoke("list_dir", { path, hidden }),
  createDir: (parent, name) => invoke("create_dir", { parent, name }),
  createFile: (parent, name) => invoke("create_file", { parent, name }),
  duplicate: (path) => invoke("duplicate_path", { path }),
  move: (from, toDir) => invoke("move_path", { from, toDir }),
  copyPaths: (paths, toDir) => invoke("copy_paths", { paths, toDir }),
  openPath: (path, reveal = false) => invoke("open_path", { path, reveal }),
  termSpawn: (id, cwd, cols, rows, shell) => invoke("term_spawn", { id, cwd, cols, rows, shell: shell ?? null }),
  termWrite: (id, data) => invoke("term_write", { id, data }),
  termResize: (id, cols, rows) => invoke("term_resize", { id, cols, rows }),
  termKill: (id) => invoke("term_kill", { id }),
  termCwd: (id) => invoke("term_cwd", { id }),
  kittyConfig: () => invoke("kitty_config"),
  webOpen: (label, url, space, r) => invoke("web_open", { label, url, space, ...r }),
  webBounds: (label, r, visible) => invoke("web_bounds", { label, ...r, visible }),
  webNav: (label, action, url) => invoke("web_nav", { label, action, url: url ?? null }),
  webClose: (label) => invoke("web_close", { label }),
  linkIndex: (folders) => invoke("link_index", { folders }),
  rewriteLinks: (folders, oldName, newName) => invoke("rewrite_links", { folders, old: oldName, new: newName }),
};

export const KIND_RE = /\.(excalidraw|note|calendar)$/;
export const baseName = (p) => (p ?? "").split("/").pop().replace(KIND_RE, "");
// What opens a path: drawing, note, calendar, or null (anything else).
export const kindOf = (p) => {
  const m = KIND_RE.exec(p ?? "");
  return m ? { excalidraw: "drawing", note: "note", calendar: "calendar" }[m[1]] : null;
};
export const KIND_ICON = { drawing: "pen", note: "file-text", calendar: "calendar", terminal: "terminal", graph: "graph", web: "globe", files: "folder-open" };
export const tilde = (p, home) => (home && p?.startsWith(home) ? "~" + p.slice(home.length) : p ?? "");

// Every drawing path in a tree from list_drawings, flattened.
export const flatten = (entries, out = []) => {
  for (const e of entries ?? []) e.dir ? flatten(e.children, out) : out.push(e);
  return out;
};
