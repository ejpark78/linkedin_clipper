"""
OpenKB Document Metadata — LLM-driven extraction & frontmatter wrapping.

의존성: llm (LLMClient), config (model/engine 설정)
"""
from __future__ import annotations

import json
import re
from typing import Any

from llm import LLMClient


_DOC_METADATA_PROMPT = """\
Given the following document content, extract structured metadata.

Return a JSON object with these fields:
- "title": A very brief Korean summary (under 45 characters) for use as a filename
- "description": A one-sentence description of the document's main topic
- "category": Broad domain category (e.g., backend, frontend, ai-ml, devops, database, language, architecture, tool, design)
- "sub_category": A more specific sub-domain within the category
- "tags": An array of 3-7 keyword tags (technologies, patterns, concepts)

Return ONLY valid JSON, no fences, no explanation.

Document:
{content}"""


def parse_llm_metadata(raw: str) -> dict:
    cleaned = raw.strip()
    if cleaned.startswith("```"):
        first_nl = cleaned.find("\n")
        cleaned = cleaned[first_nl + 1:] if first_nl != -1 else cleaned[3:]
        if cleaned.endswith("```"):
            cleaned = cleaned[:-3]
    try:
        parsed = json.loads(cleaned)
        if not isinstance(parsed, dict):
            return {}
        return {
            "title": str(parsed.get("title", "")),
            "description": str(parsed.get("description", "")),
            "category": str(parsed.get("category", "")),
            "sub_category": str(parsed.get("sub_category", "")),
            "tags": list(parsed.get("tags", [])),
        }
    except (json.JSONDecodeError, ValueError):
        return {}


def extract_metadata(
    text: str, model: str,
    engine: str = "ollama", api_key: str | None = None,
) -> dict:
    prompt = _DOC_METADATA_PROMPT.format(content=text[:2000])
    return LLMClient.extract_metadata(prompt, model, engine=engine, api_key=api_key)


def clean_summary(raw: str) -> str:
    clean = re.sub(r"[^a-zA-Z0-9\u3131-\u3163\uac00-\ud7a3\s_]", "", raw)
    clean = re.sub(r"\s+", " ", clean).strip()[:50]
    return clean


def extract_title(
    content: str, date_folder: str, model: str,
    engine: str = "ollama", api_key: str | None = None,
) -> tuple[str, str, dict]:
    """파일명(title)과 메타데이터(category, tags, description)를 추출.

    Returns:
        (date_folder_name, filename, metadata_dict)
    """
    date_part = date_folder.split("T")[0] if date_folder else ""
    metadata: dict = {}

    # Check frontmatter title
    frontmatter_title = re.search(r"^title:\s*(.+)$", content, re.MULTILINE)
    frontmatter_model = re.search(r"^model:\s*(.+)$", content, re.MULTILINE)
    frontmatter_agent = re.search(r"^agent:\s*(.+)$", content, re.MULTILINE)
    if frontmatter_title:
        title_value = frontmatter_title.group(1).strip()
        if title_value:
            clean = re.sub(r'[^a-zA-Z0-9\u3131-\u3163\uac00-\ud7a3\s]', '', title_value)[:40].strip()
            if not clean:
                clean = "agent_session"
            return date_part, f"{clean}.md", metadata

    if frontmatter_agent and frontmatter_agent.group(1).strip() == "codex":
        codex_title = re.search(r"^title:\s*Codex:\s*(.+)$", content, re.MULTILINE)
        if codex_title:
            title_value = codex_title.group(1).strip()
            if title_value:
                clean = re.sub(r'[^a-zA-Z0-9\u3131-\u3163\uac00-\ud7a3\s]', '', title_value)[:36].strip()
                if not clean:
                    clean = "agent_session"
                return date_part, f"codex_{clean}.md", metadata

    if frontmatter_model:
        model_value = frontmatter_model.group(1).strip()
        if model_value:
            model = model_value

    issue_match = re.search(r"(?:#|이슈\s*|버그\s*|feature/)([0-9]{3})", content, re.IGNORECASE)

    # Extract agent response summaries for LLM input
    agent_blocks = re.findall(
        r"(?:### \[Step \d+\] 🤖 Agent|## 🤖 Agent Answer)([\s\S]*?)(?=### \[Step \d+\]|# 📌 Turn \d+|$)",
        content,
    )
    agent_summaries = []
    for block in agent_blocks:
        cleaned = re.sub(r">\s*\*\*🛠️ Tool Call\*\*[\s\S]*?(?=> \*\*Result\*\*|$)", "", block)
        cleaned = re.sub(r">\s*\*\*Result\*\*[\s\S]*?(?=\n\n|$)", "", cleaned)
        cleaned = cleaned.strip()
        if cleaned:
            lines = [ln.strip() for ln in cleaned.split("\n") if ln.strip() and not ln.strip().startswith(">")]
            if lines:
                agent_summaries.append(" ".join(lines[-3:]))

    agent_response_combined = "\n".join(agent_summaries).strip()
    if not agent_response_combined:
        agent_response_combined = content[:2000]

    result = LLMClient.extract_metadata(
        _DOC_METADATA_PROMPT.format(content=agent_response_combined[:2000]),
        model,
        engine=engine, api_key=api_key,
    )
    metadata = result
    title_text = result.get("title", "")

    if title_text:
        clean = clean_summary(title_text)
        if clean:
            if issue_match:
                issue_no = f"#{issue_match.group(1)}"
                if issue_no not in clean:
                    return date_part, f"{issue_no}_{clean}.md", metadata
            return date_part, f"{clean}.md", metadata

    # Fallback: use first user request text
    first_request_match = re.search(r"<USER_REQUEST>([\s\S]*?)</USER_REQUEST>", content)
    first_request_text = first_request_match.group(1).strip() if first_request_match else ""
    if not first_request_text:
        first_request_text = content[:500]

    if issue_match:
        issue_no = f"#{issue_match.group(1)}"
        first_line = first_request_text.split("\n")[0] if first_request_text else "issue_task"
        first_line = re.sub(r"[#*`~\[\]\(\)<>\-_]", " ", first_line)
        first_line = re.sub(r"https?://[^\s]+", "", first_line).strip()
        clean_title = re.sub(r"[^a-zA-Z0-9\u3131-\u3163\uac00-\ud7a3\s]", "", first_line)
        clean_title = re.sub(r"\s+", " ", clean_title).strip()[:40]
        if not clean_title:
            clean_title = "issue_task"
        return date_part, f"{issue_no}_{clean_title}.md", metadata

    if first_request_text:
        first_line = first_request_text.split("\n")[0]
        first_line = re.sub(r"[#*`~\[\]\(\)<>\-_]", " ", first_line).strip()
        clean_title = re.sub(r"[^a-zA-Z0-9\u3131-\u3163\uac00-\ud7a3\s]", "", first_line)
        clean_title = re.sub(r"\s+", " ", clean_title).strip()[:40]
        if clean_title:
            return date_part, f"{clean_title}.md", metadata

    return date_part, "agent_session.md", metadata


def extract_agent(content: str) -> str | None:
    match = re.search(r"^agent:\s*(.+)$", content, re.MULTILINE)
    return match.group(1).strip() if match else None


def wrap_with_metadata(content: str, metadata: dict) -> str:
    """Add frontmatter and inline blockquote to content based on metadata dict."""
    if not metadata:
        return content

    tags: list[str] = metadata.get("tags", [])
    category: str = metadata.get("category", "")
    sub_category: str = metadata.get("sub_category", "")
    description: str = metadata.get("description", "")

    # Frontmatter injection
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

    # Inline blockquote
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
