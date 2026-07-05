"""
OpenKB Compile Pipeline — 문서 수집 → 정규화 → 메타데이터 추출 → raw 저장 → openkb add.

의존성: config, cache, metadata, llm, handlers
"""
from __future__ import annotations

import os
import subprocess
from pathlib import Path
from typing import Any

from cache import OpenKbCache
from config import OpenKbConfig
from handlers import make_handlers, SourceHandler
from llm import LLMClient


class CompilePipeline:
    def __init__(self, cfg: OpenKbConfig | None = None) -> None:
        self.cfg = cfg or OpenKbConfig.from_env()
        self.handlers: list[SourceHandler] = make_handlers(self.cfg)

    def run(
        self,
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
        full_rebuild: bool = False,
        llama_port: int = 8080,
    ) -> None:
        print(f"\U0001f916 OpenKB Compile Pipeline (engine: {engine})")
        model = self._resolve_model(model, engine)
        print(f"\U0001f9e0 Model: [{model or 'auto'}]")

        self._start_llama_if_needed(engine, model, llama_port)
        if not LLMClient.check_health(engine, model, api_key):
            print("\u274c Pipeline aborted: LLM health check failed.")
            LLMClient.stop_llama_server()
            exit(1)

        input_dirs = self._resolve_input_dirs(input_paths)
        raw_store, cache_path = self._resolve_output(output, input_dirs[0] if input_dirs else None)

        if full_rebuild:
            self._clear_raw(raw_store, cache_path)
        raw_store.mkdir(parents=True, exist_ok=True)

        cache = OpenKbCache(cache_path)

        date_from_dt = self._parse_date(date_from or os.environ.get("DATE_FROM"))
        date_to_dt = self._parse_date(date_to or os.environ.get("DATE_TO"))
        sample_val = self._resolve_sample(sample)

        filter_args: dict = {}
        if agents:
            filter_args["agent_types"] = agents
        if joplin_notebooks:
            filter_args["joplin_notebooks"] = joplin_notebooks

        total_processed = 0
        total_skipped = 0

        for input_dir in input_dirs:
            dir_result = self._process_input_dir(
                input_dir, raw_store, cache, no_cache, sample_val,
                date_from_dt, date_to_dt, filter_args,
                model, engine, api_key,
            )
            total_processed += dir_result["processed"]
            total_skipped += dir_result["skipped"]

        for handler in self.handlers:
            handler.post_process(input_dirs, raw_store)

        print(f"\u2728 Processed: {total_processed} | Skipped: {total_skipped}")

        self._clean_orphans(raw_store, cache, full_rebuild)

        if total_processed == 0:
            print("\u23ed\ufe0f No changes detected. Skipping openkb add.")
            LLMClient.stop_llama_server()
            return

        kb_root = raw_store.parent
        print(f"\U0001f9e0 Running openkb add (KB: {kb_root})...")
        _run_openkb_add(raw_store, engine, model, api_key, kb_root)
        LLMClient.stop_llama_server()

    def _process_input_dir(
        self, input_dir: Path,
        raw_store: Path, cache: OpenKbCache, no_cache: bool, sample: int | None,
        date_from: str | None, date_to: str | None,
        filter_args: dict,
        model: str | None, engine: str, api_key: str | None,
    ) -> dict:
        result: dict = {"processed": 0, "skipped": 0, "handler": ""}

        for handler in self.handlers:
            if not handler.detect(input_dir):
                continue
            result["handler"] = handler.name
            files = handler.collect_files(input_dir)
            files = handler.filter_files(files, date_from, date_to, filter_args)
            print(f"\U0001f4c1 [{handler.name}] {input_dir.name}: {len(files)} file(s)")

            processed = 0
            skipped = 0
            for file_path in files:
                if sample is not None and processed >= sample:
                    print(f"   \U0001f9ea Sample limit {sample} reached.")
                    break
                p, s = handler.process_file(
                    file_path, input_dir, raw_store, cache, no_cache,
                    model, engine, api_key,
                )
                processed += p
                skipped += s
            result["processed"] = processed
            result["skipped"] = skipped
            break

        return result

    def _resolve_output(self, output_path: str | None, input_dir: Path | None) -> tuple[Path, Path]:
        if output_path:
            root = Path(output_path).resolve()
        elif input_dir and self.cfg.output_prefix:
            try:
                rel = input_dir.relative_to(self.cfg.project_root)
            except ValueError:
                rel = input_dir
            root = Path(self.cfg.output_prefix).resolve() / rel
        else:
            root = self.cfg.openkb_dir
        return root / "raw", root / "cache.json"

    def _resolve_model(self, model: str | None, engine: str) -> str | None:
        if model:
            return model
        raw = os.environ.get("OLLAMA_MODEL") or os.environ.get("LLM_MODEL")
        if raw:
            return raw
        if engine == "ollama":
            preferred = os.environ.get("LLM_MODEL", "qwen3.5:9b-mlx")
            models = LLMClient.list_models("ollama")
            return preferred if preferred in models else (models[0] if models else preferred)
        return None

    def _start_llama_if_needed(self, engine: str, model: str | None, port: int) -> None:
        if engine == "llama.cpp" and model:
            p = Path(model)
            if p.is_file() and p.suffix == ".gguf":
                LLMClient.start_llama_server(model, port=port)

    def _clear_raw(self, raw_store: Path, cache_path: Path) -> None:
        print(f"\U0001f9f9 Full rebuild: clearing {raw_store}...")
        if raw_store.exists():
            for item in raw_store.iterdir():
                if item.is_file():
                    item.unlink()
        cache_path.unlink(missing_ok=True)

    def _resolve_input_dirs(self, input_paths: tuple[str, ...] | None) -> list[Path]:
        if input_paths:
            result: list[Path] = []
            for p in input_paths:
                pp = Path(p)
                if pp.is_absolute():
                    result.append(pp)
                else:
                    cand = self.cfg.project_root / pp
                    if not cand.exists():
                        cand = Path.cwd().joinpath(pp)
                    result.append(cand)
            return result
        raw_env = os.environ.get("RAW", "data/agents,data/joplin")
        targets = [t.strip() for t in raw_env.split(",") if t.strip()]
        result: list[Path] = []
        for t in targets:
            parts = Path(t).parts
            sub = Path(*parts[1:]) if len(parts) > 1 and parts[0] == "data" else Path(t)
            result.append(self.cfg.project_root / sub)
        return result

    @staticmethod
    def _resolve_sample(sample: int | None) -> int | None:
        if sample is not None:
            return sample
        sample_env = os.environ.get("SAMPLE")
        return int(sample_env) if sample_env and sample_env.strip().isdigit() else None

    @staticmethod
    def _parse_date(s: str | None) -> str | None:
        if not s:
            return None
        s = s.strip()
        import re
        return s if re.match(r"^\d{4}-\d{2}-\d{2}$", s) else None

    @staticmethod
    def _clean_orphans(raw_store: Path, cache: OpenKbCache, full_rebuild: bool) -> None:
        if not raw_store.exists() or full_rebuild:
            return
        known = cache.get_raw_names()
        for sub in raw_store.iterdir():
            if not sub.is_dir() or sub.name == "images":
                continue
            for f in sub.iterdir():
                if f.is_file() and f"{sub.name}/{f.name}" not in known:
                    print(f"   \U0001f5d1\ufe0f Orphan raw file: {sub.name}/{f.name}")
                    f.unlink()
            if not list(sub.iterdir()):
                sub.rmdir()


