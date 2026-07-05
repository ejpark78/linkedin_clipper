from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass, field
from typing import Any


@dataclass
class Chunk:
    doc_id: str
    chunk_index: int
    content: str
    heading: str | None = None
    metadata: dict[str, Any] = field(default_factory=dict)


def _make_doc_id(source_path: str) -> str:
    return hashlib.sha256(source_path.encode()).hexdigest()[:12]


def chunk_markdown(
    content: str,
    source_path: str,
    max_tokens: int = 2000,
    metadata: dict[str, Any] | None = None,
) -> list[Chunk]:
    """Split markdown by headings, grouping until max_tokens exceeded."""
    doc_id = _make_doc_id(source_path)
    meta = metadata or {}
    chunks: list[Chunk] = []
    lines = content.split("\n")

    current_heading: str | None = None
    current_lines: list[str] = []
    current_size = 0

    def _flush() -> None:
        nonlocal current_lines, current_size
        if not current_lines:
            return
        text = "\n".join(current_lines).strip()
        if text:
            chunks.append(Chunk(
                doc_id=doc_id,
                chunk_index=len(chunks),
                content=text,
                heading=current_heading,
                metadata={**meta, "source": source_path},
            ))
        current_lines = []
        current_size = 0

    for line in lines:
        heading_match = re.match(r"^(#{1,6})\s+(.+)$", line)
        if heading_match:
            # H1 = top-level, split on it; lower headings group content
            level = len(heading_match.group(1))
            if level == 1:
                _flush()
                current_heading = heading_match.group(2)
                current_lines = [line]
                current_size = len(line)
            else:
                current_lines.append(line)
                current_size += len(line) + 1
            continue

        current_lines.append(line)
        current_size += len(line) + 1
        if current_size > max_tokens:
            _flush()

    _flush()
    return chunks


def chunk_fixed_size(
    content: str,
    source_path: str,
    chunk_size: int = 2000,
    overlap: int = 200,
    metadata: dict[str, Any] | None = None,
) -> list[Chunk]:
    """Split by fixed character count with overlap."""
    doc_id = _make_doc_id(source_path)
    meta = metadata or {}
    chunks: list[Chunk] = []

    start = 0
    while start < len(content):
        end = min(start + chunk_size, len(content))
        chunk_text = content[start:end]
        chunks.append(Chunk(
            doc_id=doc_id,
            chunk_index=len(chunks),
            content=chunk_text.strip(),
            metadata={**meta, "source": source_path},
        ))
        start += chunk_size - overlap
        if start >= len(content):
            break

    return chunks
