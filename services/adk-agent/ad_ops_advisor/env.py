from __future__ import annotations

import os
from pathlib import Path


def load_local_env() -> None:
    """Load local .env values for the standalone agent server.

    The root npm scripts run this service directly with stdlib Python, so we
    avoid adding python-dotenv just to support local secret files.
    """
    for path in _candidate_env_files():
        if path.exists():
            _load_env_file(path)


def _candidate_env_files() -> list[Path]:
    service_root = Path(__file__).resolve().parents[1]
    repo_root = service_root.parents[1]
    return [
        repo_root / ".env",
        service_root / ".env",
    ]


def _load_env_file(path: Path) -> None:
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = value
