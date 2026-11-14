// Scribblr backend: config files (~/.config/scribblr), themes, and the
// file system of each space (a folder of .excalidraw drawings).
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::Serialize;
use std::fs;
use serde_json::Value;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::SystemTime;

/// A path for the UI: always with "/" so the frontend can split it the same
/// way on every system (Windows accepts "/" too).
fn ps(p: &Path) -> String {
    let s = p.display().to_string();
    if cfg!(windows) { s.replace('\\', "/") } else { s }
}

fn config_dir() -> PathBuf {
    let dir = dirs::config_dir().unwrap_or_else(|| PathBuf::from(".")).join("scribblr");
    let _ = fs::create_dir_all(dir.join("themes"));
    dir
}

fn atomic_write(path: &Path, content: &str) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let tmp = path.with_extension("scribblr-tmp");
    fs::write(&tmp, content).map_err(|e| e.to_string())?;
    fs::rename(&tmp, path).map_err(|e| e.to_string())
}


// ---------- path safety ----------
// Every file command goes through `guard`: Scribblr only touches your files
// (home, /tmp, removable drives), never its own browser data, and never
// secrets like ~/.ssh or ~/.gnupg, even if a bug or a malicious page in the
// app's webview tried to ask for them.
const SECRET_DIRS: [&str; 7] = [".ssh", ".gnupg", ".password-store", ".local/share/keyrings", ".local/share/scribblr/web", "AppData/Roaming/scribblr/web", "AppData/Local/scribblr/web"];

fn resolve(p: &Path) -> PathBuf {
    // First remove "." and ".." by hand: a ".." after a folder that doesn't
    // exist (/home/me/nope/../../../etc) must not survive to the checks.
    use std::path::Component;
    let mut clean = PathBuf::new();
    for c in p.components() {
        match c {
            Component::ParentDir => { clean.pop(); }
            Component::CurDir => {}
            other => clean.push(other.as_os_str()),
        }
    }
    // Then canonicalise the nearest existing ancestor (follows symlinks; the
    // file itself may not exist yet).
    let mut base = clean;
    let mut rest = Vec::new();
    while !base.exists() {
        match (base.file_name().map(|f| f.to_os_string()), base.parent()) {
            (Some(name), Some(parent)) => { rest.push(name); base = parent.to_path_buf(); }
            _ => break,
        }
    }
    let mut out = fs::canonicalize(&base).unwrap_or(base);
    for part in rest.into_iter().rev() {
        if part == ".." { out.pop(); } else if part != "." { out.push(part); }
    }
    out
}

fn guard(path: &str) -> Result<PathBuf, String> {
    let p = Path::new(path);
    if !p.is_absolute() { return Err("Paths must be absolute".into()); }
    let real = resolve(p);
    let home = dirs::home_dir().map(|h| fs::canonicalize(&h).unwrap_or(h)).unwrap_or_default();
    let tmp = fs::canonicalize(std::env::temp_dir()).unwrap_or_else(|_| std::env::temp_dir());
    #[cfg(unix)]
    let roots = vec![home.clone(), tmp, PathBuf::from("/tmp"), PathBuf::from("/media"), PathBuf::from("/mnt"), PathBuf::from("/run/media"), PathBuf::from("/Volumes")];
    // Windows: your profile, temp, and other drives (D:, E:...) but not the
    // system drive's Windows / Program Files folders.
    #[cfg(windows)]
    let roots = {
        let mut r = vec![home.clone(), tmp];
        let sys = std::env::var("SystemDrive").unwrap_or_else(|_| "C:".into()).to_uppercase();
        for d in b'D'..=b'Z' {
            let drive = format!("{}:", d as char);
            if drive != sys { if let Ok(c) = fs::canonicalize(format!("{drive}\\")) { r.push(c); } }
        }
        r
    };
    if !roots.iter().any(|r| !r.as_os_str().is_empty() && real.starts_with(r)) {
        return Err(format!("Scribblr only works inside your home folder and drives ({})", real.display()));
    }
    if SECRET_DIRS.iter().any(|d| real.starts_with(home.join(d))) {
        return Err("That folder is private and off limits".into());
    }
    Ok(real)
}

#[tauri::command]
fn home_dir() -> String {
    dirs::home_dir().map(|p| ps(&p)).unwrap_or_default()
}

/// Reads a config file (state.json, keys.json, settings.json); None if missing.
#[tauri::command]
fn read_config(name: String) -> Option<String> {
    if name.contains('/') || name.contains("..") {
        return None;
    }
    fs::read_to_string(config_dir().join(name)).ok()
}

#[tauri::command]
fn write_config(name: String, content: String) -> Result<(), String> {
    if name.contains('/') || name.contains("..") {
        return Err("bad name".into());
    }
    atomic_write(&config_dir().join(name), &content)
}

#[derive(Serialize)]
struct ThemeFile {
    name: String,
    source: String,
    json: String,
}

/// Theme files in Herdr's format: Scribblr's own, then Herdr's (shared).
#[tauri::command]
fn user_themes() -> Vec<ThemeFile> {
    let mut out = Vec::new();
    let mut dirs_list = vec![("scribblr", config_dir().join("themes"))];
    if let Some(c) = dirs::config_dir() {
        dirs_list.push(("herdr", c.join("herdr-app/themes")));
    }
    for (source, dir) in dirs_list {
        let Ok(entries) = fs::read_dir(&dir) else { continue };
        let mut files: Vec<_> = entries.flatten().map(|e| e.path()).collect();
        files.sort();
        for p in files {
            if p.extension().and_then(|e| e.to_str()) != Some("json") {
                continue;
            }
            let name = p.file_stem().and_then(|s| s.to_str()).unwrap_or("").to_string();
            if name == "win98" || out.iter().any(|t: &ThemeFile| t.name == name) {
                continue;
            }
            if let Ok(json) = fs::read_to_string(&p) {
                out.push(ThemeFile { name, source: source.into(), json });
            }
        }
    }
    out
}

#[derive(Serialize)]
struct Entry {
    name: String,
    path: String,
    dir: bool,
    children: Vec<Entry>,
}

/// Scribblr's own file kinds: drawings, notes, calendars.
const KINDS: [&str; 3] = [".excalidraw", ".note", ".calendar"];
fn is_drawing(name: &str) -> bool {
    KINDS.iter().any(|k| name.ends_with(k))
}
fn kind_ext(name: &str) -> &'static str {
    KINDS.iter().find(|k| name.ends_with(*k)).copied().unwrap_or("")
}

fn walk(dir: &Path, depth: usize) -> Vec<Entry> {
    let mut out = Vec::new();
    if depth > 8 {
        return out;
    }
    let Ok(entries) = fs::read_dir(dir) else { return out };
    for e in entries.flatten() {
        let name = e.file_name().to_string_lossy().to_string();
        if name.starts_with('.') || name == "node_modules" || name == "target" {
            continue;
        }
        let path = e.path();
        let is_dir = e.file_type().map(|t| t.is_dir()).unwrap_or(false);
        if is_dir {
            let children = walk(&path, depth + 1);
            if !children.is_empty() {
                out.push(Entry { name, path: ps(&path), dir: true, children });
            }
        } else if is_drawing(&name) {
            out.push(Entry { name, path: ps(&path), dir: false, children: vec![] });
        }
    }
    out.sort_by(|a, b| b.dir.cmp(&a.dir).then(a.name.to_lowercase().cmp(&b.name.to_lowercase())));
    out
}

