"""Source handlers — OpenKB 방식 process_file() 구조 복원 + entities 추출."""

from __future__ import annotations

import json
import os
import re
import shutil
from abc import ABC, abstractmethod
from pathlib import Path
from typing import Any

from .cache import FileCache
from .config import PreprocessConfig
from .llm_client import extract as llm_extract


class SourceHandler(ABC):
    def __init__(self, cfg: PreprocessConfig) -> None:
        self.cfg = cfg

    @property
    @property
    @abstractmethod
    def name(self) -> str:
        ...

    @abstractmethod
    def detect(self, source_dir: Path) -> bool:
        ...

    @abstractmethod
    def collect_files(self, source_dir: Path) -> list[Path]:
        ...

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
        raw_store: Path, cache: FileCache, no_cache: bool,
        model: str | None, engine: str, api_key: str | None,
        entities_writer: Any = None,
    ) -> tuple[int, int]:
        """단일 파일 처리. 반환: (processed, skipped)"""

    def post_process(self, input_dirs: list[Path], raw_store: Path) -> None:
        """전체 처리 후 후처리 (이미지 복사 등)."""


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
        raw_store: Path, cache: FileCache, no_cache: bool,
        model: str | None, engine: str, api_key: str | None,
        entities_writer: Any = None,
    ) -> tuple[int, int]:
        mtime = file_path.stat().st_mtime
        if not no_cache and cache.is_up_to_date(str(file_path), mtime):
            return 0, 1

        content = file_path.read_text(encoding="utf-8")
        if not content or len(content.strip()) < 10:
            return 0, 0

        content = _normalize_agent(content)
        content = _clean_broken_links(content, file_path.parent)

        agent_type = file_path.parent.parent.parent.name
        date_str = file_path.parent.parent.name
        date_match = re.match(r"(\d{4}-\d{2}-\d{2})", date_str)
        date_val = date_match.group(1) if date_match else None

        llm_result = llm_extract(content, source_type="agent", model=model, engine=engine, api_key=api_key)

        if entities_writer and llm_result.get("entities"):
            import hashlib
            doc_id = hashlib.sha256(str(file_path).encode()).hexdigest()[:12]
            entities_writer.write(json.dumps({
                "doc_id": doc_id,
                "source": str(file_path),
                **llm_result,
            }, ensure_ascii=False) + "\n")

        filename = _make_filename(llm_result, file_path, date_val)

        dest_dir = raw_store / (date_val or "")
        dest_dir.mkdir(parents=True, exist_ok=True)
        dest = dest_dir / filename
        dest.write_text(_wrap_with_metadata(content, llm_result), encoding="utf-8")
        print(f"      + Saved: {dest_dir.name}/{filename}")
        cache.update(str(file_path), mtime, raw_name=f"{dest_dir.name}/{filename}")
        return 1, 0


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
        raw_store: Path, cache: FileCache, no_cache: bool,
        model: str | None, engine: str, api_key: str | None,
        entities_writer: Any = None,
    ) -> tuple[int, int]:
        mtime = file_path.stat().st_mtime
        if not no_cache and cache.is_up_to_date(str(file_path), mtime):
            return 0, 1

        content = file_path.read_text(encoding="utf-8")
        if not content:
            return 0, 0

        rel_parent = file_path.parent.relative_to(source_dir)

        llm_result = llm_extract(content, source_type="joplin", model=model, engine=engine, api_key=api_key)

        if entities_writer and llm_result.get("entities"):
            import hashlib
            doc_id = hashlib.sha256(str(file_path).encode()).hexdigest()[:12]
            entities_writer.write(json.dumps({
                "doc_id": doc_id,
                "source": str(file_path),
                **llm_result,
            }, ensure_ascii=False) + "\n")

        # Joplin frontmatter 보존
        if not content.startswith("---"):
            content = f"---\nsource: Joplin\nnotebook: {file_path.parent.name}\n---\n\n{content}"

        dest_dir = raw_store / rel_parent
        dest_dir.mkdir(parents=True, exist_ok=True)
        dest = dest_dir / file_path.name
        dest.write_text(_wrap_with_metadata(content, llm_result), encoding="utf-8")
        raw_ref = f"{rel_parent}/{file_path.name}"
        print(f"      + Joplin: {raw_ref}")
        cache.update(str(file_path), mtime, raw_name=raw_ref)
        return 1, 0

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


