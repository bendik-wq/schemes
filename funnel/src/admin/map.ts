// Funnel map storage. Two kv_state documents shared by everyone who opens Funnel HQ:
//   map:layout  {[nodeId]: {x, y}}                       — positions after dragging
//   map:custom  {nodes[], edges[], edits{}}              — steps and arrows people added, and edits to built-ins
// Everything is validated strictly; anything unexpected is rejected (400), never "cleaned".

import type { Runtime } from "../app";
import { kvGetJson, kvSet } from "../lib/kv";

/** Built-in node ids. KEEP IN SYNC with NODES in public/assets/funnel-map.js. */
export const BUILTIN_NODE_IDS = [
  "src_meta", "src_youtube", "src_organic", "src_direct",
  "meta_route", "landers", "main_ab", "main_page", "vsl", "pitch", "apply", "scoring", "tier_split",
  "book", "breakout", "resources", "booked", "call", "won", "lost", "no_show",
  "ai_speed", "ai_confirm", "ai_rebook", "em_precall", "em_booked", "em_abandoned", "em_tiers", "em_noshow", "em_postcall",
  "em_cancelled", "em_won", "em_lost", "em_nurture", "triggers", "pings", "digest",
  "tracking", "forwarding", "profile", "claude", "reader", "inbound", "hq",
] as const;

/** Funnel HQ tab ids (a node's "Open in Funnel HQ" target). KEEP IN SYNC with TABS in public/assets/admin.js. */
export const TAB_IDS = [
  "overview", "map", "traffic", "landers", "links", "vsl", "behaviour", "application", "leads", "sales", "insights", "team",
  "emails", "voice", "tracking", "live", "integrations",
] as const;

export const NODE_KINDS = ["traffic", "page", "decision", "auto", "people", "data"] as const;
export const EDGE_STYLES = ["auto", "data", "dash"] as const;
export const CUSTOM_ID_RE = /^u_[a-z0-9]{4,20}$/;
export const LIMITS = { nodes: 200, edges: 400, title: 60, sub: 90, note: 2000, label: 30, coord: 100_000, layout: 600 };

export interface CustomNode { id: string; kind: string; title: string; sub: string; note: string; tab: string; x: number; y: number }
export interface CustomEdge { id: string; from: string; to: string; label: string; style: string }
export interface NodeEdit { title?: string; sub?: string; note?: string }
export interface CustomMap { nodes: CustomNode[]; edges: CustomEdge[]; edits: Record<string, NodeEdit> }
export type Layout = Record<string, { x: number; y: number }>;

export class MapError extends Error {}

const BUILTIN = new Set<string>(BUILTIN_NODE_IDS);
const TABS = new Set<string>(TAB_IDS);
const KINDS = new Set<string>(NODE_KINDS);
const STYLES = new Set<string>(EDGE_STYLES);

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

function str(v: unknown, max: number, field: string, required = false): string {
  if (v == null || v === "") {
    if (required) throw new MapError(`${field} is required`);
    return "";
  }
  if (typeof v !== "string") throw new MapError(`${field} must be text`);
  if ([...v].length > max) throw new MapError(`${field} is longer than ${max} characters`);
  // No control characters except newlines/tabs in notes.
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(v)) throw new MapError(`${field} contains control characters`);
  return v;
}

function coord(v: unknown, field: string): number {
  if (typeof v !== "number" || !Number.isFinite(v) || Math.abs(v) > LIMITS.coord) throw new MapError(`${field} must be a number`);
  return Math.round(v);
}

function onlyKeys(o: Record<string, unknown>, allowed: string[], what: string) {
  for (const k of Object.keys(o)) if (!allowed.includes(k)) throw new MapError(`${what}: unknown field ${k}`);
}

export function validateLayout(input: unknown): Layout {
  if (!isObj(input)) throw new MapError("layout must be an object");
  const keys = Object.keys(input);
  if (keys.length > LIMITS.layout) throw new MapError("too many positions");
  const out: Layout = {};
  for (const id of keys) {
    if (!BUILTIN.has(id) && !CUSTOM_ID_RE.test(id)) throw new MapError(`unknown node id ${id.slice(0, 40)}`);
    const p = input[id];
    if (!isObj(p)) throw new MapError("position must be {x, y}");
    onlyKeys(p, ["x", "y"], "position");
    out[id] = { x: coord(p.x, "x"), y: coord(p.y, "y") };
  }
  return out;
}