/// Every drawing in a space's folder, as a tree (folders without drawings are left out).
#[tauri::command]
fn list_drawings(folder: String) -> Vec<Entry> {
    walk(Path::new(&folder), 0)
}

#[tauri::command]
fn read_text(path: String) -> Result<String, String> {
    guard(&path)?;
    fs::read_to_string(&path).map_err(|e| e.to_string())
}

#[tauri::command]
fn write_text(path: String, content: String) -> Result<(), String> {
    guard(&path)?;
    atomic_write(Path::new(&path), &content)
}

fn template(ext: &str) -> &'static str {
    match ext {
        ".note" => r#"{"type":"scribblr-note","version":1,"blocks":[],"scribblr":{"links":[],"tags":[]}}"#,
        ".calendar" => r#"{"type":"scribblr-calendar","version":1,"color":"ansi4","items":[],"scribblr":{"links":[]}}"#,
        _ => r#"{"type":"excalidraw","version":2,"source":"scribblr","elements":[],"appState":{},"files":{},"scribblr":{"links":[]}}"#,
    }
}

/// Creates `<folder>/<name><ext>` for a Scribblr kind (adds " 2", " 3"... if taken).
#[tauri::command]
fn create_item(folder: String, name: String, ext: String) -> Result<String, String> {
    guard(&folder)?;
    let ext = KINDS.iter().find(|k| **k == ext).copied().unwrap_or(".excalidraw");
    let base = name.trim().trim_end_matches(ext).replace('/', "-");
    let base = if base.is_empty() { "Untitled".to_string() } else { base };
    let dir = Path::new(&folder);
    fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let mut n = 1;
    loop {
        let file = if n == 1 { format!("{base}{ext}") } else { format!("{base} {n}{ext}") };
        let path = dir.join(file);
        if !path.exists() {
            atomic_write(&path, template(ext))?;
            return Ok(ps(&path));
        }
        n += 1;
    }
}

#[tauri::command]
fn create_drawing(folder: String, name: String) -> Result<String, String> {
    create_item(folder, name, ".excalidraw".into())
}

#[tauri::command]
fn rename_path(from: String, to_name: String) -> Result<String, String> {
    guard(&from)?;
    let from = PathBuf::from(from);
    let mut name = plain_name(&to_name)?;
    if !from.is_dir() {
        let fname = from.file_name().map(|f| f.to_string_lossy().to_string()).unwrap_or_default();
        let kind = kind_ext(&fname);
        if !kind.is_empty() {
            if !name.ends_with(kind) { name.push_str(kind); }
        } else if !name.contains('.') {
            if let Some(ext) = from.extension() { name = format!("{name}.{}", ext.to_string_lossy()); }
        }
    }
    let to = from.with_file_name(name);
    if to.exists() {
        return Err("Something with that name already exists".into());
    }
    fs::rename(&from, &to).map_err(|e| e.to_string())?;
    Ok(ps(&to))
}

/// Moves a drawing into the space's `.trash` folder instead of deleting it.
#[tauri::command]
fn trash_path(path: String, space_folder: String) -> Result<(), String> {
    guard(&path)?;
    guard(&space_folder)?;
    let from = PathBuf::from(&path);
    let trash = Path::new(&space_folder).join(".trash");
    fs::create_dir_all(&trash).map_err(|e| e.to_string())?;
    let name = from.file_name().ok_or("no file name")?.to_string_lossy().to_string();
    let mut to = trash.join(&name);
    let mut n = 2;
    while to.exists() {
        to = trash.join(format!("{n}-{name}"));
        n += 1;
    }
    fs::rename(&from, &to).map_err(|e| e.to_string())
}

/// Herdr's settings.json (zoom, appearance...), so Scribblr starts looking the same.
#[tauri::command]
fn herdr_settings() -> Option<String> {
    fs::read_to_string(dirs::config_dir()?.join("herdr-app/settings.json")).ok()
}

/// Opens a file with the system's default app, or shows a folder in the file
/// manager. Programs (executable files, .desktop launchers, AppImages) are
/// never started this way: a downloaded file can't run just by a click.
#[tauri::command]
fn open_path(path: String, reveal: bool) -> Result<(), String> {
    let p = guard(&path)?;
    if reveal {
        return tauri_plugin_opener::reveal_item_in_dir(&p).map_err(|e| e.to_string());
    }
    if p.is_file() && is_program(&p) {
        return Err("This is a program. For safety Scribblr won't start it; run it yourself if you trust it.".into());
    }
    #[cfg(target_os = "linux")]
    { std::process::Command::new("xdg-open").arg(&p).spawn().map(|_| ()).map_err(|e| e.to_string()) }
    #[cfg(not(target_os = "linux"))]
    { tauri_plugin_opener::open_path(&p, None::<&str>).map_err(|e| e.to_string()) }
}

/// Files that would run code if "opened": executables and launchers.
fn is_program(p: &Path) -> bool {
    let name = p.file_name().map(|n| n.to_string_lossy().to_lowercase()).unwrap_or_default();
    const LAUNCHERS: [&str; 21] = [".desktop", ".appimage", ".sh", ".run", ".bin", ".exe", ".jar", ".bat", ".cmd", ".com", ".ps1",
        ".psm1", ".vbs", ".vbe", ".js", ".jse", ".wsf", ".msi", ".lnk", ".scr", ".app"];
    if LAUNCHERS.iter().any(|e| name.ends_with(e)) { return true; }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if fs::metadata(p).map(|m| m.permissions().mode() & 0o111 != 0).unwrap_or(false) { return true; }
    }
    false
}

#[tauri::command]
fn path_exists(path: String) -> bool {
    Path::new(&path).exists()
}


// ---------- links between drawings ----------
// Links are the drawing's own metadata, not shapes or text: a top-level
// `"scribblr": { "links": ["Other drawing", ...] }` in the .excalidraw file.
// Excalidraw ignores the field; every save keeps it (save_drawing).

static FILE_LOCK: Mutex<()> = Mutex::new(());

fn read_json(path: &Path) -> Option<Value> {
    serde_json::from_str(&fs::read_to_string(path).ok()?).ok()
}

fn links_of(json: &Value) -> Vec<String> {
    let mut out: Vec<String> = json.pointer("/scribblr/links").and_then(|l| l.as_array()).into_iter().flatten()
        .filter_map(|v| v.as_str()).map(|s| s.trim().to_string()).filter(|s| !s.is_empty()).collect();
    let mut seen = std::collections::HashSet::new();
    out.retain(|s| seen.insert(s.to_lowercase()));
    out
}

fn set_meta_links(json: &mut Value, links: Vec<String>) {
    if !json.get("scribblr").map(|v| v.is_object()).unwrap_or(false) {
        json["scribblr"] = serde_json::json!({});
    }
    json["scribblr"]["links"] = Value::from(links);
}

