#!/usr/bin/env python3
"""Scribblr end-to-end test: drives the real app (release build) through
WebDriver (tauri-driver + WebKitWebDriver) with a throw-away HOME, so your own
spaces and files are never touched. Checks every app, the file system, links,
and the security rules. Run: python3 -I e2e/run.py
"""
import json, os, shutil, subprocess, sys, tempfile, threading, time, urllib.request, urllib.error
from http.server import BaseHTTPRequestHandler, HTTPServer

# A hostile web page for the web-pane test: it tries every way into the app.
PROBE = b"""<!doctype html><script>
const r = {};
r.tauri = typeof window.__TAURI_INTERNALS__ + "/" + typeof window.__TAURI__ + "/" + typeof window.ipc;
fetch("http://ipc.localhost/read_text", { method: "POST", body: JSON.stringify({ path: "/etc/passwd" }) })
  .then(x => x.text()).then(t => { r.ipc = "OPEN:" + t.slice(0, 40); }, e => { r.ipc = "blocked"; })
  .finally(() => {
    try { r.parent = typeof window.parent.__TAURI_INTERNALS__; } catch (e) { r.parent = "blocked"; }
    location.href = "/result?" + encodeURIComponent(JSON.stringify(r));
  });
</script>"""
probe_result = {}

class Probe(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path.startswith("/result?"):
            probe_result["v"] = json.loads(urllib.parse.unquote(self.path[8:]))
        self.send_response(200); self.send_header("Content-Type", "text/html"); self.end_headers()
        self.wfile.write(PROBE if self.path == "/probe.html" else b"ok")
    def log_message(self, *a): pass
import urllib.parse

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
APP = os.path.join(ROOT, "src-tauri/target/release/scribblr")
DRIVER = os.path.expanduser("~/.cargo/bin/tauri-driver")
PORT = 4444
results = []

def req(method, path, body=None):
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(f"http://127.0.0.1:{PORT}{path}", data=data, method=method, headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(r, timeout=60) as resp:
            return json.loads(resp.read() or b"{}").get("value")
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"{method} {path}: {e.read().decode()[:300]}")

class S:
    def __init__(self, sid): self.sid = sid
    def js(self, script, *args): return req("POST", f"/session/{self.sid}/execute/sync", {"script": script, "args": list(args)})
    def ajs(self, script, *args): return req("POST", f"/session/{self.sid}/execute/async", {"script": script, "args": list(args)})
    def find(self, css):
        v = req("POST", f"/session/{self.sid}/elements", {"using": "css selector", "value": css})
        return [list(e.values())[0] for e in v]
    def click(self, css, i=0): req("POST", f"/session/{self.sid}/element/{self.find(css)[i]}/click", {})
    def type(self, css, text, i=0): req("POST", f"/session/{self.sid}/element/{self.find(css)[i]}/value", {"text": text})
    def wait(self, css, t=15):
        end = time.time() + t
        while time.time() < end:
            if self.find(css): return True
            time.sleep(0.25)
        return False
    def shot(self, name):
        import base64
        png = req("GET", f"/session/{self.sid}/screenshot")
        open(os.path.join(ROOT, "e2e", f"{name}.png"), "wb").write(base64.b64decode(png))

def check(name, ok, detail=""):
    results.append((name, bool(ok), detail))
    print(("PASS " if ok else "FAIL ") + name + (f"  ({detail})" if detail else ""), flush=True)

# The app's own IPC, called from inside the page (what a bug or injected
# script in the app could do).
INVOKE = """const [cmd, args, done] = arguments;
window.__TAURI_INTERNALS__.invoke(cmd, args).then(v => done({ok: true, v}), e => done({ok: false, e: String(e)}));"""

def main():
    home = tempfile.mkdtemp(prefix="scribblr-e2e-")
    env = dict(os.environ, HOME=home, XDG_CONFIG_HOME=f"{home}/.config", XDG_DATA_HOME=f"{home}/.local/share", XDG_CACHE_HOME=f"{home}/.cache")
    env = {k: v for k, v in env.items() if not k.startswith("CLAUDE")}
    env["CLAUDE_CODE_E2E_MARKER"] = "leaked"  # the terminal must not pass this on
    os.makedirs(f"{home}/.ssh"); open(f"{home}/.ssh/id_test", "w").write("SECRET")
    drv = subprocess.Popen([DRIVER, "--port", str(PORT)], env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(1.5)
    sid = None
    try:
        sid = req("POST", "/session", {"capabilities": {"alwaysMatch": {"tauri:options": {"application": APP}}}})["sessionId"]
        s = S(sid)
        check("app starts and shows its window", s.wait(".window", 20))
        s.js("window.__csp = []; document.addEventListener('securitypolicyviolation', e => window.__csp.push(e.violatedDirective + ' ' + e.blockedURI));")
        check("first start makes a space", s.wait(".space-row", 10) and "Scribblr" in s.js("return document.querySelector('.space-row').innerText"))
        space = f"{home}/Scribblr"

        # --- apps from the + menu (each in a new tab) ---
        def plus(label):
            s.click(".tabs-bar .icon-btn[title='New…']")
            s.wait(".new-menu")
            items = s.find(".new-menu .split-item")
            names = [s.js("return arguments[0].innerText", {"element-6066-11e4-a52e-4f735466cecf": i}) for i in items]
            idx = next(i for i, n in enumerate(names) if n.startswith(label))
            req("POST", f"/session/{sid}/element/{items[idx]}/click", {})
        plus("Drawing")
        check("drawing opens (Excalidraw canvas)", s.wait(".pane .excalidraw", 15))
        time.sleep(1)
        check("drawing file is created on disk", any(f.endswith(".excalidraw") for f in os.listdir(space)))
        plus("Note")
        check("note opens (block editor)", s.wait(".bn-editor", 15))
        ed = s.find(".bn-editor [contenteditable='true'], .bn-editor[contenteditable='true']")
        if ed:
            req("POST", f"/session/{sid}/element/{ed[0]}/value", {"text": "Hello from the e2e test"})
            time.sleep(1.5)
        notes = [f for f in os.listdir(space) if f.endswith(".note")]
        saved = notes and "Hello from the e2e test" in open(os.path.join(space, notes[0])).read()
        check("note text is saved to its .note file", saved)
        plus("Terminal")
        check("terminal opens", s.wait(".terminal-pane .xterm", 15))
        time.sleep(1.5)
        s.type(".panes:not(.hidden-tab) .terminal-pane .xterm-helper-textarea", "echo E2E-$((40+2)) M=${CLAUDE_CODE_E2E_MARKER:-clean}\n")
        time.sleep(2)
        buf = s.js("return window.__scribblrTerminalText()")
        check("terminal runs a real shell", "E2E-42" in buf, [l for l in buf.splitlines() if l.strip()][-1][:60] if buf.strip() else "empty")
        check("SECURITY: terminal shells don't inherit CLAUDE_* variables", "M=clean" in buf)
        plus("Calendar")
        check("calendar opens (month + day)", s.wait(".ncal .nc-mini", 15))
        s.click(".nc-new-main")
        check("New makes a page and opens it", s.wait(".note-title-input", 10))
        s.type(".note-title-input", "Exam revision")
        time.sleep(1)
        cal = [f for f in os.listdir(space) if f.endswith(".calendar")]
        check("calendar page is saved", cal and "Exam revision" in open(os.path.join(space, cal[0])).read())
        check("calendar pages live in hidden .scribblr/", os.path.isdir(f"{space}/.scribblr/pages"))
        plus("Graph")
        check("graph opens", s.wait(".graph-view canvas", 10))
        plus("Files")
        check("files app opens", s.wait(".fm .fm-main", 10))
        check("files app uses VS Code icons", s.wait(".fm img.file-icon", 5))
        s.shot("e2e-files")

        # --- tiling, focus mode, tabs ---
        n_before = len(s.find(".pane"))
        s.click(".panes:not(.hidden-tab) .pane-head .ph-btn[title='Split right']")
        check("split right adds a pane", s.wait(".panes:not(.hidden-tab) .split", 5))
        s.click(".panes:not(.hidden-tab) .pane-head .ph-btn[title^='Focus mode']")
        check("focus mode hides sidebar and bars", s.js("return getComputedStyle(document.querySelector('.sidebar')).display") == "none")
        s.js("document.dispatchEvent(new KeyboardEvent('keydown', {}))")
        s.click(".panes:not(.hidden-tab) .pane-full .ph-btn[title^='Exit focus']")
        check("focus mode turns off", s.js("return getComputedStyle(document.querySelector('.sidebar')).display") != "none")

        # --- links ---
        files = sorted(os.listdir(space))
        drawing = os.path.join(space, next(f for f in files if f.endswith(".excalidraw")))
        r = s.ajs(INVOKE, "set_links", {"path": drawing, "links": ["Exam plan"]})
        check("links are stored as drawing metadata", r["ok"] and json.load(open(drawing))["scribblr"]["links"] == ["Exam plan"])

        # --- security: what the app's own page may and may not do ---
        r = s.ajs(INVOKE, "read_text", {"path": "/etc/passwd"})
        check("SECURITY: can't read files outside home (/etc/passwd)", not r["ok"], r.get("e", "")[:60])
        r = s.ajs(INVOKE, "read_text", {"path": f"{home}/.ssh/id_test"})
        check("SECURITY: can't read ~/.ssh", not r["ok"], r.get("e", "")[:60])
        r = s.ajs(INVOKE, "read_text", {"path": f"{space}/../.ssh/id_test"})
        check("SECURITY: '..' can't sneak into ~/.ssh", not r["ok"])
        r = s.ajs(INVOKE, "write_text", {"path": "/tmp/../etc/scribblr-pwned", "content": "x"})
        check("SECURITY: can't write outside home", not r["ok"])
        r = s.ajs(INVOKE, "read_config", {"name": "../../.ssh/id_test"})
        check("SECURITY: config names can't escape", r["ok"] and r["v"] is None)
        exe = f"{space}/run-me.sh"; open(exe, "w").write("#!/bin/sh\ntouch /tmp/scribblr-e2e-ran\n"); os.chmod(exe, 0o755)
        r = s.ajs(INVOKE, "open_path", {"path": exe, "reveal": False})
        check("SECURITY: clicking a program never runs it", not r["ok"] and not os.path.exists("/tmp/scribblr-e2e-ran"))
        r = s.ajs(INVOKE, "web_open", {"label": "web-x", "url": "javascript:alert(1)", "space": "s", "x": 0, "y": 0, "w": 10, "h": 10})
        check("SECURITY: web panes refuse non-http(s) addresses", not r["ok"])
        r = s.ajs(INVOKE, "web_open", {"label": "web-y", "url": "file:///etc/passwd", "space": "s", "x": 0, "y": 0, "w": 10, "h": 10})
        check("SECURITY: web panes refuse file:// addresses", not r["ok"])
        # A web page in a web pane must not reach the app.
        srv = HTTPServer(("127.0.0.1", 0), Probe)
        threading.Thread(target=srv.serve_forever, daemon=True).start()
        r = s.ajs(INVOKE, "web_open", {"label": "web-probe", "url": f"http://127.0.0.1:{srv.server_port}/probe.html", "space": "e2e", "x": 0, "y": 0, "w": 400, "h": 300})
        end = time.time() + 15
        while "v" not in probe_result and time.time() < end: time.sleep(0.25)
        pr = probe_result.get("v", {})
        check("web pane loads real pages", r["ok"] and bool(pr), str(pr)[:80])
        check("SECURITY: web pages get no Scribblr API (no __TAURI__)", pr.get("tauri") == "undefined/undefined/undefined", pr.get("tauri"))
        check("SECURITY: web pages can't call the app's IPC", pr.get("ipc") == "blocked", pr.get("ipc"))
        s.ajs(INVOKE, "web_close", {"label": "web-probe"})
        srv.shutdown()
        inline = s.js("try { const sc = document.createElement('script'); sc.textContent = 'window.__inlineRan = 1'; document.body.appendChild(sc); } catch (e) {} return !!window.__inlineRan;")
        check("SECURITY: CSP blocks injected inline scripts", inline is False)
        remote = s.js("const sc = document.createElement('script'); sc.src = 'https://example.com/x.js'; document.body.appendChild(sc); return true;")
        time.sleep(1)
        v = s.js("return window.__csp")
        check("SECURITY: CSP blocks remote scripts", any("script-src" in x for x in v), f"{len(v)} blocked")
        # Excalidraw lists a CDN copy of its fonts after the local one; the
        # CSP blocking that fallback is intended (Scribblr stays offline).
        other = sorted(set(x for x in v if "script-src" not in x and "https://esm.sh/@excalidraw" not in x))
        loaded = s.ajs("const d = arguments[0]; setTimeout(() => d(false), 8000); document.fonts.load('20px Excalifont').then(l => d(l.some(f => f.status === 'loaded')), () => d(false));")
        check("drawing fonts load from the app (offline)", loaded is True)
        check("CSP doesn't block the app's own features", not other, "; ".join(other)[:120])
        s.shot("e2e-end")
    except Exception as e:
        check("test run finished without errors", False, str(e)[:200])
    finally:
        if sid:
            try: req("DELETE", f"/session/{sid}")
            except Exception: pass
        drv.terminate()
        try: drv.wait(5)
        except Exception: drv.kill()
        subprocess.run(["pkill", "-f", f"HOME={home}"], check=False)
        shutil.rmtree(home, ignore_errors=True)
    failed = [r for r in results if not r[1]]
    print(f"\n{len(results) - len(failed)}/{len(results)} passed")
    sys.exit(1 if failed else 0)

if __name__ == "__main__":
    main()
