// Links between drawings, Obsidian-style: `[[Name]]` in a text or an element
// link points at the drawing called Name. The Rust side lists each drawing's
// targets (link_index); this resolves names to files and builds the graph.
import { baseName } from "./api.js";

export const GRAPH = "scribblr:graph";
export const isGraph = (f) => f === GRAPH;

// The drawing a link names, if any: `[[Name]]`, `[[Name|label]]`, `x/Name.excalidraw`.
export function linkName(link) {
  if (!link) return null;
  let s = link;
  try { s = decodeURIComponent(link); } catch { /* keep */ }
  const wiki = /\[\[([^\]|[]+)(?:\|[^\]]*)?\]\]/.exec(s);
  if (wiki) return wiki[1].trim().replace(/\.excalidraw$/, "");
  if (/\.excalidraw$/.test(s) && !/^[a-z]+:\/\//i.test(s)) return baseName(s);
  return null;
}

const folderOf = (p) => p.slice(0, p.lastIndexOf("/"));

export function buildGraph(index, spaces) {
  const spaceOf = (p) => spaces.filter((s) => p === s.folder || p.startsWith(s.folder + "/")).sort((a, b) => b.folder.length - a.folder.length)[0] ?? null;
  const byName = new Map();
  const nodes = new Map();
  for (const { path } of index) {
    const n = { path, name: baseName(path), space: spaceOf(path) };
    nodes.set(path, n);
    const k = n.name.toLowerCase();
    byName.set(k, [...(byName.get(k) ?? []), path]);
  }
  // Same folder first, then same space, then anywhere.
  const resolve = (name, from) => {
    const c = byName.get(name.toLowerCase()) ?? [];
    if (!c.length) return null;
    if (!from) return c[0];
    const sp = spaceOf(from);
    return c.find((p) => folderOf(p) === folderOf(from)) ?? c.find((p) => sp && spaceOf(p)?.id === sp.id) ?? c[0];
  };
  const outgoing = new Map();
  const backlinks = new Map();
  const edges = [];
  for (const { path, links } of index) {
    const outs = links.map((name) => ({ name, path: resolve(name, path) }));
    outgoing.set(path, outs);
    for (const o of outs) {
      edges.push({ from: path, to: o.path ?? `ghost:${o.name.toLowerCase()}`, name: o.name });
      if (o.path) backlinks.set(o.path, [...(backlinks.get(o.path) ?? []), path]);
    }
  }
  return { nodes, edges, outgoing, backlinks, resolve, spaceOf };
}
