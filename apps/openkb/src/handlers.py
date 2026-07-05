"""
OpenKB Source Handlers — 플러그인 가능한 소스 타입별 처리기.

OCP 원칙: 새 소스 타입 추가 시 SourceHandler 서브클래스만 만들고 HANDLERS에 등록.
"""
from __future__ import annotations

import os
import re
import shutil
from abc import ABC, abstractmethod
from pathlib import Path
from typing import Any

from cache import OpenKbCache
from config import OpenKbConfig
from metadata import extract_title, wrap_with_metadata


# ====================================================================
# Abstract base
# ====================================================================

class SourceHandler(ABC):
    """소스 타입별 처리기 추상 클래스."""

    def __init__(self, cfg: OpenKbConfig) -> None:
        self.cfg = cfg

    @property
    @abstractmethod
    def name(self) -> str:
        """핸들러 식별자 (로그, 통계용)."""

    @abstractmethod
    def detect(self, source_dir: Path) -> bool:
        """해당 디렉토리를 이 핸들러가 처리할 수 있는지 판별."""

    @abstractmethod
    def collect_files(self, source_dir: Path) -> list[Path]:
        """소스 디렉토리에서 처리할 파일 목록 반환."""

    def filter_files(
        self, files: list[Path],
        date_from: str | None = None,
        date_to: str | None = None,
        filter_args: dict | None = None,
    ) -> list[Path]:
        return files

    @abstractmethod
    def process_file(
        self, file_path: Path, source_dir: Path,
        raw_store: Path, cache: OpenKbCache, no_cache: bool,
        model: str | None, engine: str, api_key: str | None,
    ) -> tuple[bool, bool]:
        """단일 파일 처리. 반환: (processed, skipped)"""

    def post_process(self, input_dirs: list[Path], raw_store: Path) -> None:
        """전체 처리 후 후처리 (이미지 복사 등)."""


# ====================================================================
# Agent Handler — session.md / transcript.md
# ====================================================================

class AgentHandler(SourceHandler):
    @property
    def name(self) -> str:
        return "agents"

    def detect(self, source_dir: Path) -> bool:
        if not source_dir.exists():
            return False
        try:
            for _, _, files in os.walk(source_dir):
                if "session.md" in files or "transcript.md" in files:
                    return True
        except Exception:
            return False
        return False

    def collect_files(self, source_dir: Path) -> list[Path]:
        results: list[Path] = []
        if not source_dir.exists():
            return results
        seen: set[str] = set()
        for root, _, files in os.walk(source_dir):
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

    def filter_files(
        self, files: list[Path],
        date_from: str | None = None,
        date_to: str | None = None,
        filter_args: dict | None = None,
    ) -> list[Path]:
        result = files
        if date_from or date_to:
            result = _filter_by_date(result, date_from, date_to)
        agent_types = (filter_args or {}).get("agent_types")
        if agent_types:
            types = set(agent_types)
            result = [f for f in result if f.parent.parent.parent.name in types]
        return result

    def process_file(
        self, file_path: Path, source_dir: Path,
        raw_store: Path, cache: OpenKbCache, no_cache: bool,
        model: str | None, engine: str, api_key: str | None,
    ) -> tuple[bool, bool]:
        mtime = file_path.stat().st_mtime
        if not no_cache and cache.is_up_to_date(str(file_path), mtime):
            return False, True

        content = file_path.read_text(encoding="utf-8")
        if not content or len(content.strip()) < 10:
            return False, False

        content = _normalize_agent(content)
        content = _clean_broken_links(content, file_path.parent)
        folder, filename, metadata = extract_title(
            content, file_path.parent.parent.name,
            model or "", engine=engine, api_key=api_key,
        )
        if not _valid_filename(filename):
            return False, False

        dest_dir = raw_store / folder
        dest_dir.mkdir(parents=True, exist_ok=True)
        dest = dest_dir / filename
        dest.write_text(wrap_with_metadata(content, metadata), encoding="utf-8")
        print(f"      + Saved: {folder}/{filename}")
        cache.update(str(file_path), mtime, raw_name=f"{folder}/{filename}")
        return True, False

    def __repr__(self) -> str:
        return "AgentHandler"


