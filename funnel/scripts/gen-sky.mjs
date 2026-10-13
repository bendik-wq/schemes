// Generates the background ornaments in public/assets/sky (deterministic).
// Usage: node scripts/gen-sky.mjs public/assets/sky
import { writeFileSync } from "node:fs";
const out = process.argv[2];
const f = (n) => +n.toFixed(2);
let seed = 7;
const rnd = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
const pol = (cx, cy, r, deg) => { const a = (deg - 90) * Math.PI / 180; return [f(cx + r * Math.cos(a)), f(cy + r * Math.sin(a))]; };
const star = (x, y, s, fill) => `<path d="M${x} ${f(y - s)}Q${x} ${y} ${f(x + s)} ${y}Q${x} ${y} ${x} ${f(y + s)}Q${x} ${y} ${f(x - s)} ${y}Q${x} ${y} ${x} ${f(y - s)}Z" fill="${fill}"/>`;

// 1. Astrolabe: rims, degree ticks, hours, hexagram, seed of life, offset rete.
{
  const C = 500, V = "#5b3cf0", G = "#c08a2e", M = "#c2399a";
  let s = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1000" fill="none">`;
  s += `<g stroke="${G}" stroke-width="1.2"><circle cx="${C}" cy="${C}" r="490"/><circle cx="${C}" cy="${C}" r="478"/></g>`;
  s += `<g stroke="${G}" stroke-width="1">`;
  for (let d = 0; d < 360; d += 2) {
    const len = d % 30 === 0 ? 26 : d % 10 === 0 ? 16 : 8;
    const [x1, y1] = pol(C, C, 478, d), [x2, y2] = pol(C, C, 478 - len, d);
    s += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`;
  }
  s += `</g>`;
  s += `<g stroke="${V}" stroke-width="1"><circle cx="${C}" cy="${C}" r="420"/><circle cx="${C}" cy="${C}" r="300" stroke-dasharray="2 7"/><circle cx="${C}" cy="${C}" r="180"/></g>`;
  // twelve houses
  s += `<g stroke="${V}" stroke-width=".8">`;
  for (let d = 15; d < 360; d += 30) { const [x1, y1] = pol(C, C, 180, d), [x2, y2] = pol(C, C, 420, d); s += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`; }
  s += `</g>`;
  // markers in each house
  for (let d = 0; d < 360; d += 30) { const [x, y] = pol(C, C, 450, d); s += d % 90 === 0 ? star(x, y, 9, G) : `<circle cx="${x}" cy="${y}" r="3" fill="${G}"/>`; }
  // hexagram
  const tri = (o) => [0, 120, 240].map((d) => pol(C, C, 300, d + o).join(" ")).join(" L");
  s += `<g stroke="${M}" stroke-width="1"><path d="M${tri(0)}Z"/><path d="M${tri(60)}Z"/></g>`;
  // seed of life
  s += `<g stroke="${G}" stroke-width="1"><circle cx="${C}" cy="${C}" r="90"/>`;
  for (let d = 0; d < 360; d += 60) { const [x, y] = pol(C, C, 90, d); s += `<circle cx="${x}" cy="${y}" r="90"/>`; }
  s += `</g>`;
  // the rete: an offset ecliptic ring and a pointer
  s += `<g stroke="${V}" stroke-width="1.1"><circle cx="${C}" cy="${C - 70}" r="330"/></g>`;
  s += `<circle cx="${C}" cy="${C}" r="5" fill="${M}"/>`;
  s += `</svg>`;
  writeFileSync(`${out}/astrolabe.svg`, s);
}

// 2. Star field tile.
{
  let s = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 480 480">`;
  for (let i = 0; i < 46; i++) {
    const x = f(rnd() * 480), y = f(rnd() * 480), r = f(.5 + rnd() * 1.1), o = f(.25 + rnd() * .55);
    s += `<circle cx="${x}" cy="${y}" r="${r}" fill="#3b2db8" fill-opacity="${o}"/>`;
  }
  for (let i = 0; i < 4; i++) s += star(f(30 + rnd() * 420), f(30 + rnd() * 420), f(4 + rnd() * 4), "#c08a2e");
  s += `</svg>`;
  writeFileSync(`${out}/stars.svg`, s);
}

// 3. Orbits: tilted ellipses with bodies, for behind the application.
{
  const cx = 700, cy = 500;
  let s = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1400 1000" fill="none">`;
  const rings = [[640, 250, -14, "#5b3cf0", ""], [560, 330, 22, "#c08a2e", "3 8"], [470, 190, 8, "#c2399a", ""], [680, 420, -30, "#5b3cf0", "1 6"]];
  rings.forEach(([rx, ry, rot, col, dash], i) => {
    s += `<g transform="rotate(${rot} ${cx} ${cy})"><ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" stroke="${col}" stroke-width="1.1"${dash ? ` stroke-dasharray="${dash}"` : ""}/>`;
    const t = [.6, 2.4, 4.1, 5.3][i];
    s += `<circle cx="${f(cx + rx * Math.cos(t))}" cy="${f(cy + ry * Math.sin(t))}" r="${[6, 4, 5, 3.5][i]}" fill="${col}"/></g>`;
  });
  s += `</svg>`;
  writeFileSync(`${out}/orbits.svg`, s);
}

// 4. Constellations for the night footer (light strokes).
{
  let s = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 300" fill="none">`;
  const groups = [[[80, 210], [150, 160], [230, 175], [290, 110], [360, 130]], [[520, 70], [580, 120], [650, 100], [700, 170], [640, 230]], [[880, 200], [940, 140], [1010, 160], [1060, 90], [1130, 120]]];
  for (const g of groups) {
    s += `<path d="M${g.map((p) => p.join(" ")).join(" L")}" stroke="#ffffff" stroke-opacity=".22" stroke-width="1"/>`;
    for (const [x, y] of g) s += `<circle cx="${x}" cy="${y}" r="2.2" fill="#ffffff" fill-opacity=".7"/>`;
  }
  for (let i = 0; i < 70; i++) s += `<circle cx="${f(rnd() * 1200)}" cy="${f(rnd() * 300)}" r="${f(.4 + rnd() * .9)}" fill="#ffffff" fill-opacity="${f(.2 + rnd() * .5)}"/>`;
  s += star(470, 230, 7, "#f2c66d") + star(800, 60, 5, "#f2c66d");
  s += `</svg>`;
  writeFileSync(`${out}/constellations.svg`, s);
}