/// The editor's save: writes the scene, keeping the file's scribblr metadata.
#[tauri::command]
fn save_drawing(path: String, content: String) -> Result<(), String> {
    guard(&path)?;
    let _g = FILE_LOCK.lock().unwrap();
    let p = Path::new(&path);
    let mut json: Value = serde_json::from_str(&content).map_err(|e| e.to_string())?;
    if let Some(meta) = read_json(p).and_then(|old| old.get("scribblr").cloned()) {
        json["scribblr"] = meta;
    }
    atomic_write(p, &serde_json::to_string(&json).map_err(|e| e.to_string())?)
}

/// Replaces a drawing's links (names of other drawings).
#[tauri::command]
fn set_links(path: String, links: Vec<String>) -> Result<(), String> {
    guard(&path)?;
    let _g = FILE_LOCK.lock().unwrap();
    let p = Path::new(&path);
    let mut json = read_json(p).ok_or("can't read drawing")?;
    let mut clean = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for l in links {
        let l = l.trim().trim_end_matches(".excalidraw").to_string();
        if !l.is_empty() && seen.insert(l.to_lowercase()) {
            clean.push(l);
        }
    }
    set_meta_links(&mut json, clean);
    atomic_write(p, &serde_json::to_string(&json).map_err(|e| e.to_string())?)
}

#[derive(Serialize, Clone)]
struct LinkEntry {
    path: String,
    links: Vec<String>,
}

static LINK_CACHE: Mutex<Option<HashMap<String, (SystemTime, Vec<String>)>>> = Mutex::new(None);

fn drawing_paths(entries: &[Entry], out: &mut Vec<String>) {
    for e in entries {
        if e.dir { drawing_paths(&e.children, out) } else { out.push(e.path.clone()) }
    }
}

fn all_drawings(folders: &[String]) -> Vec<String> {
    let mut paths = Vec::new();
    for f in folders {
        drawing_paths(&walk(Path::new(f), 0), &mut paths);
    }
    paths
}

/// Each drawing's links, for the graph and backlinks (cached by modified time).
#[tauri::command]
fn link_index(folders: Vec<String>) -> Vec<LinkEntry> {
    let mut guard = LINK_CACHE.lock().unwrap();
    let cache = guard.get_or_insert_with(HashMap::new);
    let mut out = Vec::new();
    for p in all_drawings(&folders) {
        let Ok(mtime) = fs::metadata(&p).and_then(|m| m.modified()) else { continue };
        let links = match cache.get(&p) {
            Some((t, l)) if *t == mtime => l.clone(),
            _ => {
                let l = read_json(Path::new(&p)).map(|j| links_of(&j)).unwrap_or_default();
                cache.insert(p.clone(), (mtime, l.clone()));
                l
            }
        };
        out.push(LinkEntry { path: p, links });
    }
    out
}

/// After a rename: links to `old` now point at `new`. Returns files changed.
#[tauri::command]
fn rewrite_links(folders: Vec<String>, old: String, new: String) -> usize {
    let _g = FILE_LOCK.lock().unwrap();
    let mut changed = 0;
    for p in all_drawings(&folders) {
        let path = Path::new(&p);
        let Some(mut json) = read_json(path) else { continue };
        let links = links_of(&json);
        if !links.iter().any(|l| l.eq_ignore_ascii_case(&old)) {
            continue;
        }
        let next = links.into_iter().map(|l| if l.eq_ignore_ascii_case(&old) { new.clone() } else { l }).collect();
        set_meta_links(&mut json, next);
        if let Ok(t) = serde_json::to_string(&json) {
            if atomic_write(path, &t).is_ok() {
                changed += 1;
            }
        }
    }
    changed
}


// ---------- file system (Files panel) ----------

#[derive(Serialize)]
struct DirEntry {
    name: String,
    path: String,
    dir: bool,
    size: u64,
    modified: u64,
}

/// One folder's children (folders first). Hidden files only when asked.
#[tauri::command]
fn list_dir(path: String, hidden: bool) -> Result<Vec<DirEntry>, String> {
    guard(&path)?;
    let mut out: Vec<DirEntry> = fs::read_dir(&path).map_err(|e| e.to_string())?.flatten()
        .filter_map(|e| {
            let name = e.file_name().to_string_lossy().to_string();
            if !hidden && name.starts_with('.') { return None; }
            let meta = fs::metadata(e.path()).ok();
            let dir = meta.as_ref().map(|m| m.is_dir()).unwrap_or(false);
            let size = meta.as_ref().map(|m| m.len()).unwrap_or(0);
            let modified = meta.and_then(|m| m.modified().ok())
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map(|d| d.as_secs()).unwrap_or(0);
            Some(DirEntry { name, path: ps(&e.path()), dir, size, modified })
        })
        .collect();
    out.sort_by(|a, b| b.dir.cmp(&a.dir).then(a.name.to_lowercase().cmp(&b.name.to_lowercase())));
    Ok(out)
}

fn plain_name(name: &str) -> Result<String, String> {
    let n = name.trim().replace('/', "-");
    if n.is_empty() || n == "." || n == ".." { return Err("That name can't be used".into()); }
    Ok(n)
}

fn free_name(dir: &Path, name: &str) -> PathBuf {
    let p = dir.join(name);
    if !p.exists() { return p; }
    let (stem, ext) = match name.rfind('.') {
        Some(i) if i > 0 => (&name[..i], &name[i..]),
        _ => (name, ""),
    };
    let mut n = 2;
    loop {
        let p = dir.join(format!("{stem} {n}{ext}"));
        if !p.exists() { return p; }
        n += 1;
    }
}

#[tauri::command]
fn create_dir(parent: String, name: String) -> Result<String, String> {
    guard(&parent)?;
    let p = free_name(Path::new(&parent), &plain_name(&name)?);
    fs::create_dir_all(&p).map_err(|e| e.to_string())?;
    Ok(ps(&p))
}

#[tauri::command]
fn create_file(parent: String, name: String) -> Result<String, String> {
    guard(&parent)?;
    let name = plain_name(&name)?;
    let kind = kind_ext(&name);
    if !kind.is_empty() {
        return create_item(parent, name.trim_end_matches(kind).to_string(), kind.to_string());
    }
    let p = free_name(Path::new(&parent), &name);
    fs::write(&p, "").map_err(|e| e.to_string())?;
    Ok(ps(&p))
}

fn copy_rec(from: &Path, to: &Path) -> std::io::Result<()> {
    if from.is_dir() {
        fs::create_dir_all(to)?;
        for e in fs::read_dir(from)?.flatten() {
            copy_rec(&e.path(), &to.join(e.file_name()))?;
        }
        Ok(())
    } else {
        fs::copy(from, to).map(|_| ())
    }
}