# ====================================================================
# Joplin Handler — .md 파일 (frontmatter + 상대경로 보존)
# ====================================================================

class JoplinHandler(SourceHandler):
    @property
    def name(self) -> str:
        return "joplin"

    def detect(self, source_dir: Path) -> bool:
        if not source_dir.exists():
            return False
        try:
            for _, _, files in os.walk(source_dir):
                for f in files:
                    if f.endswith(".md") and not f.startswith("."):
                        return True
            return False
        except Exception:
            return False

    def collect_files(self, source_dir: Path) -> list[Path]:
        results: list[Path] = []
        if not source_dir.exists():
            return results
        for root, _, files in os.walk(source_dir):
            for f in files:
                if f.endswith(".md") and not f.startswith("."):
                    if ".tmp_export" in root:
                        continue
                    results.append(Path(root) / f)
        return results

    def filter_files(
        self, files: list[Path],
        date_from: str | None = None,
        date_to: str | None = None,
        filter_args: dict | None = None,
    ) -> list[Path]:
        notebooks = (filter_args or {}).get("joplin_notebooks")
        if notebooks:
            nb_set = set(notebooks)
            return [f for f in files if f.parent.name in nb_set]
        return files

    def process_file(
        self, file_path: Path, source_dir: Path,
        raw_store: Path, cache: OpenKbCache, no_cache: bool,
        model: str | None, engine: str, api_key: str | None,
    ) -> tuple[bool, bool]:
        mtime = file_path.stat().st_mtime
        if not no_cache and cache.is_up_to_date(str(file_path), mtime):
            return False, True

        rel_parent = file_path.parent.relative_to(source_dir)
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
        return True, False

    def post_process(self, input_dirs: list[Path], raw_store: Path) -> None:
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

    def __repr__(self) -> str:
        return "JoplinHandler"


# ====================================================================
# Registry
# ====================================================================

def make_handlers(cfg: OpenKbConfig) -> list[SourceHandler]:
    """등록된 핸들러 목록 반환. 순서: 구체적 → 일반적."""
    return [
        AgentHandler(cfg),
        JoplinHandler(cfg),
    ]


# ====================================================================
# Internal helpers (shared between handlers)
# ====================================================================

_SKIP_KEYWORDS = [
    "\uc870\uce58_\uc5c6\uc74c", "no suggestions", "no_suggestions",
    "suggestions_none", "\uc870\uce58\uc5c6\uc74c", "\ubb34\uc5c7\uc774\ub4e0 \ub2f5\ubcc0", "\ubb34\uc5c7\uc774\ub4e0\ub2f5\ubcc0",
]


def _valid_filename(filename: str) -> bool:
    name = filename.replace(".md", "")
    if len(name) <= 12 or name[10:].strip(" _") == "":
        print(f"   \u26a0\ufe0f Invalid filename: '{filename}'")
        return False
    if any(k in name.lower() for k in _SKIP_KEYWORDS):
        print(f"   \u26a0\ufe0f No-op session: '{filename}'")
        return False
    return True


def _normalize_agent(content: str) -> str:
    cleaned = re.sub(r"^\[tool-event\]\s*$", "", content, flags=re.MULTILINE)
    cleaned = re.sub(r"^\[(TRACE|DEBUG|INFO|WARN|ERROR)\]\s+[^\n]+\n", "", cleaned, flags=re.MULTILINE)
    cleaned = re.sub(r"\n{3,}", "\n\n", cleaned)
    return cleaned.strip()


def _clean_broken_links(content: str, session_dir: Path) -> str:
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


def _filter_by_date(files: list[Path], date_from: str | None, date_to: str | None) -> list[Path]:
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
