"""
OpenKB Compile Pipeline — 문서 수집 → 정규화 → 메타데이터 추출 → raw 저장 → openkb add.

의존성: config, cache, metadata, llm
"""
from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
from pathlib import Path
from typing import Any

from cache import OpenKbCache
from config import OpenKbConfig
from llm import LLMClient
from metadata import extract_title, wrap_with_metadata


# ====================================================================
# Source scanner — 파일 탐색 및 필터링
# ====================================================================

class SourceScanner:
    def __init__(self, cfg: OpenKbConfig) -> None:
        self.cfg = cfg

    def find_agent_docs(self, src_dir: Path) -> list[Path]:
        results: list[Path] = []
        if not src_dir.exists():
            return results
        seen = set()
        for root, _, files in os.walk(src_dir):
            sid = Path(root).name
            if sid in seen:
                continue
            if "session.md" in files:
                results.append(Path(root) / "session.md")
                seen.add(sid)
            elif "transcript.md" in files:
                results.append(Path(root) / "transcript.md")
                seen.add(sid)
        return results

    def find_joplin_files(self, src_dir: Path) -> list[Path]:
        results: list[Path] = []
        if not src_dir.exists():
            return results
        for root, _, files in os.walk(src_dir):
            for f in files:
                if f.endswith(".md") and not f.startswith("."):
                    if ".tmp_export" in root:
                        continue
                    results.append(Path(root) / f)
        return results

    @staticmethod
    def filter_by_date(files: list[Path], date_from: str | None, date_to: str | None) -> list[Path]:
        if not date_from and not date_to:
            return files
        result: list[Path] = []
        for f in files:
            date_str = f.parent.parent.name
            m = re.match(r"(\d{4}-\d{2}-\d{2})", date_str)
            if not m:
                result.append(f)
                continue
            d = m.group(1)
            if date_from and d < date_from:
                continue
            if date_to and d > date_to:
                continue
            result.append(f)
        return result

    @staticmethod
    def filter_by_agent_type(files: list[Path], agent_types: tuple[str, ...] | None) -> list[Path]:
        if not agent_types:
            return files
        types = set(agent_types)
        return [f for f in files if f.parent.parent.parent.name in types]

    @staticmethod
    def filter_joplin_notebook(files: list[Path], notebooks: tuple[str, ...] | None) -> list[Path]:
        if not notebooks:
            return files
        nb_set = set(notebooks)
        return [f for f in files if f.parent.name in nb_set]


# ====================================================================
# Content processor — 정규화, 링크 정리
# ====================================================================

class ContentProcessor:
    @staticmethod
    def normalize_agent_content(content: str) -> str:
        cleaned = re.sub(r"^\[tool-event\]\s*$", "", content, flags=re.MULTILINE)
        cleaned = re.sub(r"^\[(TRACE|DEBUG|INFO|WARN|ERROR)\]\s+[^\n]+\n", "", cleaned, flags=re.MULTILINE)
        cleaned = re.sub(r"\n{3,}", "\n\n", cleaned)
        return cleaned.strip()

    @staticmethod
    def clean_broken_links(content: str, session_dir: Path) -> str:
        def _replace(m: re.Match) -> str:
            text, url = m.group(1), m.group(2)
            if url.startswith("http://") or url.startswith("https://"):
                return m.group(0)
            clean_url = url.replace("file://", "")
            if clean_url.startswith("./") or not clean_url.startswith("/"):
                target = (session_dir / clean_url).resolve()
            else:
                target = Path(clean_url).resolve()
            if not target.exists():
                return text
            return m.group(0)
        return re.sub(r"\[([^\]]+)\]\(([^)]+)\)", _replace, content)


# ====================================================================
# Compile Pipeline — 오케스트레이터
# ====================================================================