#[tauri::command]
fn duplicate_path(path: String) -> Result<String, String> {
    guard(&path)?;
    let from = PathBuf::from(&path);
    let parent = from.parent().ok_or("no parent")?;
    let name = from.file_name().ok_or("no name")?.to_string_lossy().to_string();
    let kind = kind_ext(&name);
    let copy_name = if !kind.is_empty() {
        format!("{} copy{}", name.trim_end_matches(kind), kind)
    } else {
        match name.rfind('.') { Some(i) if i > 0 => format!("{} copy{}", &name[..i], &name[i..]), _ => format!("{name} copy") }
    };
    let to = free_name(parent, &copy_name);
    copy_rec(&from, &to).map_err(|e| e.to_string())?;
    Ok(ps(&to))
}

/// Copies files/folders into a folder (paste); returns the new paths.
#[tauri::command]
fn copy_paths(paths: Vec<String>, to_dir: String) -> Result<Vec<String>, String> {
    guard(&to_dir)?;
    for p in &paths { guard(p)?; }
    let dir = PathBuf::from(&to_dir);
    let mut out = Vec::new();
    for p in paths {
        let from = PathBuf::from(&p);
        if dir.starts_with(&from) { return Err("Can't copy a folder into itself".into()); }
        let name = from.file_name().ok_or("no name")?.to_string_lossy().to_string();
        let to = free_name(&dir, &name);
        copy_rec(&from, &to).map_err(|e| e.to_string())?;
        out.push(ps(&to));
    }
    Ok(out)
}

/// Moves a file or folder into another folder; returns the new path.
#[tauri::command]
fn move_path(from: String, to_dir: String) -> Result<String, String> {
    guard(&from)?;
    guard(&to_dir)?;
    let from = PathBuf::from(&from);
    let to_dir = PathBuf::from(&to_dir);
    if to_dir.starts_with(&from) {
        return Err("Can't move a folder into itself".into());
    }
    let name = from.file_name().ok_or("no name")?.to_string_lossy().to_string();
    let to = free_name(&to_dir, &name);
    fs::rename(&from, &to).map_err(|e| e.to_string())?;
    Ok(ps(&to))
}

// ---------- terminal (a real shell on a pseudo-terminal) ----------

use portable_pty::{native_pty_system, CommandBuilder, PtySize, MasterPty, Child};
use std::io::{Read, Write};
use tauri::{AppHandle, Emitter, Manager};
use base64::Engine;

struct Term {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    child: Box<dyn Child + Send + Sync>,
}

static TERMS: Mutex<Option<HashMap<String, Term>>> = Mutex::new(None);

#[derive(Serialize, Clone)]
struct TermData { id: String, data: String }

/// The user's shell: $SHELL on Linux/macOS, PowerShell (or cmd) on Windows.
fn default_shell() -> Option<String> {
    #[cfg(windows)]
    {
        for c in ["pwsh.exe", "powershell.exe"] {
            if std::process::Command::new("where").arg(c).output().map(|o| o.status.success()).unwrap_or(false) { return Some(c.into()); }
        }
        return std::env::var("COMSPEC").ok();
    }
    #[cfg(not(windows))]
    std::env::var("SHELL").ok()
}

/// Starts the user's shell (or `shell`) in `cwd`; output arrives as `term-data` events.
#[tauri::command]
fn term_spawn(app: AppHandle, id: String, cwd: String, cols: u16, rows: u16, shell: Option<String>) -> Result<(), String> {
    let pty = native_pty_system();
    let pair = pty.openpty(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 }).map_err(|e| e.to_string())?;
    let sh = shell.filter(|s| !s.is_empty()).or_else(default_shell).unwrap_or_else(|| "/bin/sh".into());
    let mut cmd = CommandBuilder::new(&sh);
    if Path::new(&cwd).is_dir() { cmd.cwd(&cwd); } else if let Some(h) = dirs::home_dir() { cmd.cwd(h); }
    // Don't hand the shell variables from whatever started Scribblr: e.g.
    // when it was launched from inside a Claude Code session, its
    // CLAUDE_CODE_* markers would make every `claude` in here a child session.
    for (k, _) in std::env::vars() {
        if k.starts_with("CLAUDE") || k == "CLAUDECODE" || k.starts_with("VITE_") || k.starts_with("TAURI_") || k == "npm_config_prefix" {
            cmd.env_remove(&k);
        }
    }
    cmd.env("TERM", "xterm-256color");
    cmd.env("COLORTERM", "truecolor");
    cmd.env("TERM_PROGRAM", "scribblr");
    let child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;
    drop(pair.slave);
    let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
    let writer = pair.master.take_writer().map_err(|e| e.to_string())?;
    let tid = id.clone();
    std::thread::spawn(move || {
        let mut buf = [0u8; 16384];
        loop {
            match reader.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    let data = base64::engine::general_purpose::STANDARD.encode(&buf[..n]);
                    let _ = app.emit("term-data", TermData { id: tid.clone(), data });
                }
            }
        }
        let _ = app.emit("term-exit", TermData { id: tid.clone(), data: String::new() });
    });
    TERMS.lock().unwrap().get_or_insert_with(HashMap::new).insert(id, Term { master: pair.master, writer, child });
    Ok(())
}

#[tauri::command]
fn term_write(id: String, data: String) -> Result<(), String> {
    let mut g = TERMS.lock().unwrap();
    let t = g.as_mut().and_then(|m| m.get_mut(&id)).ok_or("no terminal")?;
    t.writer.write_all(data.as_bytes()).map_err(|e| e.to_string())?;
    t.writer.flush().map_err(|e| e.to_string())
}

#[tauri::command]
fn term_resize(id: String, cols: u16, rows: u16) -> Result<(), String> {
    let g = TERMS.lock().unwrap();
    let t = g.as_ref().and_then(|m| m.get(&id)).ok_or("no terminal")?;
    t.master.resize(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 }).map_err(|e| e.to_string())
}

#[tauri::command]
fn term_kill(id: String) {
    if let Some(mut t) = TERMS.lock().unwrap().as_mut().and_then(|m| m.remove(&id)) {
        let _ = t.child.kill();
    }
}

/// The shell's current folder (for pane headers), via /proc on Linux.
#[tauri::command]
fn term_cwd(id: String) -> Option<String> {
    let g = TERMS.lock().unwrap();
    let t = g.as_ref()?.get(&id)?;
    #[cfg(target_os = "linux")]
    {
        let pid = t.master.process_group_leader().or_else(|| t.child.process_id().map(|p| p as i32))?;
        fs::read_link(format!("/proc/{pid}/cwd")).ok().map(|p| ps(&p))
    }
    #[cfg(not(target_os = "linux"))]
    { let _ = t; None }
}

/// kitty.conf (with its includes) as settings, so the terminal looks like kitty.
#[tauri::command]
fn kitty_config() -> HashMap<String, String> {
    fn load(path: &Path, out: &mut HashMap<String, String>, depth: u8) {
        if depth > 5 { return; }
        let Ok(text) = fs::read_to_string(path) else { return };
        let base = path.parent().map(|p| p.to_path_buf()).unwrap_or_default();
        for line in text.lines() {
            let line = line.trim();
            if line.is_empty() || line.starts_with('#') { continue; }
            let (k, v) = line.split_once(char::is_whitespace).unwrap_or((line, ""));
            let v = v.trim();
            if k == "include" || k == "globinclude" {
                let p = if let Some(rest) = v.strip_prefix("~/") { dirs::home_dir().unwrap_or_default().join(rest) } else { base.join(v) };
                load(&p, out, depth + 1);
            } else if k == "map" {
                let n = out.keys().filter(|x| x.starts_with("map ")).count();
                out.insert(format!("map {n}"), v.to_string());
            } else {
                out.insert(k.to_string(), v.to_string());
            }
        }
    }
    let mut out = HashMap::new();
    if let Some(c) = dirs::config_dir() { load(&c.join("kitty/kitty.conf"), &mut out, 0); }
    out
}


