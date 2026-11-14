# Apps in Scribblr

Every tile shows one **app**. Drawing, Note, Terminal, Calendar and Graph are
the built-in ones, listed in `src/apps/registry.js`:

```js
{ id: "note", label: "Note", icon: "file-text", ext: ".note", command: "new.note" }
```

- `ext`: the file kind it opens: the Files panel, `+` menu, picker, links and
  graph all pick it up. Store the app's data as JSON with a top-level
  `"scribblr": { "links": [...] }` so links and backlinks work.
- `special`: an address for an app without a file (`scribblr:terminal`).
- `command`: what `+ → label` runs (add it to `run()` in `App.jsx`).
- The pane component gets `useApp()`: theme colours (`theme.colors`, also as
  CSS variables `--accent`, `--surface`, …), the space, `openLink`, `tile`,
  `dispatch`, and the file helpers in `src/api.js`.

## Plug-in apps (planned)
A plug-in will be a folder in `~/.config/scribblr/apps/<id>/` with an
`app.json` (the registry entry above) and a `main.js` that exports the pane
component, loaded into the same list at start. A store will list and install
these folders. AI plug-ins will use the same commands the apps expose
(open, read, add a block, add a to-do, draw) through a `scribblr` CLI.
