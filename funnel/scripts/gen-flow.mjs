// Generates the silk-like flow lines used behind the funnel pages (deterministic).
// Usage: node scripts/gen-flow.mjs public/assets/flow
import { writeFileSync } from "node:fs";
const out = process.argv[2] || "public/assets/flow";
// Whole-pixel coordinates and 24 Bézier segments per line: indistinguishable at the size the ribbon is shown
// (blurred by a mask, at 30% opacity), at about a fifth of the bytes of the first version.
const r = (n) => Math.round(n);

function ribbon({ w, h, lines, amp, twist, stops, opacity }) {
  const steps = 24;
  let paths = "";
  for (let i = 0; i < lines; i++) {
    const t = i / (lines - 1);
    const pts = [];
    for (let s = 0; s <= steps; s++) {
      const u = s / steps, x = u * w;
      // Two travelling waves whose phase drifts per line, so the band folds like silk.
      const y = h * 0.5
        + amp * Math.sin(u * Math.PI * 2 * 0.9 + t * twist)
        + amp * 0.45 * Math.sin(u * Math.PI * 2 * 1.7 - t * twist * 0.6 + 1.2)
        + (t - 0.5) * h * 0.42 * (0.35 + 0.65 * Math.abs(Math.cos(u * Math.PI * 1.15 + 0.4)));
      pts.push([x, y]);
    }
    // Catmull-Rom to cubic Bézier for a smooth curve.
    // Relative cubic commands with whole numbers keep each line short.
    let d = `M${r(pts[0][0])} ${r(pts[0][1])}c`;
    let cx = r(pts[0][0]), cy = r(pts[0][1]);
    const segs = [];
    for (let k = 0; k < pts.length - 1; k++) {
      const p0 = pts[k - 1] || pts[k], p1 = pts[k], p2 = pts[k + 1], p3 = pts[k + 2] || p2;
      const c1x = r(p1[0] + (p2[0] - p0[0]) / 6), c1y = r(p1[1] + (p2[1] - p0[1]) / 6);
      const c2x = r(p2[0] - (p3[0] - p1[0]) / 6), c2y = r(p2[1] - (p3[1] - p1[1]) / 6);
      const ex = r(p2[0]), ey = r(p2[1]);
      segs.push([c1x - cx, c1y - cy, c2x - cx, c2y - cy, ex - cx, ey - cy].map((n, j) => (j === 0 || n < 0 ? String(n) : " " + n)).join(""));
      cx = ex; cy = ey;
    }
    d += segs.join(" ");
    const o = (opacity * (0.35 + 0.65 * Math.sin(Math.PI * t))).toFixed(3);
    paths += `<path d="${d}" stroke-opacity="${o}"/>`;
  }
  const grad = stops.map(([off, c]) => `<stop offset="${off}" stop-color="${c}"/>`).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" fill="none" preserveAspectRatio="xMidYMid slice"><defs><linearGradient id="g" x1="0" y1="0" x2="${w}" y2="0" gradientUnits="userSpaceOnUse">${grad}</linearGradient></defs><g stroke="url(#g)" stroke-width="1.1" stroke-linecap="round">${paths}</g></svg>`;
}

const brand = [[0, "#2f6bff"], [0.4, "#6a4dff"], [0.72, "#b14dff"], [1, "#ff6aa8"]];
writeFileSync(`${out}/silk.svg`, ribbon({ w: 1600, h: 600, lines: 34, amp: 70, twist: 2.4, stops: brand, opacity: 0.9 }));
writeFileSync(`${out}/silk-2.svg`, ribbon({ w: 1600, h: 500, lines: 26, amp: 55, twist: -2.0, stops: [[0, "#ff8a5c"], [0.35, "#ff6aa8"], [0.7, "#8a5cff"], [1, "#2f8bff"]], opacity: 0.85 }));
