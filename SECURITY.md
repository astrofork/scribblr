# Security

Scribblr is a local desktop app. It opens no network ports and sends nothing
anywhere; the only network traffic is what you open yourself in a web pane.

## How it keeps you safe
| Area | Protection |
|---|---|
| **Web panes** (Notion, Docs…) | Separate WebKit views with their own browser storage per space. They get **no** Scribblr API (`__TAURI__` is absent) and can't reach the app's IPC. Only `http(s)` addresses open. |
| **The app's page** | Strict Content-Security-Policy: no inline or remote scripts, no plugins, frames only from `https:`. |
| **Files** | Every file command is checked in Rust: only your home folder, `/tmp` and mounted drives; never `~/.ssh`, `~/.gnupg`, `~/.password-store`, keyrings or Scribblr's own browser data; `..` can't escape. |
| **Opening files** | Programs (executable files, `.desktop`, `.AppImage`, `.sh`…) are never started by a click. |
| **Notes from others** | Embeds only load `http(s)` pages; drawing previews are shown as images, so nothing inside a file can run as code. |
| **Terminals** | Shells don't inherit `CLAUDE*`/build variables from whatever launched Scribblr. |

The end-to-end suite (`e2e/run.py`) checks all of the above against the real
app, including a hostile web page that tries to reach the app.

## Reporting a problem
Please open a private security advisory on GitHub (Security → Report a
vulnerability) rather than a public issue. Include steps to reproduce.