# ====================================================================
# Public API
# ====================================================================

def compile_command(**kwargs: Any) -> None:
    CompilePipeline().run(**kwargs)


def _run_openkb_add(raw_store: Path, engine: str, model: str | None, api_key: str | None, kb_root: Path) -> None:
    env = os.environ.copy()
    cfg = OpenKbConfig.from_env()

    kb_root.mkdir(parents=True, exist_ok=True)
    (kb_root / ".openkb").mkdir(parents=True, exist_ok=True)
    (kb_root / ".config" / "openkb").mkdir(parents=True, exist_ok=True)
    model_ref = model or "default"
    if engine == "llama.cpp":
        config_model = f"openai/{model_ref}"
        config_base = f"http://{cfg.ollama_host}:{cfg.engine_ports['llama.cpp']}/v1"
    else:
        config_model = f"{engine}/{model_ref}"
        config_base = f"http://{cfg.ollama_host}:{cfg.engine_ports['ollama']}"
    (kb_root / ".openkb" / "config.yaml").write_text(
        f"model: {config_model}\napi_base: {config_base}\napi_key: anything\nlanguage: ko\npageindex_threshold: 20\n"
    )
    (kb_root / ".config" / "openkb" / "global.yaml").write_text(
        f"default_kb: {kb_root}\nknown_kbs:\n- {kb_root}\n"
    )
    env["OPENKB_HOME"] = str(kb_root.resolve())
    env["HOME"] = str(kb_root.resolve())

    if engine == "ollama":
        env["OPENAI_API_BASE"] = f"http://{cfg.ollama_host}:11434/v1"
    elif engine == "llama.cpp":
        env["OPENAI_API_BASE"] = f"http://{cfg.ollama_host}:8080/v1"
    elif engine == "unsloth":
        env["OPENAI_API_BASE"] = f"http://{cfg.ollama_host}:8888/v1"
        if api_key:
            env["OPENAI_API_KEY"] = api_key
    if model:
        env["LLM_MODEL"] = model
    if not env.get("LLM_API_KEY"):
        env["LLM_API_KEY"] = "ollama"
    if not env.get("OPENAI_API_KEY"):
        env["OPENAI_API_KEY"] = "ollama"

    try:
        subprocess.run(["openkb", "add", str(raw_store)], env=env, check=True, cwd=str(kb_root))
        print("\u2705 OpenKB compile complete.")
    except subprocess.CalledProcessError as e:
        print(f"\u274c openkb add failed: {e}")
        exit(1)
