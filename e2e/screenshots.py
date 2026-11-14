#!/usr/bin/env python3
"""Makes the README screenshots (docs/screenshots/*.png) from the real app,
with sample content in a throw-away HOME. Run: python3 -I e2e/screenshots.py"""
import datetime, json, os, random, shutil, subprocess, sys, tempfile, time, base64
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import run as e

OUT = os.path.join(e.ROOT, "docs/screenshots")
os.makedirs(OUT, exist_ok=True)
home = tempfile.mkdtemp(prefix="scribblr-shots-")
space = f"{home}/Study"
os.makedirs(f"{space}/Lectures")
R = lambda: random.randint(1, 2**30)

def el(kind, x, y, w, h, **kw):
    base = {"id": f"e{R()}", "type": kind, "x": x, "y": y, "width": w, "height": h, "angle": 0, "strokeColor": kw.get("stroke", "#1e1e1e"),
            "backgroundColor": kw.get("bg", "transparent"), "fillStyle": "hachure", "strokeWidth": 2, "strokeStyle": "solid", "roughness": 1,
            "opacity": 100, "groupIds": [], "frameId": None, "roundness": {"type": 3} if kind != "text" else None, "seed": R(), "version": 1,
            "versionNonce": R(), "isDeleted": False, "boundElements": [], "updated": 1, "link": None, "locked": False}
    if kind == "text":
        t = kw["text"]; size = kw.get("size", 24)
        base.update(text=t, originalText=t, fontSize=size, fontFamily=5, textAlign="left", verticalAlign="top", containerId=None, autoResize=True, lineHeight=1.25,
                    width=max(len(l) for l in t.split("\n")) * size * 0.55, height=size * 1.25 * len(t.split("\n")))
    if kind == "arrow":
        base.update(points=[[0, 0], [w, h]], lastCommittedPoint=None, startBinding=None, endBinding=None, startArrowhead=None, endArrowhead="arrow", roundness={"type": 2})
    return base

drawing = {"type": "excalidraw", "version": 2, "source": "scribblr", "appState": {"viewBackgroundColor": "#ffffff", "zoom": {"value": 0.42}}, "files": {},
  "scribblr": {"links": ["Week 47 plan"]}, "elements": [
    el("text", 60, 30, 0, 0, text="Decision trees", size=40),
    el("rectangle", 60, 120, 260, 110, stroke="#1971c2", bg="#a5d8ff"), el("text", 90, 155, 0, 0, text="Entropy H(D)", size=26, stroke="#1971c2"),
    el("arrow", 330, 175, 140, 0, stroke="#495057"),
    el("diamond", 480, 100, 220, 150, stroke="#2f9e44", bg="#b2f2bb"), el("text", 525, 160, 0, 0, text="split on A?", size=24, stroke="#2f9e44"),
    el("arrow", 590, 255, -120, 110, stroke="#495057"), el("arrow", 600, 255, 120, 110, stroke="#495057"),
    el("ellipse", 360, 370, 200, 90, stroke="#e8590c", bg="#ffd8a8"), el("text", 405, 400, 0, 0, text="Gain(A)", size=24, stroke="#e8590c"),
    el("ellipse", 640, 370, 200, 90, stroke="#9c36b5", bg="#eebefa"), el("text", 690, 400, 0, 0, text="leaf", size=24, stroke="#9c36b5"),
    el("text", 60, 300, 0, 0, text="Info(D) = -Σ pᵢ log₂ pᵢ", size=28, stroke="#c2255c")]}
json.dump(drawing, open(f"{space}/Lectures/Decision trees.excalidraw", "w"))
note = {"type": "scribblr-note", "version": 1, "scribblr": {"links": ["Decision trees"], "tags": ["ml", "exam"]}, "blocks": [
  {"type": "heading", "props": {"level": 2}, "content": "This week"},
  {"type": "checkListItem", "props": {"checked": True}, "content": "Lecture 9: entropy and information gain"},
  {"type": "checkListItem", "props": {"checked": False}, "content": "Redo the decision-tree exercise sheet"},
  {"type": "checkListItem", "props": {"checked": False}, "content": "Ask about pruning in office hours"},
  {"type": "heading", "props": {"level": 3}, "content": "Notes"},
  {"type": "paragraph", "content": "Pick the split with the highest gain; stop when a node is pure."},
  {"type": "bulletListItem", "content": "Entropy is 0 for a pure set, 1 for a 50/50 split"},
  {"type": "bulletListItem", "content": "Gain ratio fixes the bias towards many-valued attributes"},
  {"type": "codeBlock", "props": {"language": "python"}, "content": "from math import log2\nH = -sum(p * log2(p) for p in ps if p)"}]}