// ---------- web apps (a real browser view per pane) ----------
// Each web pane is a WebKitGTK view placed over its pane. The app's own
// webview sits in a GtkOverlay; above it a GtkFixed layer holds the web
// views at the panes' positions (Tauri can't position extra webviews on
// Linux, so this is done with GTK directly). Logins are kept per space:
// each space gets its own browser data folder and cookie store.

#[derive(Serialize, Clone)]
struct WebEvent { label: String, url: String, title: String }
#[derive(Serialize, Clone)]
struct WebLoad { label: String, loading: bool, progress: f64, zoom: f64 }
#[derive(Serialize, Clone)]
struct WebKey { label: String, action: String }

#[cfg(target_os = "linux")]
mod web {
    use super::*;
    use gtk::prelude::*;
    use std::cell::RefCell;
    use webkit2gtk::{CookieManagerExt, CookiePersistentStorage, LoadEvent, SettingsExt, WebContext, WebView, WebViewExt, WebsiteDataManager, WebsiteDataManagerExt};

    thread_local! {
        pub static LAYER: RefCell<Option<gtk::Fixed>> = const { RefCell::new(None) };
        static VIEWS: RefCell<HashMap<String, WebView>> = RefCell::new(HashMap::new());
        static CONTEXTS: RefCell<HashMap<String, WebContext>> = RefCell::new(HashMap::new());
    }

    /// Puts the app's webview in an overlay with a layer for web views on top.
    pub fn install(window: &tauri::WebviewWindow) {
        let Ok(vbox) = window.default_vbox() else { return };
        let Some(main) = vbox.children().into_iter().find(|w| w.is::<webkit2gtk::WebView>()) else { return };
        vbox.remove(&main);
        let overlay = gtk::Overlay::new();
        overlay.add(&main);
        let fixed = gtk::Fixed::new();
        overlay.add_overlay(&fixed);
        overlay.set_overlay_pass_through(&fixed, true);
        vbox.pack_start(&overlay, true, true, 0);
        overlay.show_all();
        LAYER.with(|l| *l.borrow_mut() = Some(fixed));
    }

    fn context(space: &str) -> WebContext {
        CONTEXTS.with(|c| {
            c.borrow_mut().entry(space.to_string()).or_insert_with(|| {
                let safe: String = space.chars().map(|c| if c.is_ascii_alphanumeric() { c } else { '_' }).collect();
                let base = dirs::data_dir().unwrap_or_else(|| PathBuf::from(".")).join("scribblr/web").join(if safe.is_empty() { "default".into() } else { safe });
                let _ = fs::create_dir_all(&base);
                let data = ps(&base);
                let cache = ps(&base.join("cache"));
                let manager = WebsiteDataManager::builder().base_data_directory(data.as_str()).base_cache_directory(cache.as_str()).build();
                if let Some(cookies) = manager.cookie_manager() {
                    cookies.set_persistent_storage(&ps(&base.join("cookies.sqlite")), CookiePersistentStorage::Sqlite);
                }
                WebContext::with_website_data_manager(&manager)
            }).clone()
        })
    }


    // A normal desktop browser's identity: some sign-in pages (Google's)
    // refuse browsers they don't recognise.
    const UA: &str = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15";

    fn tune(settings: &webkit2gtk::Settings) {
        settings.set_enable_developer_extras(false);
        settings.set_javascript_can_access_clipboard(true);
        settings.set_javascript_can_open_windows_automatically(true);
        settings.set_enable_smooth_scrolling(true);
        settings.set_user_agent(Some(UA));
    }

    /// A pop-up window for the page `opener` (shares its login session).
    fn popup(opener: &WebView) -> WebView {
        let view: WebView = WebView::builder().related_view(opener).build();
        if let Some(settings) = WebViewExt::settings(&view) { tune(&settings); }
        let win = gtk::Window::new(gtk::WindowType::Toplevel);
        win.set_title("Sign in");
        win.set_default_size(520, 720);
        if let Some(top) = opener.toplevel().and_then(|t| t.downcast::<gtk::Window>().ok()) {
            win.set_transient_for(Some(&top));
        }
        win.set_position(gtk::WindowPosition::CenterOnParent);
        win.add(&view);
        let w1 = win.clone();
        view.connect_ready_to_show(move |_| w1.show_all());
        let w2 = win.clone();
        view.connect_close(move |_| unsafe { w2.destroy() });
        view.connect_title_notify({
            let w3 = win.clone();
            move |v| if let Some(t) = v.title() { w3.set_title(&t); }
        });
        // Its own pop-ups (rare) get windows too.
        view.connect_create(|v, _| Some(popup(v).upcast()));
        view
    }

    fn place(fixed: &gtk::Fixed, view: &WebView, x: f64, y: f64, w: f64, h: f64) {
        fixed.move_(view, x as i32, y as i32);
        view.set_size_request((w as i32).max(1), (h as i32).max(1));
    }

