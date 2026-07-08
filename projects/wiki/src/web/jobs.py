"""Job queue — Redis-based async job enqueue/list."""

from __future__ import annotations

import json
import uuid
from typing import Any

from .config import WebConfig


def _r() -> Any:
    import redis as _r
    cfg = WebConfig.from_env()
    return _r.from_url(cfg.redis_url, decode_responses=True)


def enqueue_job(job_type: str, params: dict) -> str:
    r = _r()
    cfg = WebConfig.from_env()
    job_id = str(uuid.uuid4())[:8]
    payload = {"job_id": job_id, "type": job_type, "params": params, "status": "queued"}
    r.set(f"{cfg.redis_job_prefix}{job_id}", json.dumps(payload))
    r.rpush(cfg.redis_queue, job_id)
    return job_id


def list_jobs(limit: int = 20) -> list[dict]:
    cfg = WebConfig.from_env()
    r = _r()
    jobs: list[dict] = []

    for key in r.scan_iter(f"{cfg.redis_job_prefix}*"):
        raw = r.get(key)
        if raw:
            job = json.loads(raw)
            if job.get("status") in ("running", "queued"):
                jobs.append(job)

    for item in r.lrange(cfg.redis_history_key, 0, limit - 1):
        jobs.append(json.loads(item))

    jobs.sort(key=lambda j: j.get("created_at", ""), reverse=True)
    return jobs[:limit]


def get_job_progress(job_id: str) -> str:
    cfg = WebConfig.from_env()
    r = _r()
    return r.get(f"{cfg.redis_progress_prefix}{job_id}") or ""


def get_job_result(job_id: str) -> dict | None:
    cfg = WebConfig.from_env()
    r = _r()
    raw = r.get(f"{cfg.redis_result_prefix}{job_id}")
    return json.loads(raw) if raw else None