def make_handlers(cfg: PreprocessConfig) -> list[SourceHandler]:
    return [AgentHandler(cfg), JoplinHandler(cfg)]


def detect_handler(source_dir: Path, cfg: PreprocessConfig) -> SourceHandler | None:
    for h in make_handlers(cfg):
        if h.detect(source_dir):
            return h
    return None


# === Internal helpers ===

_SKIP_KEYWORDS = [
    "\uc870\uce58_\uc5c6\uc74c", "no suggestions", "no_suggestions",
    "suggestions_none",
]


def _make_filename(llm_result: dict, file_path: Path, date_val: str | None) -> str:
    title = llm_result.get("title", "")
    if title:
        clean = re.sub(r"[^a-zA-Z0-9\u3131-\u3163\uac00-\ud7a3\s_]", "", title)
        clean = re.sub(r"\s+", " ", clean).strip()[:40]
        if clean:
            # 이슈 번호 추출
            issue_match = re.search(r"(?:#|이슈\s*|버그\s*|feature/)([0-9]{3})", file_path.read_text(encoding="utf-8")[:1000], re.IGNORECASE)
            if issue_match:
                issue_no = f"#{issue_match.group(1)}"
                if issue_no not in clean:
                    return f"{issue_no}_{clean}.md"
            return f"{clean}.md"

    # Fallback: 파일명 기반
    name = file_path.stem.replace("session", date_val or "agent").replace("transcript", date_val or "agent")
    return f"{name}.md"


def _wrap_with_metadata(content: str, metadata: dict) -> str:
    """Add frontmatter and inline blockquote based on metadata dict (OpenKB 방식)."""
    if not metadata:
        return content

    tags: list[str] = metadata.get("tags", [])
    category: str = metadata.get("category", "")
    sub_category: str = metadata.get("sub_category", "")
    description: str = metadata.get("description", "")

    frontmatter_lines: list[str] = []
    if category and not re.search(r"^category:\s", content, re.MULTILINE):
        frontmatter_lines.append(f"category: {category}")
    if sub_category and not re.search(r"^sub_category:\s", content, re.MULTILINE):
        frontmatter_lines.append(f"sub_category: {sub_category}")
    if tags and not re.search(r"^tags:\s", content, re.MULTILINE):
        frontmatter_lines.append(f"tags: {json.dumps(tags, ensure_ascii=False)}")
    if description and not re.search(r"^description:\s", content, re.MULTILINE):
        frontmatter_lines.append(f"description: {description}")

    has_fm = content.startswith("---")
    if frontmatter_lines:
        new_fm_block = "\n".join(frontmatter_lines)
        if has_fm:
            end = content.find("---", 3)
            if end != -1:
                content = content[:end] + "\n" + new_fm_block + content[end:]
        else:
            content = f"---\n{new_fm_block}\n---\n\n{content}"

    inline_parts: list[str] = []
    if category and sub_category:
        inline_parts.append(f"> **분류:** {category} > {sub_category}")
    elif category:
        inline_parts.append(f"> **분류:** {category}")
    if tags:
        inline_parts.append(f"> **태그:** {', '.join(tags)}")
    if description:
        inline_parts.append(f"> **설명:** {description}")

    if inline_parts:
        blockquote = "\n".join(inline_parts) + "\n\n"
        body_start = content.find("\n\n", content.find("---", 3) + 3) if content.startswith("---") else -1
        if body_start != -1:
            content = content[:body_start + 2] + blockquote + content[body_start + 2:]
        else:
            content = content + "\n\n" + blockquote

    return content


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
        if len(clean_url) > 500:
            return text
        if clean_url.startswith("./") or not clean_url.startswith("/"):
            target = (session_dir / clean_url).resolve()
        else:
            target = Path(clean_url).resolve()
        try:
            if not target.exists():
                return text
        except OSError:
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
