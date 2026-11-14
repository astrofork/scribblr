# Contributing to Scribblr

Thanks for helping! Small, focused pull requests are easiest to review.

1. `npm install`, then `npx tauri dev` for a live-reloading build.
2. Keep Scribblr's two promises: **your work is plain files in your folder**,
   and **it looks and behaves like one calm window** (Herdr's chrome, theme
   colours via CSS variables, keys in `keys.json`).
3. New app (a new kind of tile)? Read [docs/APPS.md](docs/APPS.md).
4. Before a PR: `npm run build` and `cargo check --manifest-path src-tauri/Cargo.toml` pass.

Licence: contributions are under Apache-2.0. Don't paste code from
GPL/AGPL projects (kitty, AppFlowy…): reimplement from their docs instead.
