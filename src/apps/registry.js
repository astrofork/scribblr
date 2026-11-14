// Scribblr's apps. Every pane shows one app; the "+" menu, empty panes and
// the Files panel all read this list, so a new app is one entry here (and,
// later, a plug-in folder loaded into the same list; see docs/APPS.md).
//
//   id       unique name
//   label    shown in menus
//   icon     an icon in src/icons
//   ext      the file kind it opens (".note"), if any
//   special  the pane address it lives at without a file ("scribblr:terminal")
//   command  what "+ → label" runs
//   load     () => import("…") of the pane component (props: { pane, file, focused })
export const APPS = [
  { id: "drawing", label: "Drawing", icon: "pen", ext: ".excalidraw", command: "new.drawing" },
  { id: "note", label: "Note", icon: "file-text", ext: ".note", command: "new.note" },
  { id: "terminal", label: "Terminal", icon: "terminal", special: "scribblr:terminal", command: "new.terminal" },
  { id: "calendar", label: "Calendar", icon: "calendar", ext: ".calendar", special: "scribblr:calendar", command: "calendar.open" },
  { id: "graph", label: "Graph", icon: "graph", special: "scribblr:graph", command: "graph.open" },
  { id: "files", label: "Files", icon: "folder-open", special: "scribblr:files", command: "new.files" },
  { id: "web", label: "Web app", icon: "globe", special: "scribblr:web", command: "new.web" },
];

export const appFor = (file) => {
  if (!file) return null;
  return APPS.find((a) => a.special === file) ?? APPS.find((a) => a.ext && file.endsWith(a.ext)) ?? null;
};
