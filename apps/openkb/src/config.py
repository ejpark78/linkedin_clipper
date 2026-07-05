"""
OpenKB Configuration — Centralized config with env injection.

설계:
  - 모든 환경변수는 이 모듈에서만 접근합니다.
  - OpenKbConfig.from_env() → singleton config instance.
  - 소비자는 config 객체를 생성자/함수 인자로 주입받습니다.
"""
from __future__ import annotations

import subprocess
from dataclasses import dataclass, field
from pathlib import Path
from typing import ClassVar


@dataclass
class OpenKbConfig:
    # === Paths ===
    project_root: Path = Path("/data")

    # === LLM Engine ===
    ollama_host: str = "127.0.0.1"
    engine_ports: dict[str, int] = field(default_factory=lambda: {
        "ollama": 11434, "llama.cpp": 8080, "unsloth": 8888,
    })

    # === Redis ===
    redis_url: str = "redis://redis:6379"
    redis_queue: str = "openkb:queue"
    redis_job_prefix: str = "openkb:job:"
    redis_progress_prefix: str = "openkb:progress:"
    redis_result_prefix: str = "openkb:result:"
    redis_history_key: str = "openkb:history"

    # === Output mirror (OPENKB_OUTPUT_PREFIX) ===
    output_prefix: str = ""

    # === Queue timeouts ===
    blpop_timeout: int = 0
    progress_interval: float = 5.0

    # Derived (computed in __post_init__)
    dump_dir: Path = field(init=False)
    joplin_dir: Path = field(init=False)
    openkb_dir: Path = field(init=False)
    default_raw_store: Path = field(init=False)
    default_cache_path: Path = field(init=False)

    # Class-level cache (lazy singleton by environment)
    _instance: ClassVar[OpenKbConfig | None] = None

    def __post_init__(self) -> None:
        self.dump_dir = (self.project_root / "agents").resolve()
        self.joplin_dir = (self.project_root / "joplin").resolve()
        self.openkb_dir = (self.project_root / "openkb").resolve()
        self.default_raw_store = self.openkb_dir / "raw"
        self.default_cache_path = self.openkb_dir / ".openkb_cache.json"

    @property
    def ollama_api_base(self) -> str:
        return f"http://{self.ollama_host}:{self.engine_ports['ollama']}"

    @property
    def openai_api_base(self) -> str:
        return f"http://{self.ollama_host}:{self.engine_ports['ollama']}/v1"

    def api_url(self, engine: str) -> str:
        port = self.engine_ports.get(engine, 11434)
        return f"http://{self.ollama_host}:{port}"

    @classmethod
    def from_env(cls) -> OpenKbConfig:
        if cls._instance is not None:
            return cls._instance

        # Detect docker vs host
        if Path("/data").exists():
            project_root = Path("/data")
            ollama_host = os_environ("OLLAMA_HOST", "host.docker.internal")
        else:
            git_root = _detect_git_root()
            project_root = (git_root / "data") if git_root else Path.home() / "workspace/scraper/data"
            ollama_host = os_environ("OLLAMA_HOST", "127.0.0.1")

        cfg = cls(
            project_root=project_root.resolve(),
            ollama_host=ollama_host,
            redis_url=os_environ("REDIS_URL", "redis://redis:6379"),
            redis_queue=os_environ("OPENKB_QUEUE", "openkb:queue"),
            output_prefix=os_environ("OPENKB_OUTPUT_PREFIX", "data/obsidian"),
        )
        cls._instance = cfg
        return cfg

    @classmethod
    def reset_instance(cls) -> None:
        cls._instance = None


def os_environ(key: str, default: str) -> str:
    import os
    return os.environ.get(key, default)


def _detect_git_root() -> Path | None:
    try:
        out = subprocess.check_output(
            ["git", "rev-parse", "--show-toplevel"],
            stderr=subprocess.DEVNULL, text=True,
        ).strip()
        return Path(out) if out else None
    except Exception:
        return None
