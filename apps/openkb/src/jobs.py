"""
OpenKB Job Queue — Redis-based async compile job queue.

의존성: config (redis url/keys)
"""
from __future__ import annotations

import io
import json
import sys
import uuid
from typing import Any

from config import OpenKbConfig


def _r() -> Any:
    import redis as _r
    cfg = OpenKbConfig.from_env()
    return _r.from_url(cfg.redis_url, decode_responses=True)


def enqueue_job(selections: dict) -> str:
    r = _r()
    cfg = OpenKbConfig.from_env()
    job_id = str(uuid.uuid4())[:8]
    payload = {"job_id": job_id, "selections": selections, "status": "queued"}
    r.set(f"{cfg.redis_job_prefix}{job_id}", json.dumps(payload))
    r.rpush(cfg.redis_queue, job_id)
    return job_id


def run_worker() -> None:
    from pipeline import compile_command

    cfg = OpenKbConfig.from_env()
    r = _r()
    print(f"\U0001f9e0 OpenKB Worker started (queue: {cfg.redis_queue})")

    while True:
        try:
            _, job_id = r.blpop(cfg.redis_queue, timeout=0)
        except (KeyboardInterrupt, SystemExit):
            break

        raw = r.get(f"{cfg.redis_job_prefix}{job_id}")
        if not raw:
            continue

        job: dict = json.loads(raw)
        selections = job.get("selections", {})
        r.set(f"{cfg.redis_job_prefix}{job_id}", json.dumps({**job, "status": "running"}))

        buf = io.StringIO()
        old_stdout = sys.stdout
        sys.stdout = buf
        exit_code = 0
        try:
            compile_command(**selections)
        except SystemExit as e:
            exit_code = e.code if e.code is not None else 1
        except Exception as e:
            print(f"\u274c Error: {e}")
            exit_code = 1
        finally:
            sys.stdout = old_stdout

        output = buf.getvalue()
        r.set(f"{cfg.redis_result_prefix}{job_id}", json.dumps({
            "job_id": job_id, "output": output, "exit_code": exit_code,
        }))
        r.set(f"{cfg.redis_job_prefix}{job_id}", json.dumps({
            **job, "status": "failed" if exit_code else "completed", "exit_code": exit_code,
        }))
        r.lpush(cfg.redis_history_key, json.dumps({
            "job_id": job_id, "status": "failed" if exit_code else "completed",
            "selections": selections, "exit_code": exit_code,
        }))
        r.ltrim(cfg.redis_history_key, 0, 19)

        status = "\u274c Failed" if exit_code else "\u2705 Completed"
        print(f"{status} job={job_id} (exit={exit_code})")


def list_jobs(limit: int = 20) -> list[dict]:
    cfg = OpenKbConfig.from_env()
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
    cfg = OpenKbConfig.from_env()
    r = _r()
    return r.get(f"{cfg.redis_progress_prefix}{job_id}") or ""


def get_job_result(job_id: str) -> dict | None:
    cfg = OpenKbConfig.from_env()
    r = _r()
    raw = r.get(f"{cfg.redis_result_prefix}{job_id}")
    return json.loads(raw) if raw else None
