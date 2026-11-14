// Notes: Notion-style pages (BlockNote: blocks, "/" menu, drag handles, to-dos,
// toggles, tables, code) saved as Scribblr note files (.note, block data).
// Obsidian-style on top: "@" links a page or drawing (shown as a chip, part
// of the graph and backlinks), tags, and embeds for web pages and drawings.
import React, { useEffect, useMemo, useRef, useState } from "react";
import { BlockNoteSchema, defaultBlockSpecs, defaultInlineContentSpecs, filterSuggestionItems, insertOrUpdateBlockForSlashMenu } from "@blocknote/core";
import { useCreateBlockNote, createReactBlockSpec, createReactInlineContentSpec, SuggestionMenuController, getDefaultReactSlashMenuItems } from "@blocknote/react";
import { BlockNoteView } from "@blocknote/mantine";
import { exportToSvg } from "@excalidraw/excalidraw";
import { openUrl } from "@tauri-apps/plugin-opener";
import "@blocknote/mantine/style.css";
import { useApp } from "../ctx.js";
import { api, baseName, flatten, kindOf, KIND_ICON } from "../api.js";
import { Icon } from "../icons.jsx";
import { attachSmoothCaret } from "../apps/smoothCaret.js";

// Lets custom blocks reach the app (open a link, list drawings) without props.
const appRef = { current: null };

const WikiLink = createReactInlineContentSpec(
  { type: "wikilink", propSchema: { name: { default: "" } }, content: "none" },
  {
    render: ({ inlineContent }) => {
      const name = inlineContent.props.name;
      return (
        <span className="wikilink" contentEditable={false}
          onClick={(e) => appRef.current?.openLink(name, appRef.current.file, e.ctrlKey || e.metaKey)}>
          {name}
        </span>
      );
    },
  },
);

// Only real web pages can be embedded: a note file (maybe from someone
// else) must never smuggle in a javascript: or file: address.
const safeUrl = (u) => (/^https?:\/\//i.test(u ?? "") ? u : null);
const toEmbedUrl = (url) => {
  const yt = /(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]{6,})/.exec(url);
  if (yt) return `https://www.youtube.com/embed/${yt[1]}`;
  const vimeo = /vimeo\.com\/(\d+)/.exec(url);
  if (vimeo) return `https://player.vimeo.com/video/${vimeo[1]}`;
  return url;
};

const Embed = createReactBlockSpec(
  { type: "embed", propSchema: { url: { default: "" }, height: { default: 420 } }, content: "none" },
  {
    render: ({ block, editor }) => {
      const [draft, setDraft] = useState("");
      const url = safeUrl(block.props.url);
      if (!url) {
        return (
          <div className="embed-empty" contentEditable={false}>
            <Icon name="globe" size={15} />
            <input placeholder="Paste a link (web page, YouTube, docs…) and press Enter" value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && draft.trim()) {
                  const u = /^https?:\/\//.test(draft.trim()) ? draft.trim() : "https://" + draft.trim();
                  editor.updateBlock(block, { props: { url: u } });
                }
              }} />
          </div>
        );
      }
      return (
        <div className="embed" contentEditable={false}>
          <div className="embed-bar">
            <Icon name="globe" size={13} /><span className="truncate">{url}</span><span className="grow" />
            <button onClick={() => openUrl(url).catch(() => {})}>Open</button>
            <button onClick={() => editor.updateBlock(block, { props: { url: "" } })}>Change</button>
          </div>
          <iframe src={toEmbedUrl(url)} style={{ height: block.props.height }} title={url}
            sandbox="allow-scripts allow-same-origin allow-popups allow-forms allow-presentation" allow="fullscreen; clipboard-write; encrypted-media" />
        </div>
      );
    },
  },
);

function DrawingPreview({ path }) {
  const [svg, setSvg] = useState(null); // an image URL, never inline markup
  useEffect(() => {
    let alive = true;
    api.readText(path).then(async (t) => {
      const d = JSON.parse(t);
      const el = await exportToSvg({ elements: (d.elements ?? []).filter((e) => !e.isDeleted), appState: { ...(d.appState ?? {}), exportBackground: true }, files: d.files ?? {} });
      el.removeAttribute("width"); el.removeAttribute("height");
      // Shown as an <img>: anything odd inside a drawing can't run as code.
      const url = URL.createObjectURL(new Blob([el.outerHTML], { type: "image/svg+xml" }));
      if (alive) setSvg(url);
    }).catch(() => alive && setSvg(""));
    return () => { alive = false; };
  }, [path]);
  if (svg === "") return <div className="drawing-missing">Drawing not found</div>;
  useEffect(() => () => { if (svg) URL.revokeObjectURL(svg); }, [svg]);
  return <div className="drawing-svg">{svg && <img src={svg} alt="" draggable={false} />}</div>;
}

