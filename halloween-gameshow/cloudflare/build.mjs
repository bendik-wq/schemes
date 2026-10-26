// Bygger public/ fra spillets ene kildefil.
// halloween-gameshow/index.html er skrevet uten <html>-skjelett (slik Artifacts vil ha det),
// så her pakker vi den inn før Cloudflare serverer den.
import { readFileSync, writeFileSync, copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, "..", "index.html"), "utf8");
mkdirSync(join(here, "public"), { recursive: true });

const page = `<!doctype html>
<html lang="nb">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<style>:root{padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}body{margin:0}img{max-width:100%}[hidden]{display:none!important}</style>
<script src="/qrcode.js"></script>
</head>
<body>
${src}
</body>
</html>
`;
writeFileSync(join(here, "public", "index.html"), page);
copyFileSync(join(here, "node_modules", "qrcode-generator", "qrcode.js"), join(here, "public", "qrcode.js"));
console.log("Bygget public/index.html og public/qrcode.js");