    pub fn open(app: AppHandle, label: String, url: String, space: String, x: f64, y: f64, w: f64, h: f64) -> Result<(), String> {
        if !(url.starts_with("https://") || url.starts_with("http://")) {
            return Err("Web panes only open http(s) pages".into());
        }
        let fixed = LAYER.with(|l| l.borrow().clone()).ok_or("web layer missing")?;
        if let Some(v) = VIEWS.with(|m| m.borrow().get(&label).cloned()) {
            place(&fixed, &v, x, y, w, h);
            v.show();
            return Ok(());
        }
        let ctx = context(&space);
        let view = WebView::with_context(&ctx);
        if let Some(settings) = WebViewExt::settings(&view) { tune(&settings); }
        let (a1, l1) = (app.clone(), label.clone());
        view.connect_load_changed(move |v, ev| {
            if ev == LoadEvent::Committed || ev == LoadEvent::Finished {
                let url = v.uri().map(|u| u.to_string()).unwrap_or_default();
                let title = v.title().map(|t| t.to_string()).unwrap_or_default();
                let _ = a1.emit("web-event", WebEvent { label: l1.clone(), url, title });
            }
        });
        // Loading progress, for the toolbar's spinner and progress bar.
        let (a3, l3) = (app.clone(), label.clone());
        view.connect_estimated_load_progress_notify(move |v| {
            let _ = a3.emit("web-load", WebLoad { label: l3.clone(), loading: v.is_loading(), progress: v.estimated_load_progress(), zoom: v.zoom_level() });
        });
        let (a4, l4) = (app.clone(), label.clone());
        view.connect_is_loading_notify(move |v| {
            let _ = a4.emit("web-load", WebLoad { label: l4.clone(), loading: v.is_loading(), progress: v.estimated_load_progress(), zoom: v.zoom_level() });
        });
        // Keys pressed inside the page: zoom (Ctrl +/-/0) is done here; the
        // ultra / focus keys (F11, Ctrl+Shift+F) go to the app.
        let (a5, l5) = (app.clone(), label.clone());
        view.connect_key_press_event(move |v, ev| {
            use gtk::gdk::{keys::constants as k, ModifierType};
            let st = ev.state();
            let ctrl = st.contains(ModifierType::CONTROL_MASK);
            let shift = st.contains(ModifierType::SHIFT_MASK);
            let key = ev.keyval();
            let zoom = |z: f64| {
                let z = (z.clamp(0.3, 3.0) * 10.0).round() / 10.0;
                v.set_zoom_level(z);
                let _ = a5.emit("web-load", WebLoad { label: l5.clone(), loading: v.is_loading(), progress: v.estimated_load_progress(), zoom: z });
            };
            if ctrl && !shift && (key == k::plus || key == k::equal || key == k::KP_Add) { zoom(v.zoom_level() + 0.1); return gtk::glib::Propagation::Stop; }
            if ctrl && (key == k::minus || key == k::KP_Subtract || key == k::underscore) { zoom(v.zoom_level() - 0.1); return gtk::glib::Propagation::Stop; }
            if ctrl && (key == k::_0 || key == k::KP_0) { zoom(1.0); return gtk::glib::Propagation::Stop; }
            let action = if key == k::F11 { Some("ultra") }
                else if ctrl && shift && (key == k::F || key == k::f) { Some("full") }
                else if key == k::Escape { Some("escape") }
                else { None };
            if let Some(a) = action {
                let _ = a5.emit("web-key", WebKey { label: l5.clone(), action: a.into() });
                if a != "escape" { return gtk::glib::Propagation::Stop; }
            }
            gtk::glib::Propagation::Proceed
        });
        let (a2, l2) = (app.clone(), label.clone());
        view.connect_title_notify(move |v| {
            let url = v.uri().map(|u| u.to_string()).unwrap_or_default();
            let title = v.title().map(|t| t.to_string()).unwrap_or_default();
            let _ = a2.emit("web-event", WebEvent { label: l2.clone(), url, title });
        });
        // Pop-ups: sign-in windows ("Continue with Google", OAuth...) need a
        // real window that stays linked to the page that opened it, so the
        // login can report back. Plain links that open a new tab load here.
        view.connect_create(|v, action| {
            let user_gesture_link = action.navigation_type() == webkit2gtk::NavigationType::LinkClicked;
            if user_gesture_link {
                if let Some(mut req) = action.request() { if let Some(u) = webkit2gtk::URIRequestExt::uri(&mut req) { v.load_uri(&u); } }
                return None;
            }
            Some(popup(v).upcast())
        });
        fixed.put(&view, x as i32, y as i32);
        view.set_size_request((w as i32).max(1), (h as i32).max(1));
        view.load_uri(&url);
        view.show();
        VIEWS.with(|m| m.borrow_mut().insert(label, view));
        Ok(())
    }

    pub fn bounds(label: String, x: f64, y: f64, w: f64, h: f64, visible: bool) {
        let Some(fixed) = LAYER.with(|l| l.borrow().clone()) else { return };
        if let Some(v) = VIEWS.with(|m| m.borrow().get(&label).cloned()) {
            if visible { place(&fixed, &v, x, y, w, h); v.show(); } else { v.hide(); }
        }
    }

    pub fn nav(label: String, action: String, url: Option<String>) {
        if let Some(v) = VIEWS.with(|m| m.borrow().get(&label).cloned()) {
            match action.as_str() {
                "back" => v.go_back(),
                "forward" => v.go_forward(),
                "reload" => v.reload(),
                "stop" => v.stop_loading(),
                "zoom-in" => v.set_zoom_level(((v.zoom_level() + 0.1).min(3.0) * 10.0).round() / 10.0),
                "zoom-out" => v.set_zoom_level(((v.zoom_level() - 0.1).max(0.3) * 10.0).round() / 10.0),
                "zoom-reset" => v.set_zoom_level(1.0),
                "focus" => v.grab_focus(),
                "go" => if let Some(u) = url { if u.starts_with("https://") || u.starts_with("http://") { v.load_uri(&u) } },
                _ => {}
            }
        }
    }

    pub fn zoom_of(label: &str) -> f64 {
        VIEWS.with(|m| m.borrow().get(label).map(|v| v.zoom_level())).unwrap_or(1.0)
    }

    pub fn close(label: String) {
        let Some(fixed) = LAYER.with(|l| l.borrow().clone()) else { return };
        if let Some(v) = VIEWS.with(|m| m.borrow_mut().remove(&label)) {
            fixed.remove(&v);
        }
    }
}

// Windows / macOS: each web pane is an extra Tauri webview over the window
// (multi-webview API), with its own data folder per space. Keys pressed in
// the page (F11, Ctrl+Shift+F, Esc) come back through a tiny script that
// navigates to scribblr-key://… which is caught and turned into an event.
#[cfg(not(target_os = "linux"))]
mod web {
    use super::*;
    use tauri::{LogicalPosition, LogicalSize, Manager, WebviewBuilder, WebviewUrl};
    static ZOOM: Mutex<Option<HashMap<String, f64>>> = Mutex::new(None);

