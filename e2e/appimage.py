#!/usr/bin/env python3
"""AppImage check: on first run the "Add to your apps menu?" banner shows,
and "Add" writes a launcher + icon into ~/.local/share (throw-away HOME)."""
import glob, os, shutil, subprocess, sys, tempfile, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import run as e  # reuse the WebDriver helpers

app = sorted(glob.glob(os.path.join(e.ROOT, "src-tauri/target/release/bundle/appimage/*.AppImage")))[-1]
home = tempfile.mkdtemp(prefix="scribblr-appimage-")
env = {k: v for k, v in os.environ.items() if not k.startswith("CLAUDE")}
env.update(HOME=home, XDG_CONFIG_HOME=f"{home}/.config", XDG_DATA_HOME=f"{home}/.local/share")
drv = subprocess.Popen([e.DRIVER, "--port", str(e.PORT)], env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1.5)
ok = True
try:
    sid = e.req("POST", "/session", {"capabilities": {"alwaysMatch": {"tauri:options": {"application": app}}}})["sessionId"]
    s = e.S(sid)
    shown = s.wait(".install-banner", 20)
    print("banner shown on first AppImage run:", shown); ok &= shown
    s.click(".install-banner .solid-btn")
    time.sleep(1.5)
    launcher = f"{home}/.local/share/applications/scribblr-appimage.desktop"
    made = os.path.exists(launcher) and app in open(launcher).read()
    print("launcher written with the AppImage path:", made); ok &= made
    icon = os.path.exists(f"{home}/.local/share/icons/hicolor/256x256/apps/scribblr.png")
    print("icon installed:", icon); ok &= icon
    e.req("DELETE", f"/session/{sid}")
finally:
    drv.terminate(); shutil.rmtree(home, ignore_errors=True)
sys.exit(0 if ok else 1)
