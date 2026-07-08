from __future__ import annotations

import os
import subprocess
from dataclasses import dataclass, field
from pathlib import Path
from typing import ClassVar


def _detect_project_root() -> Path:
    if Path("/data").exists():
        return Path("/data")
    try:
        out = subprocess.check_output(
            ["git", "rev-parse", "--show-toplevel"],
            stderr=subprocess.DEVNULL, text=True,
        ).strip()
        if out:
            return Path(out) / "data"
    except Exception:
        pass
    return Path.home() / "workspace/scraper/data"


def _env(key: str, default: str) -> str:
    return os.environ.get(key, default)


@dataclass
class PreprocessConfig:
    project_root: Path = field(default_factory=_detect_project_root)
    output_dir: str = "preprocessed"

    # === LLM ===
    llm_engine: str = "ollama"
    llm_model: str = "qwen3.5:9b-mlx"
    ollama_host: str = "127.0.0.1"
    engine_ports: dict[str, int] = field(default_factory=lambda: {
        "ollama": 11434, "llama.cpp": 8080, "unsloth": 8888,
    })

    _instance: ClassVar[PreprocessConfig | None] = None

    def __post_init__(self) -> None:
        if Path("/data").exists():
            self.ollama_host = _env("OLLAMA_HOST", "host.docker.internal")
        self.llm_engine = _env("LLM_ENGINE", self.llm_engine)
        self.llm_model = _env("LLM_MODEL", self.llm_model)

    @property
    def llm_api_base(self) -> str:
        port = self.engine_ports.get(self.llm_engine, 11434)
        return f"http://{self.ollama_host}:{port}"

    @property
    def source_dirs(self) -> list[Path]:
        return [
            self.project_root / "agents",
            self.project_root / "joplin",
        ]

    @classmethod
    def from_env(cls) -> PreprocessConfig:
        if cls._instance is not None:
            return cls._instance
        cfg = cls()
        cls._instance = cfg
        return cfg

    @classmethod
    def reset_instance(cls) -> None:
        cls._instance = None
