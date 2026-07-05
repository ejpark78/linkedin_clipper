"""
OpenKB — Backward-compat entry point. Re-exports from refactored modules.
"""
from __future__ import annotations

from pathlib import Path

# Deferred import — modules are loaded on first use
_imported = False

def _ensure() -> None:
    global _imported, PROJECT_ROOT, OLLAMA_HOST, ENGINE_PORTS, LLMClient, \
        OpenKbCache, OpenKbConfig, extract_title, extract_agent, \
        clean_broken_links, normalize_agent_content, COMPILE_ARGS, \
        enqueue_job, list_jobs, get_job_progress, get_job_result, \
        compile_command, DUMP_DIR, JOPLIN_DIR, OPENKB_DIR, RAW_STORE, CACHE_PATH, \
        _wrap_with_metadata
    if _imported:
        return
    from config import OpenKbConfig
    cfg = OpenKbConfig.from_env()

    global PROJECT_ROOT, OLLAMA_HOST, ENGINE_PORTS
    PROJECT_ROOT = cfg.project_root
    OLLAMA_HOST = cfg.ollama_host
    ENGINE_PORTS = cfg.engine_ports

    global DUMP_DIR, JOPLIN_DIR, OPENKB_DIR, RAW_STORE, CACHE_PATH
    DUMP_DIR = cfg.dump_dir
    JOPLIN_DIR = cfg.joplin_dir
    OPENKB_DIR = cfg.openkb_dir
    RAW_STORE = cfg.default_raw_store
    CACHE_PATH = cfg.default_cache_path

    from cache import OpenKbCache
    from llm import LLMClient
    from metadata import extract_title, extract_agent, clean_broken_links, normalize_agent_content, wrap_with_metadata as _wrap_with_metadata
    from queue import enqueue_job, run_worker, list_jobs, get_job_progress, get_job_result
    from pipeline import compile_command
    _imported = True


# Lazy exports
def __getattr__(name: str):
    _ensure()
    return globals()[name]


__all__ = [
    "PROJECT_ROOT", "OLLAMA_HOST", "ENGINE_PORTS",
    "DUMP_DIR", "JOPLIN_DIR", "OPENKB_DIR", "RAW_STORE", "CACHE_PATH",
    "OpenKbConfig", "OpenKbCache", "LLMClient",
    "extract_title", "extract_agent", "clean_broken_links",
    "normalize_agent_content", "_wrap_with_metadata",
    "enqueue_job", "list_jobs", "get_job_progress", "get_job_result",
    "compile_command",
]
