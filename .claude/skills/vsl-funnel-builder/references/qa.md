# QA before deploy

## Mock Claude API + webhook (save as /tmp/.../mock.mjs, run with node)
```js
import http from "node:http";
http.createServer((req, res) => { let d = ""; req.on("data", c => d += c); req.on("end", () => {
  res.setHeader("content-type", "application/json");
  if (req.url === "/hook") return res.end("{}");
  const b = JSON.parse(d);
  const out = { name: "Demo", summary: "Demo tool", components: ["A"], day1: ["x"], day2: ["y"], estimate_days: 6, risks: ["z"] }; // match the tool schema
  res.end(JSON.stringify({ id: "m", type: "message", role: "assistant", model: b.model, stop_reason: "end_turn",
    usage: { input_tokens: 1, output_tokens: 1 }, content: [{ type: "text", text: JSON.stringify(out) }] }));
}); }).listen(8799);
```

## Run locally
```bash
npx wrangler pages dev public --port 8791 \
  --binding ANTHROPIC_API_KEY=test --binding ANTHROPIC_BASE_URL=http://127.0.0.1:8799 \
  --binding WEBHOOK_URL=http://127.0.0.1:8799/hook --binding CALENDAR_URL=https://cal.com/demo
```
Do not use `pkill -f` with a pattern that matches your own shell. Kill by PID from `ps aux | grep`.

## Playwright checks (`require('/opt/node22/lib/node_modules/playwright')`)
- EN and NO: the generator returns a result; the application completes all 5 steps and lands on the thank-you page with the booking button visible.
- Screenshots at 1280×900 (full page) and 390×844. Add `.in` to `.rv` before capture.
- `document.documentElement.scrollWidth > innerWidth` must be false. No `pageerror`.

## Live smoke test
`curl` every route for a 200, and check that a unique headline string is present (add `?v=$(date +%s)` to bypass the cache).