json.dump(note, open(f"{space}/Week 47 plan.note", "w"))
today = datetime.date.today()
d = lambda n: (today + datetime.timedelta(days=n)).isoformat()
cal = {"type": "scribblr-calendar", "version": 1, "color": "ansi4", "scribblr": {"links": []}, "items": [
  {"id": "i1", "date": d(0), "title": "Revise entropy", "done": True, "time": "09:30"},
  {"id": "i2", "date": d(0), "title": "Exercise sheet 9", "done": False, "time": None},
  {"id": "i3", "date": d(2), "title": "ML lab", "done": False, "time": "14:00"},
  {"id": "i4", "date": d(5), "title": "Exam: ML", "done": False, "time": "10:00", "end": None},
  {"id": "i5", "date": d(-3), "title": "Project kickoff", "done": True, "time": None}]}
json.dump(cal, open(f"{space}/Calendar.calendar", "w"))
os.makedirs(f"{home}/.config/scribblr")
P = lambda pid, f, **kw: {"type": "pane", "id": pid, "file": f, **kw}
split = lambda sid, d_, a, b, r=0.55: {"type": "split", "id": sid, "dir": d_, "ratio": r, "a": a, "b": b}
tab = lambda tid, root, foc: {"id": tid, "name": None, "root": root, "focused": foc, "zoomed": None, "full": None}
state = {"spaces": [{"id": "s1", "name": "Study", "folder": space, "color": "ansi4", "activeTab": "t1", "tabs": [
    tab("t1", split("x1", "row", P("p1", f"{space}/Lectures/Decision trees.excalidraw"), P("p2", f"{space}/Week 47 plan.note")), "p2"),
    tab("t2", P("p3", "scribblr:calendar"), "p3"),
    tab("t3", split("x2", "row", P("p4", "scribblr:terminal", cwd=space), P("p5", "scribblr:files", cwd=space), 0.5), "p4"),
    tab("t4", P("p6", "scribblr:graph"), "p6")]},
  {"id": "s2", "name": "Coding", "folder": f"{home}/Coding", "color": "ansi5", "tabs": [], "activeTab": None}],
  "activeSpace": "s1", "sidebar": {"width": 268, "collapsed": False}, "panel": {"open": False, "width": 340, "view": "files"},
  "look": {"dark": "graphite", "light": "paper", "appearance": sys.argv[1] if len(sys.argv) > 1 else "dark", "zoom": 1}}
json.dump(state, open(f"{home}/.config/scribblr/state.json", "w"))

env = {k: v for k, v in os.environ.items() if not k.startswith("CLAUDE")}
env.update(HOME=home, XDG_CONFIG_HOME=f"{home}/.config", XDG_DATA_HOME=f"{home}/.local/share", SHELL="/bin/bash", PS1="study$ ")
drv = subprocess.Popen([e.DRIVER, "--port", str(e.PORT)], env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1.5)
try:
    sid = e.req("POST", "/session", {"capabilities": {"alwaysMatch": {"tauri:options": {"application": e.APP}}}})["sessionId"]
    s = e.S(sid)
    s.wait(".window", 20); time.sleep(4)
    def shot(name):
        png = e.req("GET", f"/session/{sid}/screenshot")
        open(f"{OUT}/{name}.png", "wb").write(base64.b64decode(png)); print("saved", name)
    shot("workspace")
    s.js("document.querySelectorAll('.tab')[1].dispatchEvent(new PointerEvent('pointerdown', {bubbles: true, button: 0})); document.querySelectorAll('.tab')[1].dispatchEvent(new PointerEvent('pointerup', {bubbles: true, button: 0}))")
    time.sleep(2.5); shot("calendar")
    s.js("const t = document.querySelectorAll('.tab')[2]; t.dispatchEvent(new PointerEvent('pointerdown', {bubbles: true, button: 0})); t.dispatchEvent(new PointerEvent('pointerup', {bubbles: true, button: 0}))")
    time.sleep(2.5)
    s.type(".panes:not(.hidden-tab) .xterm-helper-textarea", "clear; ls -la --color=always; echo; uname -sr\n")
    time.sleep(2.5); shot("terminal-files")
    s.js("window.dispatchEvent(new KeyboardEvent('keydown', {key: '4', code: 'Digit4', ctrlKey: true, bubbles: true}))")
    time.sleep(5); shot("graph")
    e.req("DELETE", f"/session/{sid}")
finally:
    drv.terminate(); shutil.rmtree(home, ignore_errors=True)
