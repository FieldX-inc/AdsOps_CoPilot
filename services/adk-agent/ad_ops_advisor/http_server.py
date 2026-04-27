from __future__ import annotations

import json
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any

from .env import load_local_env

load_local_env()

from .chat_runtime import handle_chat
from .gemini_runtime import is_gemini_configured
from .repositories import RepositoryError, is_database_configured


HOST = os.environ.get("HOST", "0.0.0.0")
PORT = int(os.environ.get("PORT", "8000"))


class Handler(BaseHTTPRequestHandler):
    server_version = "AdOpsAdvisorAgent/0.1"

    def _send_json(self, status: int, payload: dict[str, Any]) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self) -> None:  # noqa: N802 - stdlib API
        self._send_json(200, {"ok": True})

    def do_GET(self) -> None:  # noqa: N802 - stdlib API
        if self.path == "/health":
            self._send_json(
                200,
                {
                    "ok": True,
                    "service": "adk-agent",
                    "mode": "gemini" if is_gemini_configured() else "mock",
                    "databaseConfigured": is_database_configured(),
                },
            )
            return

        if self.path == "/demo":
            self._send_json(
                200,
                handle_chat(
                    {
                        "workspaceId": "demo-workspace",
                        "userId": "demo-user",
                        "threadId": "demo-thread",
                        "message": "CPAが悪化している理由と次の確認手順を教えて",
                    }
                ),
            )
            return

        self._send_json(404, {"error": "not found"})

    def do_POST(self) -> None:  # noqa: N802 - stdlib API
        if self.path != "/chat":
            self._send_json(404, {"error": "not found"})
            return

        length = int(self.headers.get("Content-Length", "0"))
        raw_body = self.rfile.read(length)

        try:
            payload = json.loads(raw_body.decode("utf-8")) if raw_body else {}
        except json.JSONDecodeError:
            self._send_json(400, {"error": "JSON bodyを読み取れませんでした。"})
            return

        missing = [
            key
            for key in ("workspaceId", "userId", "threadId", "message")
            if not str(payload.get(key, "")).strip()
        ]
        if missing:
            self._send_json(400, {"error": f"必須項目が不足しています: {', '.join(missing)}"})
            return

        try:
            self._send_json(200, handle_chat(payload))
        except RepositoryError as exc:
            self._send_json(403, {"error": str(exc)})

    def log_message(self, format: str, *args: Any) -> None:
        print(f"{self.address_string()} - {format % args}")


def main() -> None:
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"adk-agent listening on http://localhost:{PORT}")
    server.serve_forever()


if __name__ == "__main__":
    main()