export function validateCustom(input: unknown): CustomMap {
  if (!isObj(input)) throw new MapError("custom map must be an object");
  onlyKeys(input, ["nodes", "edges", "edits"], "custom map");
  const nodesIn = input.nodes ?? [];
  const edgesIn = input.edges ?? [];
  const editsIn = input.edits ?? {};
  if (!Array.isArray(nodesIn)) throw new MapError("nodes must be a list");
  if (!Array.isArray(edgesIn)) throw new MapError("edges must be a list");
  if (!isObj(editsIn)) throw new MapError("edits must be an object");
  if (nodesIn.length > LIMITS.nodes) throw new MapError(`at most ${LIMITS.nodes} custom steps`);
  if (edgesIn.length > LIMITS.edges) throw new MapError(`at most ${LIMITS.edges} custom arrows`);

  const nodes: CustomNode[] = [];
  const ids = new Set<string>();
  for (const n of nodesIn) {
    if (!isObj(n)) throw new MapError("node must be an object");
    onlyKeys(n, ["id", "kind", "title", "sub", "note", "tab", "x", "y"], "node");
    const id = typeof n.id === "string" ? n.id : "";
    if (!CUSTOM_ID_RE.test(id)) throw new MapError("custom step ids look like u_abcd1234");
    if (ids.has(id)) throw new MapError("duplicate step id");
    ids.add(id);
    const kind = typeof n.kind === "string" ? n.kind : "";
    if (!KINDS.has(kind)) throw new MapError("unknown step kind");
    const tab = str(n.tab, 20, "tab");
    if (tab && !TABS.has(tab)) throw new MapError("unknown tab");
    nodes.push({
      id, kind, title: str(n.title, LIMITS.title, "title", true), sub: str(n.sub, LIMITS.sub, "subtitle"), note: str(n.note, LIMITS.note, "notes"),
      tab, x: coord(n.x ?? 0, "x"), y: coord(n.y ?? 0, "y"),
    });
  }

  const edges: CustomEdge[] = [];
  const edgeIds = new Set<string>();
  const exists = (id: unknown) => typeof id === "string" && (BUILTIN.has(id) || ids.has(id));
  for (const e of edgesIn) {
    if (!isObj(e)) throw new MapError("arrow must be an object");
    onlyKeys(e, ["id", "from", "to", "label", "style"], "arrow");
    const id = typeof e.id === "string" ? e.id : "";
    if (!CUSTOM_ID_RE.test(id)) throw new MapError("arrow ids look like u_abcd1234");
    if (edgeIds.has(id)) throw new MapError("duplicate arrow id");
    edgeIds.add(id);
    if (!exists(e.from) || !exists(e.to)) throw new MapError("arrow points at a step that does not exist");
    if (e.from === e.to) throw new MapError("an arrow cannot point at its own step");
    const style = e.style == null || e.style === "" ? "auto" : String(e.style);
    if (!STYLES.has(style)) throw new MapError("unknown arrow style");
    edges.push({ id, from: e.from as string, to: e.to as string, label: str(e.label, LIMITS.label, "label"), style });
  }

  const edits: Record<string, NodeEdit> = {};
  for (const [id, ed] of Object.entries(editsIn)) {
    if (!BUILTIN.has(id)) throw new MapError("edits are only for built-in steps");
    if (!isObj(ed)) throw new MapError("edit must be an object");
    onlyKeys(ed, ["title", "sub", "note"], "edit");
    const clean: NodeEdit = {};
    if (ed.title !== undefined) clean.title = str(ed.title, LIMITS.title, "title");
    if (ed.sub !== undefined) clean.sub = str(ed.sub, LIMITS.sub, "subtitle");
    if (ed.note !== undefined) clean.note = str(ed.note, LIMITS.note, "notes");
    if (Object.keys(clean).length) edits[id] = clean;
  }
  return { nodes, edges, edits };
}

const EMPTY: CustomMap = { nodes: [], edges: [], edits: {} };

export async function loadMap(rt: Runtime) {
  const layoutRaw = await kvGetJson<unknown>(rt.env, "map:layout", {});
  const customRaw = await kvGetJson<unknown>(rt.env, "map:custom", EMPTY);
  let layout: Layout = {};
  let custom: CustomMap = EMPTY;
  try { layout = validateLayout(layoutRaw); } catch { layout = {}; }
  try { custom = validateCustom(customRaw); } catch { custom = EMPTY; }
  return { layout, custom, builtin_ids: BUILTIN_NODE_IDS, tabs: TAB_IDS };
}

export async function saveLayout(rt: Runtime, input: unknown): Promise<Layout> {
  const layout = validateLayout(input);
  await kvSet(rt.env, "map:layout", JSON.stringify(layout));
  return layout;
}

export async function saveCustom(rt: Runtime, input: unknown): Promise<CustomMap> {
  const custom = validateCustom(input);
  const s = JSON.stringify(custom);
  if (s.length > 900_000) throw new MapError("map is too large");
  await kvSet(rt.env, "map:custom", s);
  return custom;
}
