from __future__ import annotations

import json
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any

from .env import load_local_env

load_local_env()

from .chat_runtime import handle_chat
from .openai_agents_runtime import openai_agents_configuration_status
from .repositories import RepositoryError, is_database_configured
from .runtime import AgentRuntimeError, is_agent_runtime_configured, selected_agent_runtime
from .setup_intake_runtime import handle_setup_intake


HOST = os.environ.get("HOST", "0.0.0.0")
PORT = int(os.environ.get("PORT", "8000"))


class Handler(BaseHTTPRequestHandler):
    server_version = "AdOpsAdvisorOpenAIAgent/0.1"

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
            selected_runtime = selected_agent_runtime()
            runtime_configured = is_agent_runtime_configured()
            openai_runtime_status = openai_agents_configuration_status()
            production = os.environ.get("APP_ENV", "").strip().lower() == "production"
            runtime = selected_runtime if runtime_configured or production else "mock"
            data_safety_configured = (
                os.environ.get("OPENAI_AGENTS_TRACE_INCLUDE_SENSITIVE_DATA") == "0"
                and os.environ.get("OPENAI_AGENTS_DONT_LOG_MODEL_DATA") == "1"
                and os.environ.get("OPENAI_AGENTS_DONT_LOG_TOOL_DATA") == "1"
            )
            self._send_json(
                200,
                {
                    "ok": (not production)
                    or (runtime_configured and data_safety_configured and runtime in {"openai", "openai_agents"}),
                    "service": "openai-agent",
                    "mode": runtime,
                    "selectedRuntime": selected_runtime,
                    "runtimeConfigured": runtime_configured and runtime in {"openai", "openai_agents"},
                    "runtimeDiagnostics": openai_runtime_status,
                    "dataSafetyConfigured": data_safety_configured,
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
        if self.path not in {"/chat", "/setup-intake/message"}:
            self._send_json(404, {"error": "not found"})
            return

        length = int(self.headers.get("Content-Length", "0"))
        raw_body = self.rfile.read(length)

        try:
            payload = json.loads(raw_body.decode("utf-8")) if raw_body else {}
        except json.JSONDecodeError:
            self._send_json(400, {"error": "JSON bodyを読み取れませんでした。"})
            return

        required = ("workspaceId", "userId", "message") if self.path == "/setup-intake/message" else ("workspaceId", "userId", "threadId", "message")
        missing = [key for key in required if not str(payload.get(key, "")).strip()]
        if missing:
            self._send_json(400, {"error": f"必須項目が不足しています: {', '.join(missing)}"})
            return

        try:
            if self.path == "/setup-intake/message":
                self._send_json(200, handle_setup_intake(payload))
            else:
                self._send_json(200, handle_chat(payload))
        except AgentRuntimeError as exc:
            self._send_json(
                502,
                {
                    "error": "Agent runtime failed.",
                    "detail": str(exc),
                },
            )
        except RepositoryError as exc:
            self._send_json(403, {"error": str(exc)})

    def log_message(self, format: str, *args: Any) -> None:
        print(f"{self.address_string()} - {format % args}")


def main() -> None:
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"openai-agent listening on http://localhost:{PORT}")
    server.serve_forever()


if __name__ == "__main__":
    main()
