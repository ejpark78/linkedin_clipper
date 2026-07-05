"""Web config — Redis connection settings."""

from __future__ import annotations

import os
from dataclasses import dataclass
from typing import ClassVar


@dataclass
class WebConfig:
    redis_url: str = "redis://redis:6379"
    redis_queue: str = "wiki:queue"
    redis_job_prefix: str = "wiki:job:"
    redis_progress_prefix: str = "wiki:progress:"
    redis_result_prefix: str = "wiki:result:"
    redis_history_key: str = "wiki:history"

    _instance: ClassVar[WebConfig | None] = None

    @classmethod
    def from_env(cls) -> WebConfig:
        if cls._instance is not None:
            return cls._instance
        cfg = cls(
            redis_url=os.environ.get("REDIS_URL", "redis://redis:6379"),
            redis_queue=os.environ.get("WIKI_QUEUE", "wiki:queue"),
        )
        cls._instance = cfg
        return cfg
