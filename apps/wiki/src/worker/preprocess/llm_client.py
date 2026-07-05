"""LLM client — metadata + entity extraction. Restored from OpenKB pattern."""

from __future__ import annotations

import json
import re
import time
import urllib.error
import urllib.request
from pathlib import Path

from .config import PreprocessConfig

_DOC_METADATA_PROMPT = """\
Given the following document content, extract structured metadata and entities.

Return a JSON object with these fields:
- "title": A very brief Korean summary (under 45 characters) for use as a filename
- "description": A one-sentence description of the document's main topic
- "category": Broad domain category (e.g., backend, frontend, ai-ml, devops, database, language, architecture, tool, design)
- "sub_category": A more specific sub-domain within the category
- "tags": An array of 3-7 keyword tags (technologies, patterns, concepts)
- "entities": An array of objects, each with "name" (entity name) and "type" (technology, framework, language, tool, concept, person)

Return ONLY valid JSON, no fences, no explanation.

Document:
{content}"""


def _request_json(url: str, data: bytes | None = None, headers: dict | None = None, timeout: int = 60) -> dict | None:
    try:
        req = urllib.request.Request(url, data=data, headers=headers or {})
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.URLError as e:
        print(f"  ⚠️ LLM 연결 오류: {e.reason}")
        return None
    except TimeoutError:
        print(f"  ⚠️ LLM 타임아웃 ({timeout}초 초과)")
        return None
    except Exception as e:
        print(f"  ⚠️ LLM 요청 예외: {type(e).__name__}: {e}")
        return None


def extract_agent_summary(content: str) -> str:
    """Extract agent response summaries from session content (OpenKB 방식).

    Agent 블록에서 마지막 3줄만 추출하여 LLM 전송용 요약 생성.
    """
    agent_blocks = re.findall(
        r"(?:### \[Step \d+\] 🤖 Agent|## 🤖 Agent Answer)([\s\S]*?)(?=### \[Step \d+\]|# 📌 Turn \d+|$)",
        content,
    )
    summaries: list[str] = []
    for block in agent_blocks:
        cleaned = re.sub(r">\s*\*\*🛠️ Tool Call\*\*[\s\S]*?(?=> \*\*Result\*\*|$)", "", block)
        cleaned = re.sub(r">\s*\*\*Result\*\*[\s\S]*?(?=\n\n|$)", "", cleaned)
        cleaned = cleaned.strip()
        if cleaned:
            lines = [ln.strip() for ln in cleaned.split("\n") if ln.strip() and not ln.strip().startswith(">")]
            if lines:
                summaries.append(" ".join(lines[-3:]))
    result = "\n".join(summaries).strip()
    return result if result else content[:2000]


def extract(
    content: str,
    source_type: str = "joplin",
    model: str | None = None,
    engine: str = "ollama",
    api_key: str | None = None,
) -> dict:
    """Extract metadata + entities via LLM.

    - agent: agent 응답 블록에서 마지막 3줄만 추출 → LLM
    - joplin: 첫 2000자 → LLM
    """
    cfg = PreprocessConfig.from_env()
    model = model or cfg.llm_model

    if source_type == "agent":
        llm_input = extract_agent_summary(content)[:2000]
    else:
        llm_input = content[:2000]

    prompt = _DOC_METADATA_PROMPT.format(content=llm_input)
    base = f"http://{cfg.ollama_host}:{cfg.engine_ports.get(engine, 11434)}"

    try:
        if engine == "ollama":
            payload = json.dumps({
                "model": model, "prompt": prompt, "stream": False, "format": "json",
            }).encode("utf-8")
            headers = {"Content-Type": "application/json"}
            data = _request_json(f"{base}/api/generate", data=payload, headers=headers, timeout=180)
            if data:
                return _parse_response(data.get("response", ""))
        else:
            messages = [{"role": "user", "content": prompt}]
            payload = json.dumps({
                "model": model, "messages": messages, "stream": False,
                "response_format": {"type": "json_object"},
            }).encode("utf-8")
            headers = {"Content-Type": "application/json"}
            if api_key:
                headers["Authorization"] = f"Bearer {api_key}"
            data = _request_json(f"{base}/v1/chat/completions", data=payload, headers=headers, timeout=180)
            if data:
                choices = data.get("choices", [])
                if choices:
                    return _parse_response(choices[0].get("message", {}).get("content", ""))
    except Exception as e:
        print(f"LLM extraction failed: {e}")
    return {}