const Drawing = createReactBlockSpec(
  { type: "drawing", propSchema: { path: { default: "" } }, content: "none" },
  {
    render: ({ block, editor }) => {
      const app = appRef.current;
      const path = block.props.path;
      if (!path) {
        const list = app ? flatten(app.drawings[app.space?.folder] ?? []).filter((d) => kindOf(d.path) === "drawing") : [];
        return (
          <div className="embed-empty column" contentEditable={false}>
            <div className="dim">Embed a drawing</div>
            <div className="drawing-choices">
              {list.map((d) => (
                <button key={d.path} onClick={() => editor.updateBlock(block, { props: { path: d.path } })}><Icon name="pen" size={13} /> {baseName(d.path)}</button>
              ))}
              {!list.length && <span className="dim">No drawings in this space yet</span>}
            </div>
          </div>
        );
      }
      return (
        <div className="embed drawing-embed" contentEditable={false}>
          <div className="embed-bar">
            <Icon name="pen" size={13} /><span className="truncate">{baseName(path)}</span><span className="grow" />
            <button onClick={(e) => app?.openLink(baseName(path), app.file, e.ctrlKey || e.metaKey)}>Open</button>
            <button onClick={() => editor.updateBlock(block, { props: { path: "" } })}>Change</button>
          </div>
          <DrawingPreview path={path} />
        </div>
      );
    },
  },
);

const schema = BlockNoteSchema.create({
  blockSpecs: { ...defaultBlockSpecs, embed: Embed(), drawing: Drawing() },
  inlineContentSpecs: { ...defaultInlineContentSpecs, wikilink: WikiLink },
});

// Names this page links to: @ links and embedded drawings.
function extractLinks(blocks) {
  const out = [];
  const walk = (bs) => {
    for (const b of bs ?? []) {
      if (b.type === "drawing" && b.props?.path) out.push(baseName(b.props.path));
      const content = Array.isArray(b.content) ? b.content : b.content?.rows?.flatMap((r) => r.cells.flatMap((c) => (Array.isArray(c) ? c : c.content ?? []))) ?? [];
      for (const c of content) if (c.type === "wikilink" && c.props?.name) out.push(c.props.name);
      walk(b.children);
    }
  };
  walk(blocks);
  return [...new Map(out.map((n) => [n.toLowerCase(), n])).values()];
}