class CompilePipeline:
    def __init__(self, cfg: OpenKbConfig | None = None) -> None:
        self.cfg = cfg or OpenKbConfig.from_env()
        self.scanner = SourceScanner(self.cfg)
        self.processor = ContentProcessor()

    def run(
        self,
        input_paths: tuple[str, ...] | None = None,
        output_base: str | None = None,
        output_path: str | None = None,
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

        raw_store, cache_path = self._resolve_output(output_base, output_path)
        if full_rebuild:
            self._clear_raw(raw_store, cache_path)
        raw_store.mkdir(parents=True, exist_ok=True)

        input_dirs = self._resolve_input_dirs(input_paths)
        cache = OpenKbCache(cache_path)

        date_from_dt = _parse_date(date_from or os.environ.get("DATE_FROM"))
        date_to_dt = _parse_date(date_to or os.environ.get("DATE_TO"))
        if sample is None:
            sample_env = os.environ.get("SAMPLE")
            sample = int(sample_env) if sample_env and sample_env.strip().isdigit() else None

        proc_agent, skip_agent = self._process_agents(
            input_dirs, agents, date_from_dt, date_to_dt,
            sample, no_cache, cache, raw_store, model, engine, api_key,
        )
        proc_joplin, skip_joplin = self._process_joplin(
            input_dirs, joplin_notebooks, date_from_dt, date_to_dt,
            sample, no_cache, cache, raw_store, model, engine, api_key,
        )
        if any("joplin" in str(d) for d in input_dirs):
            _copy_joplin_images(input_dirs, raw_store)

        total = proc_agent + proc_joplin
        print(
            f"\u2728 Processed: {proc_agent} agents, {proc_joplin} joplin "
            f"| Skipped: {skip_agent}, {skip_joplin}"
        )

        self._clean_orphans(raw_store, cache, full_rebuild)

        if total == 0:
            print("\u23ed\ufe0f No changes detected. Skipping openkb add.")
            LLMClient.stop_llama_server()
            return

        print("\U0001f9e0 Running openkb add...")
        if any(raw_store.iterdir()):
            _run_openkb_add(raw_store, engine, model, api_key, raw_store.parent)
        else:
            print("   No files to compile.")

        LLMClient.stop_llama_server()

    # ------------------------------------------------------------------
    # Private steps
    # ------------------------------------------------------------------

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

    def _resolve_output(self, output_base: str | None, output_path: str | None) -> tuple[Path, Path]:
        if output_base:
            base_dir = Path(output_base)
            if not base_dir.is_absolute():
                base_dir = self.cfg.project_root / base_dir
            elif not Path("/data").exists() and base_dir.parts[:2] == ("/", "data"):
                base_dir = self.cfg.project_root / Path(*base_dir.parts[2:])
            return base_dir / "raw", base_dir / "cache.json"
        return Path(output_path) if output_path else self.cfg.default_raw_store, self.cfg.default_cache_path

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
        result = []
        for t in targets:
            parts = Path(t).parts
            sub = Path(*parts[1:]) if len(parts) > 1 and parts[0] == "data" else Path(t)
            result.append(self.cfg.project_root / sub)
        return result

    def _process_agents(
        self, input_dirs: list[Path], agents: tuple[str, ...] | None,
        date_from: str | None, date_to: str | None,
        sample: int | None, no_cache: bool, cache: OpenKbCache,
        raw_store: Path, model: str | None, engine: str, api_key: str | None,
    ) -> tuple[int, int]:
        processed = 0
        skipped = 0
        if not any("agents" in str(d) for d in input_dirs):
            print("\u23ed\ufe0f Agent transcripts skipped.")
            return processed, skipped

        src_dir = _find_agent_source_dir(input_dirs, self.cfg)
        if not src_dir:
            print("\u23ed\ufe0f No agent source directory found.")
            return processed, skipped

        transcripts = self.scanner.find_agent_docs(src_dir)
        transcripts = SourceScanner.filter_by_date(transcripts, date_from, date_to)
        transcripts = SourceScanner.filter_by_agent_type(transcripts, agents)

        print(f"\U0001f4c1 Agent transcripts: {len(transcripts)}")
        saved = 0
        for i, file_path in enumerate(transcripts):
            if sample is not None and saved >= sample:
                print(f"   \U0001f9ea Sample limit {sample} reached.")
                break
            mtime = file_path.stat().st_mtime

            if not no_cache and cache.is_up_to_date(str(file_path), mtime):
                skipped += 1
                continue

            try:
                folder, filename, metadata = extract_title(
                    self._read_and_prepare(file_path), file_path.parent.parent.name,
                    model or "", engine=engine, api_key=api_key,
                )
                if not _validate_filename(filename):
                    continue

                content = self._read_and_prepare(file_path)
                dest_dir = raw_store / folder
                dest_dir.mkdir(parents=True, exist_ok=True)
                dest = dest_dir / filename
                dest.write_text(wrap_with_metadata(content, metadata), encoding="utf-8")
                print(f"      + Saved: {folder}/{filename}")
                cache.update(str(file_path), mtime, raw_name=f"{folder}/{filename}")
                saved += 1
                processed += 1
                if sample is not None and saved >= sample:
                    break
            except Exception as e:
                print(f"\u274c Error [{file_path}]: {e}")
        return processed, skipped

    def _read_and_prepare(self, file_path: Path) -> str:
        content = file_path.read_text(encoding="utf-8")
        if not content or len(content.strip()) < 10:
            return ""
        content = self.processor.normalize_agent_content(content)
        content = self.processor.clean_broken_links(content, file_path.parent)
        return content

    def _process_joplin(
        self, input_dirs: list[Path], notebooks: tuple[str, ...] | None,
        date_from: str | None, date_to: str | None,
        sample: int | None, no_cache: bool, cache: OpenKbCache,
        raw_store: Path, model: str | None, engine: str, api_key: str | None,
    ) -> tuple[int, int]:
        processed = 0
        skipped = 0
        if not any("joplin" in str(d) for d in input_dirs):
            print("\u23ed\ufe0f Joplin notes skipped.")
            return processed, skipped

        joplin_dir = _find_joplin_source_dir(input_dirs, self.cfg)
        if not joplin_dir:
            print("\u23ed\ufe0f No Joplin source directory found.")
            return processed, skipped

        files = self.scanner.find_joplin_files(joplin_dir)
        files = SourceScanner.filter_joplin_notebook(files, notebooks)

        print(f"\U0001f4c1 Joplin notes: {len(files)}")
        for i, file_path in enumerate(files):
            if sample is not None and processed >= sample:
                print(f"   \U0001f9ea Sample limit {sample} reached.")
                break
            mtime = file_path.stat().st_mtime
            if not no_cache and cache.is_up_to_date(str(file_path), mtime):
                skipped += 1
                continue

            try:
                rel_parent = file_path.parent.relative_to(joplin_dir)
                content = file_path.read_text(encoding="utf-8")
                _, _, metadata = extract_title(content, "", model or "", engine=engine, api_key=api_key)

                if not content.startswith("---"):
                    content = f"---\nsource: Joplin\nnotebook: {file_path.parent.name}\n---\n\n{content}"

                dest_dir = raw_store / rel_parent
                dest_dir.mkdir(parents=True, exist_ok=True)
                dest = dest_dir / file_path.name
                dest.write_text(wrap_with_metadata(content, metadata), encoding="utf-8")

                raw_ref = f"{rel_parent}/{file_path.name}"
                print(f"      + Joplin: {raw_ref}")
                cache.update(str(file_path), mtime, raw_name=raw_ref)
                processed += 1
            except Exception as e:
                print(f"\u274c Joplin error [{file_path}]: {e}")
        return processed, skipped

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
# Public API (backward compat)
# ====================================================================

def compile_command(**kwargs: Any) -> None:
    pipeline = CompilePipeline()
    pipeline.run(**kwargs)


# ====================================================================
# Internal helpers
# ====================================================================

def _parse_date(s: str | None) -> str | None:
    if not s:
        return None
    s = s.strip()
    return s if re.match(r"^\d{4}-\d{2}-\d{2}$", s) else None


def _find_agent_source_dir(input_dirs: list[Path], cfg: OpenKbConfig) -> Path | None:
    for d in input_dirs:
        if "agents" in str(d):
            return d
    return cfg.dump_dir if cfg.dump_dir.exists() else None


def _find_joplin_source_dir(input_dirs: list[Path], cfg: OpenKbConfig) -> Path | None:
    for d in input_dirs:
        if "joplin" in str(d):
            return d
    return cfg.joplin_dir if cfg.joplin_dir.exists() else None


def _validate_filename(filename: str) -> bool:
    SKIP = ["\uc870\uce58_\uc5c6\uc74c", "no suggestions", "no_suggestions",
            "suggestions_none", "\uc870\uce58\uc5c6\uc74c", "\ubb34\uc5c7\uc774\ub4e0 \ub2f5\ubcc0", "\ubb34\uc5c7\uc774\ub4e0\ub2f5\ubcc0"]
    name = filename.replace(".md", "")
    if len(name) <= 12 or name[10:].strip(" _") == "":
        print(f"   \u26a0\ufe0f Invalid filename: '{filename}'")
        return False
    if any(k in name.lower() for k in SKIP):
        print(f"   \u26a0\ufe0f No-op session: '{filename}'")
        return False
    return True


def _copy_joplin_images(input_dirs: list[Path], raw_store: Path) -> None:
    dest_images = raw_store / "images"
    dest_images.mkdir(parents=True, exist_ok=True)
    copied = 0
    for src_dir in input_dirs:
        if not src_dir.exists():
            continue
        for images_dir in src_dir.rglob("images"):
            if not images_dir.is_dir():
                continue
            for img in images_dir.iterdir():
                if img.is_file():
                    shutil.copy2(img, dest_images / img.name)
                    copied += 1
    if copied:
        print(f"   Copied {copied} images to {dest_images}")


def _run_openkb_add(raw_store: Path, engine: str, model: str | None, api_key: str | None, output_base: Path | None = None) -> None:
    env = os.environ.copy()
    cfg = OpenKbConfig.from_env()

    if output_base:
        ob = output_base
        ob.mkdir(parents=True, exist_ok=True)
        (ob / ".openkb").mkdir(parents=True, exist_ok=True)
        (ob / ".config" / "openkb").mkdir(parents=True, exist_ok=True)
        model_ref = model or "default"
        if engine == "llama.cpp":
            config_model = f"openai/{model_ref}"
            config_base = f"http://{cfg.ollama_host}:{cfg.engine_ports['llama.cpp']}/v1"
        else:
            config_model = f"{engine}/{model_ref}"
            config_base = f"http://{cfg.ollama_host}:{cfg.engine_ports['ollama']}"
        (ob / ".openkb" / "config.yaml").write_text(
            f"model: {config_model}\napi_base: {config_base}\napi_key: anything\nlanguage: ko\npageindex_threshold: 20\n"
        )
        (ob / ".config" / "openkb" / "global.yaml").write_text(
            f"default_kb: {ob}\nknown_kbs:\n- {ob}\n"
        )
        env["OPENKB_HOME"] = str(ob.resolve())
        env["HOME"] = str(ob.resolve())

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
        subprocess.run(["openkb", "add", str(raw_store)], env=env, check=True, cwd=ob if output_base else cfg.openkb_dir)
        print("\u2705 OpenKB compile complete.")
    except subprocess.CalledProcessError as e:
        print(f"\u274c openkb add failed: {e}")
        exit(1)
