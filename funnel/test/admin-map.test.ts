import { describe, expect, it } from "vitest";
import { BUILTIN_NODE_IDS, LIMITS, MapError, TAB_IDS, validateCustom, validateLayout } from "../src/admin/map";
import { readFileSync } from "node:fs";

const good = () => ({
  nodes: [
    { id: "u_abcd1234", kind: "page", title: "Webinar page", sub: "/webinar", note: "Runs on Thursdays.\nTwo lines.", tab: "vsl", x: 120, y: 340 },
    { id: "u_zz99", kind: "auto", title: "SMS reminder", sub: "", note: "", tab: "", x: -40, y: 0 },
  ],
  edges: [
    { id: "u_edge0001", from: "u_abcd1234", to: "apply", label: "applies", style: "auto" },
    { id: "u_edge0002", from: "booked", to: "u_zz99", label: "", style: "dash" },
  ],
  edits: { vsl: { title: "The film", sub: "9 minutes", note: "Re-cut in October." } },
});

const rejects = (fn: () => unknown) => expect(fn).toThrow(MapError);

describe("map layout", () => {
  it("accepts built-in and custom ids with numeric positions", () => {
    expect(validateLayout({ vsl: { x: 10.4, y: -20 }, u_abcd1234: { x: 0, y: 0 } })).toEqual({ vsl: { x: 10, y: -20 }, u_abcd1234: { x: 0, y: 0 } });
  });
  it("rejects unknown ids, extra fields and bad numbers", () => {
    rejects(() => validateLayout({ nope: { x: 1, y: 1 } }));
    rejects(() => validateLayout({ "u_AB": { x: 1, y: 1 } }));
    rejects(() => validateLayout({ vsl: { x: 1, y: 1, z: 1 } }));
    rejects(() => validateLayout({ vsl: { x: "1", y: 1 } }));
    rejects(() => validateLayout({ vsl: { x: Infinity, y: 1 } }));
    rejects(() => validateLayout({ vsl: { x: 1e9, y: 1 } }));
    rejects(() => validateLayout([]));
    rejects(() => validateLayout(null));
  });
});

describe("map custom", () => {
  it("accepts a good payload", () => {
    const out = validateCustom(good());
    expect(out.nodes).toHaveLength(2);
    expect(out.edges[1].style).toBe("dash");
    expect(out.edits.vsl.title).toBe("The film");
  });
  it("defaults missing lists and edge style", () => {
    const out = validateCustom({ edges: [{ id: "u_aaaa", from: "vsl", to: "apply" }] });
    expect(out.nodes).toEqual([]);
    expect(out.edges[0].style).toBe("auto");
  });
  it("rejects bad ids", () => {
    for (const id of ["vsl", "u_abc", "u_ABCD1234", "u_" + "a".repeat(21), "x_abcd1234", "u_abcd-123", 42]) {
      const p = good(); (p.nodes[0] as Record<string, unknown>).id = id;
      rejects(() => validateCustom(p));
    }
    const dup = good(); dup.nodes[1].id = dup.nodes[0].id;
    rejects(() => validateCustom(dup));
    const edgeId = good(); edgeId.edges[0].id = "e1";
    rejects(() => validateCustom(edgeId));
  });
  it("rejects oversize payloads", () => {
    const many = good();
    many.nodes = Array.from({ length: LIMITS.nodes + 1 }, (_, i) => ({ id: `u_n${String(i).padStart(4, "0")}`, kind: "page", title: "x", sub: "", note: "", tab: "", x: 0, y: 0 }));
    many.edges = [];
    rejects(() => validateCustom(many));
    const edges = good();
    edges.edges = Array.from({ length: LIMITS.edges + 1 }, (_, i) => ({ id: `u_e${String(i).padStart(4, "0")}`, from: "vsl", to: "apply", label: "", style: "auto" }));
    rejects(() => validateCustom(edges));
  });
  it("rejects unknown kinds, tabs, styles and fields", () => {
    const k = good(); k.nodes[0].kind = "script"; rejects(() => validateCustom(k));
    const t = good(); t.nodes[0].tab = "secrets"; rejects(() => validateCustom(t));
    const s = good(); s.edges[0].style = "bold"; rejects(() => validateCustom(s));
    const f = good(); (f.nodes[0] as Record<string, unknown>).onclick = "alert(1)"; rejects(() => validateCustom(f));
    const top = { ...good(), extra: 1 }; rejects(() => validateCustom(top));
  });
  it("rejects dangling and self edges", () => {
    const d = good(); d.edges[0].to = "u_missing1"; rejects(() => validateCustom(d));
    const d2 = good(); d2.edges[0].from = "nowhere"; rejects(() => validateCustom(d2));
    const self = good(); self.edges[0].to = self.edges[0].from; rejects(() => validateCustom(self));
  });
  it("rejects long strings", () => {
    const a = good(); a.nodes[0].title = "x".repeat(LIMITS.title + 1); rejects(() => validateCustom(a));
    const b = good(); b.nodes[0].sub = "x".repeat(LIMITS.sub + 1); rejects(() => validateCustom(b));
    const c = good(); c.nodes[0].note = "x".repeat(LIMITS.note + 1); rejects(() => validateCustom(c));
    const d = good(); d.edges[0].label = "x".repeat(LIMITS.label + 1); rejects(() => validateCustom(d));
    const e = good(); e.edits.vsl.note = "x".repeat(LIMITS.note + 1); rejects(() => validateCustom(e));
    const ok = good(); ok.nodes[0].title = "x".repeat(LIMITS.title); expect(() => validateCustom(ok)).not.toThrow();
  });
  it("rejects missing titles, control characters and edits to unknown or custom nodes", () => {
    const a = good(); a.nodes[0].title = ""; rejects(() => validateCustom(a));
    const b = good(); b.nodes[0].title = "bad\u0000"; rejects(() => validateCustom(b));
    const c = good(); (c.edits as Record<string, unknown>).u_abcd1234 = { title: "x" }; rejects(() => validateCustom(c));
    const d = good(); (d.edits as Record<string, unknown>).vsl = { title: "x", html: "<b>" }; rejects(() => validateCustom(d));
  });
  it("built-in ids and tabs match funnel-map.js and admin.js", () => {
    const js = readFileSync(new URL("../public/assets/funnel-map.js", import.meta.url), "utf8");
    const ids = [...js.matchAll(/\bid:\s*"([a-z_]+)"\s*,\s*kind:/g)].map((m) => m[1]);
    expect(ids.sort()).toEqual([...BUILTIN_NODE_IDS].sort());
    const admin = readFileSync(new URL("../public/assets/admin.js", import.meta.url), "utf8");
    for (const t of TAB_IDS) expect(admin).toContain(`id: "${t}"`);
  });
});