function Editor({ file, doc, dark, title, onTitle, compact, children }) {
  const app = useApp();
  appRef.current = { ...app, file };
  const editor = useCreateBlockNote({ schema, initialContent: doc.blocks?.length ? doc.blocks : undefined }, [file]);
  const meta = useRef({ tags: doc.scribblr?.tags ?? [], extracted: extractLinks(doc.blocks) });
  const timer = useRef(null);
  const [tags, setTags] = useState(meta.current.tags);
  // Notion's "Full width": text runs the whole pane (on by default).
  const [full, setFull] = useState(() => { try { return localStorage.getItem("note.full") !== "0"; } catch { return true; } });
  const toggleFull = () => setFull((f) => { try { localStorage.setItem("note.full", f ? "0" : "1"); } catch { /* ok */ } return !f; });
  const scroller = useRef(null);
  useEffect(() => (scroller.current ? attachSmoothCaret(scroller.current) : undefined), []);
  const [tagDraft, setTagDraft] = useState("");

  const save = async () => {
    clearTimeout(timer.current);
    const blocks = editor.document;
    const extracted = extractLinks(blocks);
    // Keep links added from the Links panel (Ctrl+Shift+L): those on disk that
    // didn't come from the page's own @ links.
    let disk = [];
    try { disk = JSON.parse(await api.readText(file)).scribblr?.links ?? []; } catch { /* new */ }
    const prev = new Set(meta.current.extracted.map((x) => x.toLowerCase()));
    const manual = disk.filter((l) => !prev.has(l.toLowerCase()));
    const links = [...new Map([...manual, ...extracted].map((n) => [n.toLowerCase(), n])).values()];
    meta.current.extracted = extracted;
    await api.writeText(file, JSON.stringify({ type: "scribblr-note", version: 1, blocks, scribblr: { links, tags: meta.current.tags } }));
  };
  const later = () => { clearTimeout(timer.current); timer.current = setTimeout(save, 500); };
  useEffect(() => () => { if (timer.current) save(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const setTagList = (next) => { meta.current.tags = next; setTags(next); later(); };

  const pages = useMemo(() => app.state.spaces.flatMap((sp) => flatten(app.drawings[sp.folder] ?? []))
    .filter((d) => d.path !== file).map((d) => ({ name: baseName(d.path), kind: kindOf(d.path), path: d.path })), [app.state.spaces, app.drawings, file]);

  return (
    <div ref={scroller} className={`note-scroll ${compact ? "compact" : ""} ${full ? "full" : ""}`}>
      <button className="note-width" title={full ? "Narrow page" : "Full width"} onClick={toggleFull}>
        <Icon name={full ? "minimize" : "maximize"} size={13} />
      </button>
      <div className={`note-head ${compact ? "compact" : ""}`}>
        {onTitle
          ? <input className="note-title note-title-input" value={title ?? ""} placeholder="Untitled" onChange={(e) => onTitle(e.target.value)} />
          : <div className="note-title">{title ?? baseName(file)}</div>}
        <div className="note-tags">
          <Icon name="tag" size={13} className="dim" />
          {tags.map((t) => <span key={t} className="tag-chip">#{t}<button onClick={() => setTagList(tags.filter((x) => x !== t))}>×</button></span>)}
          <input className="tag-input" placeholder="add tag" value={tagDraft} onChange={(e) => setTagDraft(e.target.value.replace(/\s/g, "-"))}
            onKeyDown={(e) => { if (e.key === "Enter" && tagDraft.trim()) { setTagList([...new Set([...tags, tagDraft.trim().replace(/^#/, "")])]); setTagDraft(""); } }} />
        </div>
      </div>
      {children}
      <BlockNoteView editor={editor} theme={dark ? "dark" : "light"} onChange={later} slashMenu={false}>
        <SuggestionMenuController
          triggerCharacter="/"
          getItems={async (q) => filterSuggestionItems([
            ...getDefaultReactSlashMenuItems(editor),
            { title: "Web embed", subtext: "A web page, video or doc inside the page", aliases: ["iframe", "youtube", "web", "link"], group: "Embeds",
              icon: <Icon name="globe" size={18} />, onItemClick: () => insertOrUpdateBlockForSlashMenu(editor, { type: "embed" }) },
            { title: "Drawing", subtext: "Embed a drawing from this space", aliases: ["excalidraw", "sketch", "diagram"], group: "Embeds",
              icon: <Icon name="pen" size={18} />, onItemClick: () => insertOrUpdateBlockForSlashMenu(editor, { type: "drawing" }) },
            { title: "Link to page", subtext: "Type @ anywhere to link a page or drawing", aliases: ["wikilink", "mention", "page"], group: "Links",
              icon: <Icon name="link" size={18} />, onItemClick: () => editor.insertInlineContent(["@"]) },
          ], q)}
        />
        <SuggestionMenuController
          triggerCharacter="@"
          getItems={async (q) => {
            const items = pages.map((p) => ({
              title: p.name, subtext: p.kind ?? "", group: "Pages and drawings",
              icon: <Icon name={KIND_ICON[p.kind] ?? "file"} size={16} />,
              onItemClick: () => editor.insertInlineContent([{ type: "wikilink", props: { name: p.name } }, " "]),
            }));
            const name = q.trim();
            if (name && !pages.some((p) => p.name.toLowerCase() === name.toLowerCase())) {
              items.push({ title: `New page "${name}"`, subtext: "made when you open it", group: "New",
                icon: <Icon name="plus" size={16} />, onItemClick: () => editor.insertInlineContent([{ type: "wikilink", props: { name } }, " "]) });
            }
            return filterSuggestionItems(items, q);
          }}
        />
      </BlockNoteView>
    </div>
  );
}

// `title` / `onTitle`: a page that isn't named by its file (calendar pages).
export default function NotePane({ file, title, onTitle, compact, children }) {
  const { dark, epoch } = useApp();
  const [doc, setDoc] = useState(undefined);
  useEffect(() => {
    let alive = true;
    api.readText(file).then((t) => {
      let d = {};
      try { d = JSON.parse(t || "{}"); } catch { d = {}; }
      if (alive) setDoc(d);
    }).catch(() => alive && setDoc(null));
    return () => { alive = false; };
  }, [file, epoch]);
  if (doc === undefined) return <div className="canvas-msg" />;
  if (doc === null) return <div className="canvas-msg">This note is gone from disk.</div>;
  return <Editor key={file + epoch} file={file} doc={doc} dark={dark} title={title} onTitle={onTitle} compact={compact}>{children}</Editor>;
}