    const KEYS: &str = r#"addEventListener('keydown', e => {
      const k = e.key === 'F11' ? 'ultra' : (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'f') ? 'full' : e.key === 'Escape' ? 'escape' : null;
      if (!k) return;
      if (k !== 'escape') e.preventDefault();
      try { location.assign('scribblr-key://' + k); } catch (_) {}
    }, true);"#;

    fn data_dir(space: &str) -> PathBuf {
        let safe: String = space.chars().map(|c| if c.is_ascii_alphanumeric() { c } else { '_' }).collect();
        let d = dirs::data_dir().unwrap_or_else(|| PathBuf::from(".")).join("scribblr/web").join(if safe.is_empty() { "default".into() } else { safe });
        let _ = fs::create_dir_all(&d);
        d
    }

    pub fn open(app: AppHandle, label: String, url: String, space: String, x: f64, y: f64, w: f64, h: f64) -> Result<(), String> {
        if !(url.starts_with("https://") || url.starts_with("http://")) { return Err("Web panes only open http(s) pages".into()); }
        if let Some(wv) = app.get_webview(&label) {
            wv.set_position(LogicalPosition::new(x, y)).map_err(|e| e.to_string())?;
            wv.set_size(LogicalSize::new(w.max(1.0), h.max(1.0))).map_err(|e| e.to_string())?;
            return wv.show().map_err(|e| e.to_string());
        }
        let window = app.get_window("main").ok_or("no main window")?;
        let target: tauri::Url = url.parse().map_err(|e: url::ParseError| e.to_string())?;
        let (a1, a2, a3, l1, l2, l3) = (app.clone(), app.clone(), app.clone(), label.clone(), label.clone(), label.clone());
        let builder = WebviewBuilder::new(&label, WebviewUrl::External(target))
            .data_directory(data_dir(&space))
            .initialization_script(KEYS)
            .on_navigation(move |u| {
                if u.scheme() == "scribblr-key" {
                    let _ = a3.emit("web-key", WebKey { label: l3.clone(), action: u.host_str().unwrap_or("").to_string() });
                    return false;
                }
                u.scheme() == "https" || u.scheme() == "http" || u.scheme() == "about" || u.scheme() == "blob" || u.scheme() == "data"
            })
            .on_page_load(move |wv, p| {
                let loading = matches!(p.event(), tauri::webview::PageLoadEvent::Started);
                let zoom = ZOOM.lock().unwrap().as_ref().and_then(|m| m.get(&l1).copied()).unwrap_or(1.0);
                let title = wv.url().map(|u| u.host_str().unwrap_or("").to_string()).unwrap_or_default();
                let _ = a1.emit("web-load", WebLoad { label: l1.clone(), loading, progress: if loading { 0.2 } else { 1.0 }, zoom });
                let _ = a1.emit("web-event", WebEvent { label: l1.clone(), url: p.url().to_string(), title });
            })
            .on_document_title_changed(move |wv, title| {
                let url = wv.url().map(|u| u.to_string()).unwrap_or_default();
                let _ = a2.emit("web-event", WebEvent { label: l2.clone(), url, title });
            });
        window.add_child(builder, LogicalPosition::new(x, y), LogicalSize::new(w.max(1.0), h.max(1.0))).map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn bounds(app: &AppHandle, label: String, x: f64, y: f64, w: f64, h: f64, visible: bool) {
        let Some(wv) = app.get_webview(&label) else { return };
        if !visible { let _ = wv.hide(); return; }
        let _ = wv.set_position(LogicalPosition::new(x, y));
        let _ = wv.set_size(LogicalSize::new(w.max(1.0), h.max(1.0)));
        let _ = wv.show();
    }

    pub fn nav(app: &AppHandle, label: String, action: String, url: Option<String>) {
        let Some(wv) = app.get_webview(&label) else { return };
        let mut zoom = |d: Option<f64>| {
            let mut g = ZOOM.lock().unwrap();
            let m = g.get_or_insert_with(HashMap::new);
            let z = d.map(|d| ((m.get(&label).copied().unwrap_or(1.0) + d).clamp(0.3, 3.0) * 10.0).round() / 10.0).unwrap_or(1.0);
            m.insert(label.clone(), z);
            let _ = wv.set_zoom(z);
        };
        match action.as_str() {
            "back" => { let _ = wv.eval("history.back()"); }
            "forward" => { let _ = wv.eval("history.forward()"); }
            "reload" => { let _ = wv.reload(); }
            "stop" => { let _ = wv.eval("window.stop()"); }
            "zoom-in" => zoom(Some(0.1)),
            "zoom-out" => zoom(Some(-0.1)),
            "zoom-reset" => zoom(None),
            "focus" => { let _ = wv.set_focus(); }
            "go" => if let Some(u) = url.filter(|u| u.starts_with("https://") || u.starts_with("http://")) {
                if let Ok(u) = u.parse() { let _ = wv.navigate(u); }
            },
            _ => {}
        }
    }

    pub fn zoom_of(label: &str) -> f64 {
        ZOOM.lock().unwrap().as_ref().and_then(|m| m.get(label).copied()).unwrap_or(1.0)
    }

    pub fn close(app: &AppHandle, label: String) {
        if let Some(wv) = app.get_webview(&label) { let _ = wv.close(); }
    }
}

// Linux: sync commands run on the main (GTK) thread, which WebKitGTK needs.
#[tauri::command]
fn web_open(app: AppHandle, label: String, url: String, space: String, x: f64, y: f64, w: f64, h: f64) -> Result<(), String> {
    web::open(app, label, url, space, x, y, w, h)
}

#[tauri::command]
fn web_bounds(app: AppHandle, label: String, x: f64, y: f64, w: f64, h: f64, visible: bool) {
    #[cfg(target_os = "linux")]
    { let _ = app; web::bounds(label, x, y, w, h, visible); }
    #[cfg(not(target_os = "linux"))]
    web::bounds(&app, label, x, y, w, h, visible);
}

#[tauri::command]
fn web_nav(app: AppHandle, label: String, action: String, url: Option<String>) -> f64 {
    #[cfg(target_os = "linux")]
    { let _ = app; web::nav(label.clone(), action, url); }
    #[cfg(not(target_os = "linux"))]
    web::nav(&app, label.clone(), action, url);
    web::zoom_of(&label)
}

#[tauri::command]
fn web_close(app: AppHandle, label: String) {
    #[cfg(target_os = "linux")]
    { let _ = app; web::close(label); }
    #[cfg(not(target_os = "linux"))]
    web::close(&app, label);
}

// ---------- AppImage: add to the apps menu ----------
// .deb / .rpm install a launcher themselves; an AppImage is a single file, so
// on first run Scribblr offers (once) to add a launcher and icon to
// ~/.local/share. $APPIMAGE is set by the AppImage runtime.

const ICON_PNG: &[u8] = include_bytes!("../icons/128x128@2x.png");

#[derive(Serialize)]
struct AppImageStatus { is_appimage: bool, integrated: bool, dismissed: bool }

fn launcher_path(data: &Path) -> PathBuf { data.join("applications/scribblr-appimage.desktop") }

fn desktop_entry(appimage: &str, icon: &Path) -> String {
    format!("[Desktop Entry]\nType=Application\nName=Scribblr\nComment=Drawings, notes, terminals and calendars in one tiled workspace\nExec=\"{appimage}\" %U\nIcon={}\nCategories=Office;Graphics;Development;\nStartupWMClass=scribblr\nTerminal=false\n", icon.display())
}

fn integrate_into(data: &Path, appimage: &str) -> Result<(), String> {
    let icon = data.join("icons/hicolor/256x256/apps/scribblr.png");
    fs::create_dir_all(icon.parent().unwrap()).map_err(|e| e.to_string())?;
    fs::write(&icon, ICON_PNG).map_err(|e| e.to_string())?;
    let launcher = launcher_path(data);
    fs::create_dir_all(launcher.parent().unwrap()).map_err(|e| e.to_string())?;
    atomic_write(&launcher, &desktop_entry(appimage, &icon))
}

#[tauri::command]
fn appimage_status() -> AppImageStatus {
    let appimage = std::env::var("APPIMAGE").ok().filter(|p| Path::new(p).is_file());
    let data = dirs::data_dir().unwrap_or_default();
    let integrated = appimage.as_ref().map(|a| {
        fs::read_to_string(launcher_path(&data)).map(|t| t.contains(a.as_str())).unwrap_or(false)
    }).unwrap_or(false);
    let dismissed = config_dir().join("appimage-dismissed").exists();
    AppImageStatus { is_appimage: appimage.is_some(), integrated, dismissed }
}

