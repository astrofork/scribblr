# Scribblr

<img src="src/icons/scribblr.svg" width="96" align="right" alt="Scribblr's goat">

**One tiled workspace for studying, coding and planning.** Drawings
(Excalidraw), Notion-style notes, a kitty-style terminal and a calendar with
to-dos, side by side in Hyprland-style tiles, organised in spaces, linked into
a graph. A native Linux app (Tauri + Rust), with Herdr's window design.

- **Spaces** are folders. Everything you make is a plain file in that folder.
- **Tiles**: `+` (or a shortcut) opens a drawing, note, terminal, calendar or
  the graph next to what's there, splitting along the longer side like
  Hyprland. Move with `Alt+H/J/K/L`, swap with `Alt+Shift+H/J/K/L`, drag
  the gaps to resize, `Ctrl+Shift+F` for focus mode (one pane fills the window).
- **Drawings**: Excalidraw, with a real canvas colour picker. `.excalidraw` files.
- **Notes**: Notion-style blocks (`/` menu, drag handles, to-dos, toggles,
  tables, code), web embeds (pages, YouTube), embedded drawings, `@` to link
  pages, tags. `.note` files (JSON blocks).
- **Terminal**: your shell in a tile, styled from your `kitty.conf` (font,
  size, colours, cursor, padding, scrollback) with kitty's clipboard, scroll
  and font-size keys. Ends with its shell, like a kitty window.
- **Calendar**: month and week views, to-dos on every day (drag to move, tick
  to finish, "9:30 Lecture" sets a time), several colour-coded calendars per
  space. `.calendar` files.
- **Links and graph**: link any drawing, note or calendar to another
  (`Ctrl+Shift+L`, or `@` in notes); see links and backlinks in the Links
  panel and everything in the graph (`Ctrl+Shift+G`). Renames update links.
- **Files**: every file in the space: new file / folder / drawing / note,
  rename, duplicate, drag to move, trash, open in the system app.
- **Herdr's look**: its sidebar, tab bar, status bar, themes (graphite, ink,
  moss, paper, …; your Herdr themes too), and `keys.json` format.

## Install
**Download** the AppImage, `.deb` or `.rpm` from [Releases](../../releases):

```sh
# AppImage (any distro)
chmod +x Scribblr_*.AppImage && ./Scribblr_*.AppImage
# Debian / Ubuntu
sudo apt install ./Scribblr_*_amd64.deb
# Fedora / openSUSE
sudo dnf install ./Scribblr-*.x86_64.rpm
```

**Or build it** (needs Node 20+, Rust via rustup, `webkit2gtk-4.1`, `gtk3`):

```sh
git clone https://github.com/astrofork/scribblr.git && cd scribblr
npm install
npx tauri build            # packages in src-tauri/target/release/bundle/
npx tauri dev              # live-reloading development build
```

## How to use it
1. **Spaces.** The first start makes a space in `~/Scribblr`. Add any folder
   as a space with **+** next to *Spaces* (or `Ctrl+Shift+N`). Switch with
   `Alt+1…9`. Right-click a space to rename, recolour or remove it (files stay).
2. **Open things.** The **+** in the tab bar opens a new tab with a Drawing,
   Note, Terminal, Calendar, Graph, Files or Web app. Each row's split icon
   opens it *next to* the focused pane instead.
3. **Tile.** The split buttons in a pane's header (or `Ctrl+Shift+O` /
   `Ctrl+Shift+D`) split the pane; pick an app in the new empty pane. Move with
   `Alt+H/J/K/L`, swap with `Alt+Shift+H/J/K/L`, drag gaps to resize.
4. **Focus.** `Ctrl+Shift+F` (or double-click a pane header) makes one pane fill
   the whole window. In a web app, **F11** is *Ultra fit*: only the page,
   nothing else (F11 / Esc to return; can be turned off in Settings).
5. **Drawings** are Excalidraw. The 🎨 button sets the canvas colour.
6. **Notes** are Notion-style: type `/` for blocks (to-dos, toggles, tables,
   code, web embeds, drawings), `@` to link a page, add tags under the title.
   The ⤢ button switches full-width / narrow pages.
