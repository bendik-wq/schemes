"""Lokalt web-grensesnitt: `python3 -m betting ui` og åpne http://127.0.0.1:8765."""
from __future__ import annotations

import json
import traceback
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from . import service

UI = Path(__file__).with_name("ui.html")
ROUTES = {"scan": service.scan, "teams": service.teams, "predict": service.predict, "backtest": service.backtest}


class Handler(BaseHTTPRequestHandler):
    def _send(self, code: int, body: bytes, ctype: str) -> None:
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:
        if self.path in ("/", "/index.html"):
            self._send(200, UI.read_bytes(), "text/html; charset=utf-8")
        else:
            self._send(404, b"not found", "text/plain")

    def do_POST(self) -> None:
        name = self.path.removeprefix("/api/")
        fn = ROUTES.get(name)
        if fn is None:
            return self._send(404, b'{"error":"ukjent endepunkt"}', "application/json")
        try:
            length = int(self.headers.get("Content-Length") or 0)
            params = json.loads(self.rfile.read(length) or b"{}")
            result = fn(params)
            self._send(200, json.dumps(result, ensure_ascii=False).encode(), "application/json")
        except Exception as e:  # noqa: BLE001 – feilen vises i grensesnittet
            traceback.print_exc()
            self._send(400, json.dumps({"error": f"{type(e).__name__}: {e}"}, ensure_ascii=False).encode(),
                       "application/json")

    def log_message(self, fmt: str, *args) -> None:
        print(f"[ui] {self.address_string()} {fmt % args}")


def serve(host: str = "127.0.0.1", port: int = 8765, open_browser: bool = True) -> None:
    httpd = ThreadingHTTPServer((host, port), Handler)
    url = f"http://{host}:{port}"
    print(f"Betting-UI kjører på {url}  (Ctrl+C for å stoppe)")
    if open_browser:
        webbrowser.open(url)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
