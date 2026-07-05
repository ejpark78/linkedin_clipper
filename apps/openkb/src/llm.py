"""
OpenKB LLM Client — 추상화된 LLM 엔진 인터페이스 (Ollama / llama.cpp / unsloth).

의존성: config (엔드포인트, 포트)
"""
from __future__ import annotations

import json
import os
import subprocess
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

from config import OpenKbConfig


def _request_json(url: str, data: bytes | None = None, headers: dict | None = None, timeout: int = 10) -> dict | None:
    try:
        req = urllib.request.Request(url, data=data, headers=headers or {})
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except Exception:
        return None


class LLMClient:
    """LLM 엔진 추상화. 싱글톤 config 사용."""

    _config: OpenKbConfig | None = None
    _server_proc: subprocess.Popen | None = None

    @classmethod
    def _cfg(cls) -> OpenKbConfig:
        if cls._config is None:
            cls._config = OpenKbConfig.from_env()
        return cls._config

    @classmethod
    def _api_base(cls, engine: str) -> str:
        return cls._cfg().api_url(engine)

    @classmethod
    def list_models(cls, engine: str, api_key: str | None = None) -> list[str]:
        base = cls._api_base(engine)
        if engine == "ollama":
            data = _request_json(f"{base}/api/tags")
            if data:
                return [m["name"] for m in data.get("models", [])]
        elif engine in ("llama.cpp", "unsloth"):
            headers: dict[str, str] = {}
            if api_key:
                headers["Authorization"] = f"Bearer {api_key}"
            data = _request_json(f"{base}/v1/models", headers=headers, timeout=5)
            if data:
                return [m["id"] for m in data.get("data", [])]
        return []

    @classmethod
    def find_gguf_models(cls) -> list[tuple[str, str]]:
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

    @classmethod
    def check_health(cls, engine: str, model: str | None = None, api_key: str | None = None) -> bool:
        base = cls._api_base(engine)
        print(f"\U0001fa79 Checking {engine} health at {base}...")
        try:
            if engine == "ollama":
                data = _request_json(f"{base}/api/tags")
                if not data:
                    return False
                if model:
                    models = [m["name"] for m in data.get("models", [])]
                    if model not in models:
                        print(f"   \u26a0\ufe0f Model '{model}' not found")
            elif engine == "unsloth":
                if not _request_json(f"{base}/api/health", timeout=3):
                    return False
            elif engine == "llama.cpp":
                headers: dict[str, str] = {}
                if api_key:
                    headers["Authorization"] = f"Bearer {api_key}"
                if not _request_json(f"{base}/v1/models", headers=headers, timeout=3):
                    return False
            print("\u26a1 Testing LLM inference with dummy request...")
            summary = cls.summarize("hello", model or "test", engine=engine, api_key=api_key)
            if summary:
                print("   \u2705 Health check passed.")
                return True
            print("   \u274c Inference failed.")
            return False
        except Exception as e:
            print(f"   \u274c Health check failed: {e}")
            return False

    @classmethod
    def summarize(cls, text: str, model: str, engine: str = "ollama", api_key: str | None = None) -> str:
        base = cls._api_base(engine)
        prompt = _build_summary_prompt(text)
        try:
            if engine == "ollama":
                payload = json.dumps({"model": model, "prompt": prompt, "stream": False}).encode("utf-8")
                headers = {"Content-Type": "application/json"}
                data = _request_json(f"{base}/api/generate", data=payload, headers=headers, timeout=180)
                if data:
                    raw = data.get("response", "").strip()
                    return _clean_summary(raw)
            else:
                messages = [{"role": "user", "content": prompt}]
                payload = json.dumps({"model": model, "messages": messages, "stream": False}).encode("utf-8")
                headers = {"Content-Type": "application/json"}
                if api_key:
                    headers["Authorization"] = f"Bearer {api_key}"
                data = _request_json(f"{base}/v1/chat/completions", data=payload, headers=headers, timeout=180)
                if data:
                    choices = data.get("choices", [])
                    if choices:
                        raw = choices[0].get("message", {}).get("content", "").strip()
                        return _clean_summary(raw)
        except Exception as e:
            print(f"\u26a0\ufe0f Summary failed: {e}")
        return ""

    @classmethod
    def extract_metadata(cls, prompt: str, model: str, engine: str = "ollama", api_key: str | None = None) -> dict:
        """LLM 호출로 구조화된 메타데이터(JSON) 추출."""
        base = cls._api_base(engine)
        try:
            if engine == "ollama":
                payload = json.dumps({
                    "model": model, "prompt": prompt, "stream": False, "format": "json",
                }).encode("utf-8")
                headers = {"Content-Type": "application/json"}
                data = _request_json(f"{base}/api/generate", data=payload, headers=headers, timeout=180)
                if data:
                    return _parse_llm_metadata_response(data.get("response", ""))
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
                        return _parse_llm_metadata_response(choices[0].get("message", {}).get("content", ""))
        except Exception as e:
            print(f"\u26a0\ufe0f Metadata extraction failed: {e}")
        return {}

    # --- Server lifecycle (llama.cpp) ---

    @classmethod
    def start_llama_server(cls, model_path: str, port: int = 8080) -> subprocess.Popen | None:
        if cls._server_proc and cls._server_proc.poll() is None:
            print("   \u26a0\ufe0f llama-server already running.")
            return cls._server_proc

        candidates = ["llama-server", "/opt/homebrew/bin/llama-server"]
        server_bin = next((c for c in candidates if Path(c).exists()), None)
        if not server_bin:
            print("   \u274c llama-server not found.")
            return None

        print(f"\U0001f680 Starting llama-server on port {port}...")
        try:
            proc = subprocess.Popen(
                [server_bin, "-m", model_path, "--host", "127.0.0.1", "--port", str(port), "--no-web-ui"],
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            )
            for _ in range(30):
                time.sleep(1)
                if proc.poll() is not None:
                    print("   \u274c llama-server exited prematurely.")
                    return None
                if _request_json(f"http://127.0.0.1:{port}/v1/models", timeout=2):
                    print(f"   \u2705 llama-server ready (port {port}).")
                    cls._server_proc = proc
                    return proc
            print("   \u274c llama-server startup timed out.")
            proc.kill()
            return None
        except Exception as e:
            print(f"   \u274c Failed to start llama-server: {e}")
            return None

    @classmethod
    def stop_llama_server(cls) -> None:
        if cls._server_proc and cls._server_proc.poll() is None:
            print("\U0001f6d1 Stopping llama-server...")
            cls._server_proc.terminate()
            try:
                cls._server_proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                cls._server_proc.kill()
            cls._server_proc = None
            print("   \u2705 Stopped.")


# ====================================================================
# Internal helpers
# ====================================================================

def _build_summary_prompt(text: str) -> str:
    return (
        "Below is the content from an agent session.\n"
        "Generate a very brief Korean summary "
        "(under 45 characters, using Korean, English, numbers, spaces, and underscores)\n"
        "representing the core resolution or actions taken.\n"
        "Output ONLY the summary text, with no extra explanation, quotes, or markdown.\n\n"
        f"Content:\n{text[:1500]}"
    )


def _clean_summary(raw: str) -> str:
    import re
    clean = re.sub(r"[^a-zA-Z0-9\u3131-\u3163\uac00-\ud7a3\s_]", "", raw)
    clean = re.sub(r"\s+", " ", clean).strip()[:50]
    return clean


def _parse_llm_metadata_response(raw: str) -> dict:
    import re
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
