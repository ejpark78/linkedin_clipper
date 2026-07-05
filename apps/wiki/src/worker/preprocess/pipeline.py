"""Preprocess pipeline — handlers.process_file() 기반, .md 출력 + entities.jsonl."""

from __future__ import annotations

import time
from pathlib import Path
from typing import Any

from .cache import FileCache
from .config import PreprocessConfig
from .handlers import detect_handler
from .llm_client import check_health


def run(
    input_paths: tuple[str, ...] | None = None,
    output: str | None = None,
    agents: tuple[str, ...] | None = None,
    joplin_notebooks: tuple[str, ...] | None = None,
    date_from: str | None = None,
    date_to: str | None = None,
    sample: int | None = None,
    model: str | None = None,
    engine: str = "ollama",
    api_key: str | None = None,
    no_cache: bool = False,
    chunk_size: int = 2000,
) -> None:
    cfg = PreprocessConfig.from_env()
    input_dirs = _resolve_input_dirs(input_paths, cfg)

    output_path = Path(output or cfg.output_dir)
    if not output_path.is_absolute():
        output_path = cfg.project_root / output_path
    raw_store = output_path / "raw"
    cache = FileCache(output_path / "cache.json")
    entities_path = output_path / "entities.jsonl"

    output_path.mkdir(parents=True, exist_ok=True)
    raw_store.mkdir(parents=True, exist_ok=True)

    if not check_health(engine, model):
        print("  LLM health check failed. Is Ollama running?")
        exit(1)

    filter_args: dict[str, Any] = {}
    if agents:
        filter_args["agent_types"] = agents
    if joplin_notebooks:
        filter_args["joplin_notebooks"] = joplin_notebooks

    total_processed = 0
    total_skipped = 0
    pipeline_start = time.time()

    en_out = open(entities_path, "w", encoding="utf-8")

    try:
        for input_dir in input_dirs:
            handler = detect_handler(input_dir, cfg)
            if not handler:
                print(f"  No handler for {input_dir}")
                continue

            files = handler.collect_files(input_dir)
            files = handler.filter_files(files, date_from, date_to, filter_args)
            print(f"  [{handler.name}] {len(files)} file(s)")
            print("  📊 ETA 계산: 첫 파일 처리 후 예상 시간 표시")

            processed = 0
            file_times: list[float] = []
            for file_path in files:
                if sample and processed >= sample:
                    print(f"  Sample limit {sample} reached.")
                    break

                file_start = time.time()
                p, s = handler.process_file(
                    file_path, input_dir, raw_store, cache, no_cache,
                    model, engine, api_key,
                    entities_writer=en_out, chunk_size=chunk_size,
                )
                file_elapsed = time.time() - file_start
                processed += p
                total_processed += p
                total_skipped += s

                if p and file_elapsed > 1:
                    file_times.append(file_elapsed)
                    remaining = len(files) - processed
                    avg = sum(file_times) / len(file_times)
                    eta = avg * remaining
                    pct = processed / len(files) * 100
                    print(f"  📊 진행률: {processed}/{len(files)} ({pct:.0f}%) - ETA: ~{eta:.0f}s ({avg:.0f}s/file)")

            handler.post_process([input_dir], raw_store)

        print(f"  Processed: {total_processed} | Skipped: {total_skipped}")
        total_elapsed = time.time() - pipeline_start
        print(f"  Total time: {total_elapsed:.1f}s")
        print(f"  Output: {output_path}/")

    finally:
        en_out.close()


def _resolve_input_dirs(
    input_paths: tuple[str, ...] | None,
    cfg: PreprocessConfig,
) -> list[Path]:
    if input_paths:
        result: list[Path] = []
        for p in input_paths:
            pp = Path(p)
            if pp.is_absolute():
                result.append(pp)
            else:
                cand = cfg.project_root / pp
                if not cand.exists():
                    cand = Path.cwd().joinpath(pp)
                result.append(cand)
        return result
    return cfg.source_dirs
