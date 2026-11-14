// Material Icon Theme (MIT, the VS Code icon set by Philipp Kief) for the
// Files app and panel: copies its SVGs to public/fileicons/ and writes a
// small lookup (extension / file name / folder name -> icon).
import { cpSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
const root = "node_modules/material-icon-theme";
const m = JSON.parse(readFileSync(`${root}/dist/material-icons.json`, "utf8"));
mkdirSync("public/fileicons", { recursive: true });
cpSync(`${root}/icons`, "public/fileicons", { recursive: true });
// VS Code knows these through language ids; add the common ones by extension.
const LANG = { py: "python", js: "javascript", mjs: "javascript", cjs: "javascript", jsx: "javascriptreact", ts: "typescript", tsx: "typescriptreact",
  rs: "rust", go: "go", c: "c", h: "c", cpp: "cpp", hpp: "cpp", cs: "csharp", java: "java", kt: "kotlin", rb: "ruby", php: "php", lua: "lua",
  sh: "shellscript", bash: "shellscript", zsh: "shellscript", fish: "shellscript", json: "json", jsonc: "jsonc", md: "markdown", html: "html",
  css: "css", scss: "scss", sql: "sql", yaml: "yaml", yml: "yaml", xml: "xml", swift: "swift", dart: "dart", r: "r", txt: "plaintext", tex: "latex" };
const ext = { ...m.fileExtensions };
for (const [e, id] of Object.entries(LANG)) if (!ext[e] && m.languageIds?.[id]) ext[e] = m.languageIds[id];
// Scribblr's own kinds and a few Linux files.
Object.assign(ext, { note: "document", calendar: "todo", appimage: "exe", deb: "disc", rpm: "disc", iso: "disc" });
const folders = { ...m.folderNames, ".trash": "folder-trash", trash: "folder-trash", ".scribblr": "folder-config" };
const map = {
  file: m.file, folder: m.folder, folderOpen: m.folderExpanded,
  ext, names: m.fileNames, folders, foldersOpen: { ...m.folderNamesExpanded, ".trash": "folder-trash-open", trash: "folder-trash-open" },
};
writeFileSync("src/apps/fileicons.json", JSON.stringify(map));
console.log(`file icons: ${Object.keys(ext).length} extensions, ${Object.keys(m.folderNames).length} folder names`);