_MAP_PROMPT = """\
Extract key topics, technologies, concepts, and people mentioned in this text fragment.

Return a JSON object with:
- "topics": Array of key topics (up to 5)
- "entities": Array of {{"name": "...", "type": "technology|framework|language|tool|concept|person|organization"}}

Return ONLY valid JSON, no explanation.

Text:
{content}"""

_REDUCE_PROMPT = """\
Given the following summaries extracted from different parts of a document, determine the overall metadata and complete entity list.

Return a JSON object with:
- "title": A very brief Korean summary (under 45 characters) for use as a filename
- "description": A one-sentence description of the document's main topic
- "category": Broad domain category (e.g., backend, frontend, ai-ml, devops, database, language, architecture, tool, design)
- "sub_category": A more specific sub-domain within the category
- "tags": An array of 3-7 keyword tags (technologies, patterns, concepts)
- "entities": An array of all unique entities across all parts, each with "name" and "type"

Return ONLY valid JSON, no explanation.

Summaries:
{summaries}"""


def _call_llm(prompt: str, model: str, engine: str, api_key: str | None, base: str,
              timeout: int = 180, chunk_size: int = 1500, batch_label: str = "") -> str | None:
    try:
        if engine == "ollama":
            payload = json.dumps({
                "model": model, "prompt": prompt, "stream": False, "format": "json",
            }).encode("utf-8")
            headers = {"Content-Type": "application/json"}
            t0 = time.time()
            resp = _request_json(f"{base}/api/generate", data=payload, headers=headers, timeout=timeout)
            elapsed = time.time() - t0
            if resp is None:
                print(f"    {batch_label}FAILED (timeout {timeout}s, chunk_size={chunk_size})" if batch_label
                      else f"  ⚠️ LLM 요청 실패 (timeout {timeout}s)")
                return None
            print(f"    {batch_label}done ({elapsed:.1f}s, chunk_size={chunk_size})" if batch_label
                  else f"  LLM call done ({elapsed:.1f}s)")
            return resp.get("response", "")
        else:
            messages = [{"role": "user", "content": prompt}]
            payload = json.dumps({
                "model": model, "messages": messages, "stream": False,
                "response_format": {"type": "json_object"},
            }).encode("utf-8")
            headers = {"Content-Type": "application/json"}
            if api_key:
                headers["Authorization"] = f"Bearer {api_key}"
            t0 = time.time()
            resp = _request_json(f"{base}/v1/chat/completions", data=payload, headers=headers, timeout=timeout)
            elapsed = time.time() - t0
            if resp is None:
                print(f"    {batch_label}FAILED (timeout {timeout}s, chunk_size={chunk_size})" if batch_label
                      else f"  ⚠️ LLM 요청 실패 (timeout {timeout}s)")
                return None
            print(f"    {batch_label}done ({elapsed:.1f}s, chunk_size={chunk_size})" if batch_label
                  else f"  LLM call done ({elapsed:.1f}s)")
            choices = resp.get("choices", [])
            if choices:
                return choices[0].get("message", {}).get("content", "")
            return None
    except Exception as e:
        print(f"  ⚠️ LLM 호출 오류: {type(e).__name__}: {e}")
        return None