7. **Calendar.** A small month on the left, the chosen day on the right with
   its pages and its own day note. Double-click a day to add a page; tick it
   off in the list. *Timeline* shows pages as bars you drag and stretch.
   Several colour-coded calendars per space (🎨 in the calendar toolbar).
8. **Links.** `Ctrl+Shift+L` links the focused drawing/note to another (or a
   new) one; the **Links** panel shows links and backlinks; **Graph**
   (`Ctrl+Shift+G`) shows everything. Renaming keeps links working.
9. **Files.** The Files panel (`Ctrl+Shift+E`) and the Files app show every
   file. Click opens; `Ctrl`/`Shift`-click selects, then `Delete`, right-click
   or the selection bar to trash. Drag onto folders to move.
10. **Terminal** uses your shell and your `kitty.conf` font, size, cursor and
    keys; colours follow the theme (or kitty's: Settings → Terminal colours).
11. **Web apps** keep their logins per space. Sign-in pop-ups open as small
    windows. `Ctrl +/−/0` zooms the page.
12. **Settings** (`Ctrl+,`): light/dark, themes (your Herdr themes too),
    terminal colours, Ultra fit, zoom. All keys: `Ctrl+Shift+?`.

## Files
| Where | What |
|---|---|
| `<space>/*.excalidraw`, `*.note`, `*.calendar` | your work (links in a `"scribblr"` field) |
| `<space>/.trash/` | things you moved to trash |
| `~/.config/scribblr/state.json` | spaces, tabs, tiles, look |
| `~/.config/scribblr/keys.json` | key overrides |
| `~/.config/scribblr/themes/*.json` | themes (Herdr format) |

## Code
| Path | |
|---|---|
| `src-tauri/src/main.rs` | files, links, terminals (PTY), kitty.conf |
| `src/store.js` | spaces / tabs / tile trees |
| `src/App.jsx` | commands, keys, menus, overlays |
| `src/apps/registry.js` | the app list (see [docs/APPS.md](docs/APPS.md)) |
| `src/components/` | Sidebar, TabsBar, Workspace, Canvas, NotePane, TerminalPane, CalendarPane, GraphView, FilesPanel, LinksPanel |

## Tests
```sh
cargo test --manifest-path src-tauri/Cargo.toml   # Rust: files, links, safety rules
npx tauri build --no-bundle && python3 -I e2e/run.py   # end-to-end, real app
```
The end-to-end run uses a throw-away home folder (your files are never
touched) and needs `tauri-driver` (`cargo install tauri-driver`) and
`WebKitWebDriver` (part of webkit2gtk). See [SECURITY.md](SECURITY.md).

## Roadmap
Plug-in apps and an app store, AI / agent plug-ins (a `scribblr` CLI like
Herdr's `hc`), calendar sync (`.ics`), a code editor tile.

## Credits
Window design adapted from [Herdr](https://herdr.dev) (Apache-2.0); Scribblr
is not affiliated with Herdr. Built on [Excalidraw](https://excalidraw.com)
(MIT), [BlockNote](https://www.blocknotejs.org) (MPL-2.0),
[xterm.js](https://xtermjs.org) (MIT), [Tauri](https://tauri.app)
(Apache-2.0/MIT), Lucide icons (ISC), [Material Icon Theme](https://github.com/material-extensions/vscode-material-icon-theme) file icons (MIT) and Geist (OFL). Terminal behaviour
follows [kitty](https://sw.kovidgoyal.net/kitty/)'s documented config and
defaults (no kitty code is included). See [NOTICE](NOTICE).

## License
Scribblr is open source under the [Apache License 2.0](LICENSE): use it,
change it, ship it, commercially too; keep the license and [NOTICE](NOTICE)
with copies, and say what you changed. Apache-2.0 matches Herdr (whose design
Scribblr adapts) and includes a patent grant. All bundled libraries are under
compatible licenses (MIT, ISC, OFL, MPL-2.0 for BlockNote, unmodified).