#[tauri::command]
fn appimage_integrate() -> Result<(), String> {
    let appimage = std::env::var("APPIMAGE").map_err(|_| "Not running as an AppImage")?;
    let data = dirs::data_dir().ok_or("no data folder")?;
    integrate_into(&data, &appimage)?;
    let _ = std::process::Command::new("update-desktop-database").arg(data.join("applications")).status();
    Ok(())
}

#[tauri::command]
fn appimage_dismiss() -> Result<(), String> {
    atomic_write(&config_dir().join("appimage-dismissed"), "1")
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            home_dir, read_config, write_config, user_themes, list_drawings,
            read_text, write_text, create_drawing, rename_path, trash_path, path_exists, herdr_settings, link_index, rewrite_links, save_drawing, set_links, create_item, list_dir, create_dir, create_file, duplicate_path, move_path, term_spawn, term_write, term_resize, term_kill, term_cwd, kitty_config, open_path, copy_paths, web_open, web_bounds, web_nav, web_close, appimage_status, appimage_integrate, appimage_dismiss
        ])
        .setup(|app| {
            #[cfg(target_os = "linux")]
            if let Some(w) = app.get_webview_window("main") { web::install(&w); }
            let _ = app;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Scribblr");
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp() -> PathBuf {
        let d = std::env::temp_dir().join(format!("scribblr-test-{}-{}", std::process::id(), std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));
        fs::create_dir_all(&d).unwrap();
        d
    }

    #[cfg(unix)]
    #[test]
    fn guard_blocks_outside_and_secrets() {
        assert!(guard("/etc/passwd").is_err());
        assert!(guard("relative/path").is_err());
        let home = dirs::home_dir().unwrap();
        assert!(guard(&ps(&home.join(".ssh/id_ed25519"))).is_err());
        assert!(guard(&ps(&home.join(".local/share/scribblr/web/x/cookies.sqlite"))).is_err());
        assert!(guard(&ps(&home.join("Documents/../.ssh/config"))).is_err(), "`..` can't sneak out");
        assert!(guard(&ps(&home.join("Documents/a.note"))).is_ok());
        assert!(guard("/tmp/x.excalidraw").is_ok());
        // ".." after folders that don't exist can't climb out either.
        assert!(guard(&ps(&home.join("no-such-dir/../.ssh/id_ed25519"))).is_err());
        assert!(guard(&ps(&home.join("a/b/../../../../etc/passwd"))).is_err());
    }

    #[test]
    fn names_are_plain() {
        assert!(plain_name("..").is_err());
        assert!(plain_name("  ").is_err());
        assert_eq!(plain_name("a/b").unwrap(), "a-b");
    }

    #[test]
    fn kinds_and_templates() {
        assert_eq!(kind_ext("x.note"), ".note");
        assert_eq!(kind_ext("x.excalidraw"), ".excalidraw");
        assert_eq!(kind_ext("x.txt"), "");
        for k in KINDS { assert!(serde_json::from_str::<Value>(template(k)).is_ok()); }
    }

    #[test]
    fn create_rename_link_rewrite() {
        let d = tmp();
        let f = ps(&d);
        let a = create_item(f.clone(), "Alpha".into(), ".note".into()).unwrap();
        let a2 = create_item(f.clone(), "Alpha".into(), ".note".into()).unwrap();
        assert!(a.ends_with("Alpha.note") && a2.ends_with("Alpha 2.note"));
        let b = create_item(f.clone(), "Beta".into(), ".excalidraw".into()).unwrap();
        set_links(b.clone(), vec!["Alpha".into(), "alpha".into(), " ".into()]).unwrap();
        let idx = link_index(vec![f.clone()]);
        let bl = idx.iter().find(|e| e.path == b).unwrap();
        assert_eq!(bl.links, vec!["Alpha".to_string()], "deduped, blanks dropped");
        // Saving the scene keeps the links.
        save_drawing(b.clone(), r#"{"type":"excalidraw","elements":[]}"#.into()).unwrap();
        assert_eq!(links_of(&read_json(Path::new(&b)).unwrap()), vec!["Alpha".to_string()]);
        // Rename keeps the extension; links follow.
        let renamed = rename_path(a.clone(), "Gamma".into()).unwrap();
        assert!(renamed.ends_with("Gamma.note"));
        assert_eq!(rewrite_links(vec![f.clone()], "Alpha".into(), "Gamma".into()), 1);
        assert_eq!(links_of(&read_json(Path::new(&b)).unwrap()), vec!["Gamma".to_string()]);
        fs::remove_dir_all(d).ok();
    }

    #[test]
    fn files_copy_move_trash() {
        let d = tmp();
        let f = ps(&d);
        let sub = create_dir(f.clone(), "sub".into()).unwrap();
        let t = create_file(f.clone(), "notes.txt".into()).unwrap();
        let dup = duplicate_path(t.clone()).unwrap();
        assert!(dup.ends_with("notes copy.txt"));
        let moved = move_path(dup.clone(), sub.clone()).unwrap();
        assert!(Path::new(&moved).exists() && !Path::new(&dup).exists());
        assert!(move_path(sub.clone(), format!("{sub}/inner")).is_err(), "no folder into itself");
        let copied = copy_paths(vec![t.clone()], sub.clone()).unwrap();
        assert_eq!(copied.len(), 1);
        trash_path(t.clone(), f.clone()).unwrap();
        assert!(!Path::new(&t).exists() && d.join(".trash/notes.txt").exists());
        let listed = list_dir(f.clone(), false).unwrap();
        assert!(listed.iter().all(|e| !e.name.starts_with('.')), "hidden files stay hidden");
        fs::remove_dir_all(d).ok();
    }

    #[cfg(unix)]
    #[test]
    fn open_path_refuses_programs() {
        use std::os::unix::fs::PermissionsExt;
        let d = tmp();
        let exe = d.join("run-me");
        fs::write(&exe, "#!/bin/sh\necho hi").unwrap();
        fs::set_permissions(&exe, fs::Permissions::from_mode(0o755)).unwrap();
        assert!(open_path(ps(&exe), false).is_err());
        let desk = d.join("evil.desktop");
        fs::write(&desk, "[Desktop Entry]").unwrap();
        assert!(open_path(ps(&desk), false).is_err());
        fs::remove_dir_all(d).ok();
    }

    #[test]
    fn appimage_launcher_is_written() {
        let d = tmp();
        integrate_into(&d, "/home/me/Apps/Scribblr.AppImage").unwrap();
        let entry = fs::read_to_string(d.join("applications/scribblr-appimage.desktop")).unwrap();
        assert!(entry.contains("Exec=\"/home/me/Apps/Scribblr.AppImage\" %U"));
        assert!(entry.contains("Name=Scribblr") && entry.contains("StartupWMClass=scribblr"));
        assert!(d.join("icons/hicolor/256x256/apps/scribblr.png").metadata().unwrap().len() > 1000);
        fs::remove_dir_all(d).ok();
    }

    #[test]
    fn config_names_cannot_escape() {
        assert!(read_config("../../etc/passwd".into()).is_none());
        assert!(write_config("../x".into(), "{}".into()).is_err());
    }
}