def extract_map_reduce(
    content: str,
    model: str | None = None,
    engine: str = "ollama",
    api_key: str | None = None,
    chunk_size: int = 1500,
    batch_size: int = 5,
) -> dict:
    """Map-Reduce extraction: split doc into chunks, extract per batch, then reduce.

    Map: 여러 chunk를 배치로 묶어 LLM 호출 (키워드/엔티티)
    Reduce: 모든 map 결과를 합쳐 최종 메타데이터 + 엔티티 종합
    """
    cfg = PreprocessConfig.from_env()
    model = model or cfg.llm_model
    base = f"http://{cfg.ollama_host}:{cfg.engine_ports.get(engine, 11434)}"

    chunks = [content[i:i + chunk_size] for i in range(0, len(content), chunk_size)]
    if not chunks:
        return {}

    n_chunks = len(chunks)
    n_batches = (n_chunks + batch_size - 1) // batch_size
    total_start = time.time()
    print(f"  Map-Reduce: {n_chunks} chunks, batch={batch_size}/{chunk_size}c, {n_batches} batches")

    all_entities: list[dict] = []
    all_topics: list[str] = []
    seen_entity_names: set[str] = set()
    errors = 0

    for batch_idx in range(n_batches):
        start = batch_idx * batch_size
        batch = chunks[start:start + batch_size]
        combined = "\n---\n".join(
            f"[Part {i + 1}]\n{chunk}" for i, chunk in enumerate(batch)
        )
        prompt = _MAP_PROMPT.format(content=combined)

        label = f"Map batch {batch_idx + 1}/{n_batches} "
        raw = _call_llm(prompt, model, engine, api_key, base,
                        timeout=180, chunk_size=chunk_size, batch_label=label)
        if raw:
            result = _parse_map_response(raw)
            for ent in result.get("entities", []):
                name = ent.get("name", "")
                if name and name not in seen_entity_names:
                    seen_entity_names.add(name)
                    all_entities.append(ent)
            all_topics.extend(result.get("topics", []))
        else:
            errors += 1

    if errors:
        print(f"  ⚠️ {errors}/{n_batches} batches failed, using partial results")

    summaries_data = {
        "topics": all_topics[:20],
        "entities": all_entities,
    }
    t0 = time.time()
    reduce_prompt = _REDUCE_PROMPT.format(
        summaries=json.dumps(summaries_data, ensure_ascii=False)[:3000],
    )
    raw = _call_llm(reduce_prompt, model, engine, api_key, base,
                    timeout=180, chunk_size=chunk_size, batch_label="Reduce ")
    if raw:
        result = _parse_response(raw)
        total = time.time() - total_start
        err_msg = f", errors: {errors}" if errors else ""
        print(f"  ✅ LLM total: {total:.1f}s{err_msg}")
        return result

    total = time.time() - total_start
    print(f"  ⚠️ Reduce failed, using partial results ({total:.1f}s)")
    return {
        "title": "",
        "description": "",
        "category": "",
        "sub_category": "",
        "tags": all_topics[:7],
        "entities": all_entities,
    }


def _parse_response(raw: str) -> dict:
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
            "entities": list(parsed.get("entities", [])),
        }
    except (json.JSONDecodeError, ValueError):
        return {}


def _parse_map_response(raw: str) -> dict:
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
            "topics": list(parsed.get("topics", [])),
            "entities": list(parsed.get("entities", [])),
        }
    except (json.JSONDecodeError, ValueError):
        return {}


def check_health(engine: str = "ollama", model: str | None = None) -> bool:
    cfg = PreprocessConfig.from_env()
    base = f"http://{cfg.ollama_host}:{cfg.engine_ports.get(engine, 11434)}"
    try:
        if engine == "ollama":
            data = _request_json(f"{base}/api/tags", timeout=5)
            if not data:
                return False
            if model:
                models = [m["name"] for m in data.get("models", [])]
                if model not in models:
                    print(f"  Model '{model}' not found in Ollama")
                    return False
        return True
    except Exception:
        return False


def list_models(engine: str, api_key: str | None = None) -> list[str]:
    cfg = PreprocessConfig.from_env()
    base = f"http://{cfg.ollama_host}:{cfg.engine_ports.get(engine, 11434)}"
    if engine == "ollama":
        data = _request_json(f"{base}/api/tags")
        if data:
            return [m["name"] for m in data.get("models", [])]
    elif engine in ("llama.cpp", "unsloth"):
        headers = {}
        if api_key:
            headers["Authorization"] = f"Bearer {api_key}"
        data = _request_json(f"{base}/v1/models", headers=headers, timeout=5)
        if data:
            return [m["id"] for m in data.get("data", [])]
    return []


def find_gguf_models() -> list[tuple[str, str]]:
    hub = Path.home() / ".cache" / "huggingface" / "hub"
    if not hub.exists():
        return []
    results: list[tuple[str, str]] = []
    for model_dir in hub.iterdir():
        if not model_dir.name.startswith("models--"):
            continue
        name_parts = model_dir.name.replace("models--", "").split("--")
        display = "/".join(name_parts)
        snaps = model_dir / "snapshots"
        if not snaps.exists():
            continue
        for commit_dir in snaps.iterdir():
            if not commit_dir.is_dir():
                continue
            gguf_files = [f for f in commit_dir.iterdir()
                          if f.suffix == ".gguf" and not f.name.startswith("mmproj") and f.is_file()]
            if not gguf_files:
                continue
            total_size = sum(f.stat().st_size for f in gguf_files) / (1024**3)
            results.append((f"{display} ({total_size:.1f}GB)", str(gguf_files[0])))
    return results
