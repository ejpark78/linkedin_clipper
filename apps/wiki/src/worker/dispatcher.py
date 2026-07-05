"""Worker dispatcher — consumes Redis jobs and routes to pipeline plugins."""

from __future__ import annotations

import io
import json
import os
import sys
from typing import Any


def _r() -> Any:
    import redis as _r
    return _r.from_url(os.environ.get("REDIS_URL", "redis://redis:6379"), decode_responses=True)


def get_queue_config() -> dict:
    return {
        "queue": os.environ.get("WIKI_QUEUE", "wiki:queue"),
        "job_prefix": os.environ.get("WIKI_JOB_PREFIX", "wiki:job:"),
        "progress_prefix": os.environ.get("WIKI_PROGRESS_PREFIX", "wiki:progress:"),
        "result_prefix": os.environ.get("WIKI_RESULT_PREFIX", "wiki:result:"),
        "history_key": os.environ.get("WIKI_HISTORY_KEY", "wiki:history"),
    }


def run_worker() -> None:
    from plugins.openkb import compile as run_openkb_compile
    from preprocess.pipeline import run as run_preprocess

    qcfg = get_queue_config()
    r = _r()
    print(f"  Wiki Worker started (queue: {qcfg['queue']})")

    while True:
        try:
            _, job_id = r.blpop(qcfg["queue"], timeout=0)
        except (KeyboardInterrupt, SystemExit):
            break

        raw = r.get(f"{qcfg['job_prefix']}{job_id}")
        if not raw:
            continue

        job: dict = json.loads(raw)
        job_type = job.get("type", "preprocess")
        params = job.get("params", {})
        r.set(f"{qcfg['job_prefix']}{job_id}", json.dumps({**job, "status": "running"}))

        buf = io.StringIO()
        old_stdout = sys.stdout
        sys.stdout = buf
        exit_code = 0
        try:
            if job_type == "preprocess":
                run_preprocess(**params)
            elif job_type == "openkb":
                run_openkb_compile(**params)
            else:
                print(f"Unknown job type: {job_type}")
                exit_code = 1
        except SystemExit as e:
            exit_code = e.code if e.code is not None else 1
        except Exception as e:
            print(f"  Error: {e}")
            exit_code = 1
        finally:
            sys.stdout = old_stdout

        output = buf.getvalue()
        r.set(f"{qcfg['result_prefix']}{job_id}", json.dumps({
            "job_id": job_id, "output": output, "exit_code": exit_code,
        }))
        r.set(f"{qcfg['job_prefix']}{job_id}", json.dumps({
            **job, "status": "failed" if exit_code else "completed", "exit_code": exit_code,
        }))
        r.lpush(qcfg["history_key"], json.dumps({
            "job_id": job_id, "type": job_type,
            "status": "failed" if exit_code else "completed",
            "params": params, "exit_code": exit_code,
        }))
        r.ltrim(qcfg["history_key"], 0, 19)

        status = "Failed" if exit_code else "Completed"
        print(f"  {status} job={job_id} type={job_type} (exit={exit_code})")
