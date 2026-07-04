import json
import os
import re
import subprocess
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

import click

# ===========================================================================
# 환경 경로 동적 감지
# ===========================================================================
if Path("/data").exists():
    PROJECT_ROOT = Path("/data")
    OLLAMA_HOST = "host.docker.internal"
else:
    PROJECT_ROOT = Path("/Users/ejpark/workspace/scraper/data")
    OLLAMA_HOST = "127.0.0.1"

DUMP_DIR = (PROJECT_ROOT / "agents").resolve()
JOPLIN_DIR = (PROJECT_ROOT / "joplin").resolve()
OPENKB_DIR = (PROJECT_ROOT / "openkb").resolve()
RAW_STORE = OPENKB_DIR / "raw"
CACHE_PATH = OPENKB_DIR / ".openkb_cache.json"

OLLAMA_ENDPOINT = f"http://{OLLAMA_HOST}:11434/api/generate"
OLLAMA_TAGS_ENDPOINT = f"http://{OLLAMA_HOST}:11434/api/tags"

if OPENKB_DIR.exists():
    os.chdir(OPENKB_DIR)

# ===========================================================================
# 캐시
# ===========================================================================
class OpenKbCache:
    cache_data: dict[str, float]

    def __init__(self, cache_path: Path) -> None:
        self.cache_path = cache_path
        self.cache_data = {}
        self.load()

    def load(self) -> None:
        if self.cache_path.exists():
            try:
                with open(self.cache_path, encoding="utf-8") as f:
                    self.cache_data = json.load(f)
            except Exception:
                self.cache_data = {}

    def is_up_to_date(self, file_path: str, mtime_ms: float) -> bool:
        return self.cache_data.get(file_path) == mtime_ms

    def update(self, file_path: str, mtime_ms: float) -> None:
        self.cache_data[file_path] = mtime_ms
        try:
            with open(self.cache_path, "w", encoding="utf-8") as f:
                json.dump(self.cache_data, f, indent=2)
        except Exception:
            pass

# ===========================================================================
# LLM 엔진 추상화 (Ollama / llama.cpp / Unsloth)
# ===========================================================================
ENGINE_PORTS = {"ollama": 11434, "llama.cpp": 8080, "unsloth": 8888}

_llama_server_proc: subprocess.Popen | None = None

def _api_url(engine: str) -> str:
    return f"http://{OLLAMA_HOST}:{ENGINE_PORTS[engine]}"

def _request_json(url: str, data: bytes | None = None, headers: dict | None = None, timeout: int = 10) -> dict | None:
    try:
        req = urllib.request.Request(url, data=data, headers=headers or {})
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except Exception:
        return None

class LLMClient:
    @staticmethod
    def list_models(engine: str, api_key: str | None = None) -> list[str]:
        base = _api_url(engine)
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

    @staticmethod
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
            blobs_dir = model_dir / "blobs"
            if blobs_dir.exists():
                for blob in blobs_dir.iterdir():
                    if blob.is_file() and not blob.name.startswith("."):
                        size_gb = blob.stat().st_size / (1024**3)
                        label = f"{display} ({size_gb:.1f}GB)"
                        results.append((label, str(blob)))
        return results

    @staticmethod
    def check_health(engine: str, model: str | None = None, api_key: str | None = None) -> bool:
        base = _api_url(engine)
        print(f"🩺 Checking {engine} health at {base}...")
        try:
            if engine == "ollama":
                data = _request_json(f"{base}/api/tags")
                if not data:
                    return False
                if model:
                    models = [m["name"] for m in data.get("models", [])]
                    if model not in models:
                        print(f"   ⚠️ Model '{model}' not found")
            elif engine == "unsloth":
                if not _request_json(f"{base}/api/health", timeout=3):
                    return False
            elif engine == "llama.cpp":
                headers = {}
                if api_key:
                    headers["Authorization"] = f"Bearer {api_key}"
                if not _request_json(f"{base}/v1/models", headers=headers, timeout=3):
                    return False

            print("⚡ Testing LLM inference with dummy request...")
            summary = LLMClient.summarize("hello", model or "test", engine=engine, api_key=api_key)
            if summary:
                print("   ✅ Health check passed.")
                return True
            print("   ❌ Inference failed.")
            return False
        except Exception as e:
            print(f"   ❌ Health check failed: {e}")
            return False

    @staticmethod
    def summarize(
        text: str, model: str, agent: str | None = None,
        engine: str = "ollama", api_key: str | None = None,
    ) -> str:
        base = _api_url(engine)
        try:
            if engine == "ollama":
                prompt = _build_summary_prompt(text, agent)
                payload = json.dumps({"model": model, "prompt": prompt, "stream": False}).encode("utf-8")
                headers = {"Content-Type": "application/json"}
                data = _request_json(f"{base}/api/generate", data=payload, headers=headers, timeout=180)
                if data:
                    raw = data.get("response", "").strip()
                    return _clean_summary(raw)
            else:
                prompt = _build_summary_prompt(text, agent)
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
            print(f"⚠️ Summary failed: {e}")
        return ""

    @staticmethod
    def start_llama_server(model_path: str, port: int = 8080) -> subprocess.Popen | None:
        global _llama_server_proc
        if _llama_server_proc and _llama_server_proc.poll() is None:
            print("   ⚠️ llama-server already running.")
            return _llama_server_proc

        server_bin = None
        candidates = ["llama-server", "/opt/homebrew/bin/llama-server"]
        for c in candidates:
            if Path(c).exists():
                server_bin = c
                break
        if not server_bin:
            print("   ❌ llama-server not found.")
            return None

        print(f"🚀 Starting llama-server on port {port}...")
        try:
            proc = subprocess.Popen(
                [server_bin, "-m", model_path, "--host", "127.0.0.1", "--port", str(port), "--no-web-ui"],
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            )
            for i in range(30):
                time.sleep(1)
                if proc.poll() is not None:
                    print("   ❌ llama-server exited prematurely.")
                    return None
                data = _request_json(f"http://127.0.0.1:{port}/v1/models", timeout=2)
                if data:
                    print(f"   ✅ llama-server ready (port {port}).")
                    _llama_server_proc = proc
                    return proc
            print("   ❌ llama-server startup timed out.")
            proc.kill()
            return None
        except Exception as e:
            print(f"   ❌ Failed to start llama-server: {e}")
            return None

    @staticmethod
    def stop_llama_server():
        global _llama_server_proc
        if _llama_server_proc and _llama_server_proc.poll() is None:
            print("🛑 Stopping llama-server...")
            _llama_server_proc.terminate()
            try:
                _llama_server_proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                _llama_server_proc.kill()
            _llama_server_proc = None
            print("   ✅ Stopped.")

def _build_summary_prompt(agent_res: str, agent: str | None = None) -> str:
    if agent == "codex":
        return (
            "다음은 Codex 세션 transcript에서 추출한 최종 요약 재료입니다.\n"
            "세션의 핵심 작업, 결과, 해결 여부를 45자 이내 한국어 한 줄로 요약하세요.\n"
            "불필요한 설명, 따옴표, 마크다운, 접두어는 출력하지 마세요.\n\n"
            f"Codex Session Material:\n{agent_res[:1500]}"
        )
    return (
        "Below is the list of key response summaries and conclusions from an agent during a session.\n"
        "Please generate a very brief Korean summary "
        "(under 45 characters, using Korean, English, numbers, spaces, and underscores)\n"
        "representing the core resolution or actions taken during this session.\n"
        "Output ONLY the summary text, with no extra explanation, quotes, or markdown.\n\n"
        f"Agent Response:\n{agent_res[:1500]}"
    )

def _is_gguf_path(path: str) -> bool:
    p = Path(path)
    return p.is_file() and p.suffix == ".gguf"

def _clean_summary(raw: str) -> str:
    clean = re.sub(r"[^a-zA-Z0-9ㄱ-ㅎㅏ-ㅣ가-힣\s_]", "", raw)
    clean = re.sub(r"\s+", " ", clean).strip()[:50]
    return clean

# ===========================================================================
# 헬퍼 함수
# ===========================================================================
def extract_title(
    content: str, date_folder: str, model: str,
    engine: str = "ollama", api_key: str | None = None,
) -> str:
    date_part = date_folder.split("T")[0]

    frontmatter_title = re.search(r"^title:\s*(.+)$", content, re.MULTILINE)
    frontmatter_model = re.search(r"^model:\s*(.+)$", content, re.MULTILINE)
    frontmatter_agent = re.search(r"^agent:\s*(.+)$", content, re.MULTILINE)
    if frontmatter_title:
        title_value = frontmatter_title.group(1).strip()
        if title_value:
            return f"{date_part}_{re.sub(r'[^a-zA-Z0-9ㄱ-ㅎㅏ-ㅣ가-힣\s]', '', title_value)[:40]}.md"
    if frontmatter_agent and frontmatter_agent.group(1).strip() == "codex":
        codex_title = re.search(r"^title:\s*Codex:\s*(.+)$", content, re.MULTILINE)
        if codex_title:
            title_value = codex_title.group(1).strip()
            if title_value:
                return f"{date_part}_codex_{re.sub(r'[^a-zA-Z0-9ㄱ-ㅎㅏ-ㅣ가-힣\s]', '', title_value)[:36]}.md"
    if frontmatter_model:
        model_value = frontmatter_model.group(1).strip()
        if model_value:
            model = model_value

    issue_match = re.search(r"(?:#|이슈\s*|버그\s*|feature/)([0-9]{3})", content, re.IGNORECASE)

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
                verdict_lines = lines[-3:]
                agent_summaries.append(" ".join(verdict_lines))

    agent_response_combined = "\n".join(agent_summaries).strip()
    if not agent_response_combined:
        agent_response_combined = content[:2000]

    summary = LLMClient.summarize(
        agent_response_combined, model, extract_agent(content),
        engine=engine, api_key=api_key,
    )
    if summary:
        if issue_match:
            issue_no = f"#{issue_match.group(1)}"
            if issue_no not in summary:
                return f"{date_part}_{issue_no}_{summary}.md"
        return f"{date_part}_{summary}.md"

    first_request_match = re.search(r"<USER_REQUEST>([\s\S]*?)</USER_REQUEST>", content)
    first_request_text = first_request_match.group(1).strip() if first_request_match else ""
    if not first_request_text:
        first_request_text = content[:500]

    if issue_match:
        issue_no = f"_#{issue_match.group(1)}"
        first_line = first_request_text.split("\n")[0] if first_request_text else "issue_task"
        first_line = re.sub(r"[#*`~\[\]\(\)<>\-_]", " ", first_line)
        first_line = re.sub(r"https?://[^\s]+", "", first_line).strip()
        clean_title = re.sub(r"[^a-zA-Z0-9ㄱ-ㅎㅏ-ㅣ가-힣\s]", "", first_line)
        clean_title = re.sub(r"\s+", " ", clean_title).strip()[:40]
        if not clean_title:
            clean_title = "issue_task"
        return f"{date_part}{issue_no}_{clean_title}.md"

    if first_request_text:
        first_line = first_request_text.split("\n")[0]
        first_line = re.sub(r"[#*`~\[\]\(\)<>\-_]", " ", first_line).strip()
        clean_title = re.sub(r"[^a-zA-Z0-9ㄱ-ㅎㅏ-ㅣ가-힣\s]", "", first_line)
        clean_title = re.sub(r"\s+", " ", clean_title).strip()[:40]
        if clean_title:
            return f"{date_part}_{clean_title}.md"

    return f"{date_part}_agent_session.md"

def extract_agent(content: str) -> str | None:
    match = re.search(r"^agent:\s*(.+)$", content, re.MULTILINE)
    return match.group(1).strip() if match else None

def clean_broken_links(content: str, session_dir: Path) -> str:
    def replace_link(match: re.Match) -> str:
        text = match.group(1)
        url = match.group(2)
        if url.startswith("http://") or url.startswith("https://"):
            return match.group(0)
        clean_url = url.replace("file://", "")
        if clean_url.startswith("./") or not clean_url.startswith("/"):
            target_path = (session_dir / clean_url).resolve()
        else:
            target_path = Path(clean_url).resolve()
        if not target_path.exists():
            return text
        return match.group(0)

    return re.sub(r"\[([^\]]+)\]\(([^)]+)\)", replace_link, content)

def normalize_agent_content(content: str) -> str:
    cleaned = re.sub(r"^\[tool-event\]\s*$", "", content, flags=re.MULTILINE)
    cleaned = re.sub(r"^\[(TRACE|DEBUG|INFO|WARN|ERROR)\]\s+[^\n]+\n", "", cleaned, flags=re.MULTILINE)
    cleaned = re.sub(r"\n{3,}", "\n\n", cleaned)
    return cleaned.strip()

def find_transcripts(directory: Path, filename: str) -> list[Path]:
    results = []
    if not directory.exists():
        return results
    for root, _, files in os.walk(directory):
        for f in files:
            if f == filename:
                results.append(Path(root) / f)
    return results

def find_agent_docs(directory: Path) -> list[Path]:
    results = []
    if not directory.exists():
        return results
    seen_sessions = set()
    for root, _, files in os.walk(directory):
        session_id = Path(root).name
        if session_id in seen_sessions:
            continue
        if "session.md" in files:
            results.append(Path(root) / "session.md")
            seen_sessions.add(session_id)
        elif "transcript.md" in files:
            results.append(Path(root) / "transcript.md")
            seen_sessions.add(session_id)
    return results

def find_joplin_files(directory: Path) -> list[Path]:
    results = []
    if not directory.exists():
        return results
    for root, _, files in os.walk(directory):
        for f in files:
            if f.endswith(".md") and not f.startswith("."):
                if ".tmp_export" in root:
                    continue
                results.append(Path(root) / f)
    return results

# ===========================================================================
# 핵심 컴파일 함수
# ===========================================================================
def compile_command(  # noqa: PLR0912, PLR0915

    input_paths: tuple[str, ...] | None = None,
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
    no_clean: bool = False,
    llama_port: int = 8080,
):
    """Compile agent transcripts and Joplin notes into OpenKB knowledge base."""
    print(f"🤖 OpenKB Compile Pipeline (engine: {engine})")

    # 환경변수 fallback
    if not model:
        raw_model = os.environ.get("OLLAMA_MODEL") or os.environ.get("LLM_MODEL")
        if raw_model:
            model = raw_model
    if not engine:
        engine = os.environ.get("LLM_ENGINE", "ollama")
    if not api_key:
        api_key = os.environ.get("UNSLOTH_API_KEY")

    # 모델 결정
    if engine == "ollama" and not model:
        model = _detect_ollama_model()
    print(f"🧠 Model: [{model or 'auto'}]")

    # llama.cpp: start server if GGUF path given as model
    _started_server = False
    if engine == "llama.cpp" and model:
        if _is_gguf_path(model):
            server_proc = LLMClient.start_llama_server(model, port=llama_port)
            if server_proc:
                _started_server = True
                print(f"   llama-server running on port {llama_port}")

    # 헬스체크
    if not LLMClient.check_health(engine, model, api_key):
        print("❌ Pipeline aborted: LLM health check failed.")
        LLMClient.stop_llama_server()
        exit(1)

    # RAW_STORE 초기화 (출력 경로)
    raw_store = Path(output_path) if output_path else RAW_STORE
    if not no_clean:
        print("🧹 Clearing RAW_STORE...")
        if raw_store.exists():
            for item in raw_store.iterdir():
                if item.is_file():
                    item.unlink()
    raw_store.mkdir(parents=True, exist_ok=True)

    # 입력 경로 결정
    input_dirs = _resolve_input_dirs(input_paths)

    # SAMPLE
    if sample is None:
        sample_env = os.environ.get("SAMPLE")
        sample = int(sample_env) if sample_env and sample_env.strip().isdigit() else None

    # 날짜 파싱
    date_from_dt = _parse_date(date_from or os.environ.get("DATE_FROM"))
    date_to_dt = _parse_date(date_to or os.environ.get("DATE_TO"))

    # 캐시 초기화
    cache = OpenKbCache(CACHE_PATH)

    # 에이전트 문서 처리
    processed_count = 0
    skipped_count = 0
    compile_agents = any("agents" in str(d) for d in input_dirs)
    compile_joplin = any("joplin" in str(d) for d in input_dirs)

    if compile_agents:
        src_dir = _find_agent_source_dir(input_dirs)
        if src_dir:
            transcripts = find_agent_docs(src_dir)
            transcripts = _filter_by_date(transcripts, date_from_dt, date_to_dt)
            transcripts = _filter_by_agent_type(transcripts, agents)

            print(f"📁 Agent transcripts: {len(transcripts)}")
            saved = 0
            for i, file_path in enumerate(transcripts):
                if sample is not None and saved >= sample:
                    print(f"   🧪 Sample limit {sample} reached.")
                    break

                mtime = file_path.stat().st_mtime
                percent = int(((i + 1) / len(transcripts)) * 100)

                if not no_cache and cache.is_up_to_date(str(file_path), mtime):
                    skipped_count += 1
                    continue

                relative_path = file_path.relative_to(src_dir)
                print(f"   [{i + 1}/{len(transcripts)}] ({percent}%) {relative_path}")

                try:
                    date_folder = file_path.parent.parent.name
                    session_dir = file_path.parent

                    with open(file_path, encoding="utf-8") as f:
                        content = f.read()

                    if not content or len(content.strip()) < 10:
                        print("   ⚠️ Empty doc")
                        continue

                    content = normalize_agent_content(content)
                    content = clean_broken_links(content, session_dir)
                    title = extract_title(content, date_folder, model or "", engine=engine, api_key=api_key)

                    title_clean = title.replace(".md", "")
                    if len(title_clean) <= 12 or title_clean[10:].strip(" _") == "":
                        print(f"   ⚠️ Invalid title: '{title}'")
                        continue

                    skip_keywords = [
                        "조치_없음", "no suggestions", "no_suggestions",
                        "suggestions_none", "조치없음", "무엇이든 답변", "무엇이든답변",
                    ]
                    if any(k in title_clean.lower() for k in skip_keywords):
                        print(f"   ⚠️ No-op session: '{title}'")
                        continue

                    dest = raw_store / title
                    with open(dest, "w", encoding="utf-8") as f:
                        f.write(content)
                    print(f"      + Saved: {title}")
                    cache.update(str(file_path), mtime)
                    saved += 1
                    processed_count += 1

                    if sample is not None and saved >= sample:
                        break

                except Exception as e:
                    print(f"❌ Error [{file_path}]: {e}")
        else:
            print("⏭️ No agent source directory found.")
    else:
        print("⏭️ Agent transcripts skipped.")

    # Joplin 문서 처리
    joplin_processed = 0
    joplin_skipped = 0

    if compile_joplin:
        joplin_dir = _find_joplin_source_dir(input_dirs)
        if joplin_dir:
            joplin_files = find_joplin_files(joplin_dir)
            joplin_files = _filter_joplin_notebook(joplin_files, joplin_notebooks)
            print(f"📁 Joplin notes: {len(joplin_files)}")

            for i, file_path in enumerate(joplin_files):
                if sample is not None and joplin_processed >= sample:
                    print(f"   🧪 Sample limit {sample} reached.")
                    break

                mtime = file_path.stat().st_mtime
                if not no_cache and cache.is_up_to_date(str(file_path), mtime):
                    joplin_skipped += 1
                    continue

                try:
                    notebook_name = file_path.parent.name
                    filename = file_path.name
                    dest_filename = f"Joplin_{notebook_name}_{filename}"
                    dest_path = raw_store / dest_filename

                    with open(file_path, encoding="utf-8") as f:
                        content = f.read()

                    if not content.startswith("---"):
                        header = f"---\nsource: Joplin\nnotebook: {notebook_name}\n---\n\n"
                        content = header + content

                    with open(dest_path, "w", encoding="utf-8") as f:
                        f.write(content)

                    print(f"      + Joplin: {dest_filename}")
                    cache.update(str(file_path), mtime)
                    joplin_processed += 1
                except Exception as e:
                    print(f"❌ Joplin error [{file_path}]: {e}")
        else:
            print("⏭️ No Joplin source directory found.")
    else:
        print("⏭️ Joplin notes skipped.")

    print(
        f"✨ Processed: {processed_count} agents, {joplin_processed} joplin "
        f"| Skipped: {skipped_count}, {joplin_skipped}"
    )

    # OpenKB compile
    print("🧠 Running openkb add...")
    raw_contents = os.listdir(raw_store) if raw_store.exists() else []
    if raw_contents:
        _run_openkb_add(raw_store, engine, model, api_key)
    else:
        print("   No files to compile.")

    LLMClient.stop_llama_server()


def _detect_ollama_model() -> str:
    preferred = os.environ.get("LLM_MODEL", "qwen3.5:9b-mlx")
    models = LLMClient.list_models("ollama")
    if preferred in models:
        return preferred
    if models:
        return models[0]
    return preferred


def _resolve_input_dirs(input_paths: tuple[str, ...] | None) -> list[Path]:
    if input_paths:
        result = []
        for p in input_paths:
            pp = Path(p)
            if pp.is_absolute():
                result.append(pp)
            else:
                # Try relative to PROJECT_ROOT first, then cwd
                cand = PROJECT_ROOT / pp
                if not cand.exists():
                    cand = Path.cwd().joinpath(pp)
                result.append(cand)
        return result
    raw_env = os.environ.get("RAW", "data/agents,data/joplin")
    targets = [t.strip() for t in raw_env.split(",") if t.strip()]
    # RAW env var paths (e.g. "data/agents") include a "data/" prefix.
    # Since PROJECT_ROOT is already /data, strip the prefix.
    result = []
    for t in targets:
        parts = Path(t).parts
        if len(parts) > 1 and parts[0] == "data":
            sub = Path(*parts[1:])
        else:
            sub = Path(t)
        cand = PROJECT_ROOT / sub
        result.append(cand)
    return result


def _find_agent_source_dir(input_dirs: list[Path]) -> Path | None:
    for d in input_dirs:
        if "agents" in str(d):
            return d
    return DUMP_DIR if DUMP_DIR.exists() else None


def _find_joplin_source_dir(input_dirs: list[Path]) -> Path | None:
    for d in input_dirs:
        if "joplin" in str(d):
            return d
    return JOPLIN_DIR if JOPLIN_DIR.exists() else None


def _parse_date(s: str | None) -> str | None:
    if not s:
        return None
    s = s.strip()
    if re.match(r"^\d{4}-\d{2}-\d{2}$", s):
        return s
    return None


def _filter_by_date(files: list[Path], date_from: str | None, date_to: str | None) -> list[Path]:
    if not date_from and not date_to:
        return files
    result = []
    for f in files:
        date_str = f.parent.parent.name
        date_match = re.match(r"(\d{4}-\d{2}-\d{2})", date_str)
        if not date_match:
            result.append(f)
            continue
        d = date_match.group(1)
        if date_from and d < date_from:
            continue
        if date_to and d > date_to:
            continue
        result.append(f)
    return result


def _filter_by_agent_type(files: list[Path], agent_types: tuple[str, ...] | None) -> list[Path]:
    if not agent_types:
        return files
    types = set(agent_types)
    return [f for f in files if f.parent.parent.parent.name in types]


def _filter_joplin_notebook(files: list[Path], notebooks: tuple[str, ...] | None) -> list[Path]:
    if not notebooks:
        return files
    nb_set = set(notebooks)
    return [f for f in files if f.parent.name in nb_set]


def _run_openkb_add(raw_store: Path, engine: str, model: str | None, api_key: str | None):
    env = os.environ.copy()
    if engine == "ollama":
        env["OPENAI_API_BASE"] = f"http://{OLLAMA_HOST}:11434/v1"
    elif engine == "llama.cpp":
        env["OPENAI_API_BASE"] = f"http://{OLLAMA_HOST}:8080/v1"
    elif engine == "unsloth":
        env["OPENAI_API_BASE"] = f"http://{OLLAMA_HOST}:8888/v1"
        if api_key:
            env["OPENAI_API_KEY"] = api_key
    if model:
        env["LLM_MODEL"] = model

    try:
        subprocess.run(["openkb", "add", str(raw_store)], env=env, check=True)
        print("✅ OpenKB compile complete.")
    except subprocess.CalledProcessError as e:
        print(f"❌ openkb add failed: {e}")
        exit(1)


# ===========================================================================
# TUI 대화형 모드
# ===========================================================================
def run_tui(**defaults: Any) -> dict[str, Any]:
    try:
        from prompt_toolkit.shortcuts import input_dialog, message_dialog, radiolist_dialog
    except ImportError:
        print("⚠️ prompt_toolkit not available. Run in CLI mode or install prompt_toolkit.")
        return defaults

    result: dict[str, Any] = {}

    # --- 1. 엔진 선택 ---
    engine_choices = [
        ("ollama", "Ollama (localhost:11434)"),
        ("llama.cpp", "llama.cpp (port 8080 / 자동 실행)"),
        ("unsloth", "Unsloth Studio (localhost:8888)"),
    ]
    sel = radiolist_dialog(
        title="🔧 LLM 엔진 선택",
        text="사용할 LLM 백엔드를 선택하세요:",
        values=engine_choices,
        default=defaults.get("engine", "ollama"),
    ).run()
    if sel is None:
        return defaults
    result["engine"] = sel

    # --- 2. API Key (Unsloth) ---
    api_key = defaults.get("api_key") or os.environ.get("UNSLOTH_API_KEY")
    if sel == "unsloth" and not api_key:
        api_key = input_dialog(
            title="🔑 Unsloth Studio API Key",
            text="Unsloth Studio의 API Key를 입력하세요 (Settings > API Keys):",
        ).run()
        if api_key is None:
            return defaults
    result["api_key"] = api_key

    # --- 3. 모델 선택 ---
    result["model"] = _tui_select_model(sel, api_key, defaults.get("model"))

    # --- 4. 입력 대상 ---
    inputs = _tui_select_inputs(defaults.get("input_paths", ()))
    if inputs.get("input_paths") is not None:
        result["input_paths"] = inputs["input_paths"]
    if inputs.get("agents") is not None:
        result["agents"] = inputs["agents"]
    if inputs.get("joplin_notebooks") is not None:
        result["joplin_notebooks"] = inputs["joplin_notebooks"]

    # --- 5. 날짜 범위 ---
    date_from = input_dialog(
        title="📅 시작일 (선택)",
        text="시작 날짜를 입력하세요 (YYYY-MM-DD, 생략 가능):",
        default=defaults.get("date_from") or "",
    ).run()
    date_to = input_dialog(
        title="📅 종료일 (선택)",
        text="종료 날짜를 입력하세요 (YYYY-MM-DD, 생략 가능):",
        default=defaults.get("date_to") or "",
    ).run()
    if date_from is not None:
        result["date_from"] = _parse_date(date_from) if date_from.strip() else None
    if date_to is not None:
        result["date_to"] = _parse_date(date_to) if date_to.strip() else None

    # --- 6. 출력 경로 ---
    out = input_dialog(
        title="📁 출력 경로",
        text="출력 raw store 경로를 입력하세요:\n(없으면 새 디렉토리가 자동 생성됩니다)",
        default=defaults.get("output_path") or str(RAW_STORE),
    ).run()
    if out is not None and out.strip():
        result["output_path"] = out.strip()
        Path(result["output_path"]).mkdir(parents=True, exist_ok=True)

    # --- 7. SAMPLE ---
    sample_str = input_dialog(
        title="🧪 Sample 제한 (선택)",
        text="처리할 최대 파일 수를 입력하세요 (생략 시 전체 처리):",
        default=str(defaults.get("sample") or ""),
    ).run()
    if sample_str is not None and sample_str.strip().isdigit():
        result["sample"] = int(sample_str)
    else:
        result["sample"] = None

    message_dialog(
        title="✅ 설정 완료",
        text=f"엔진: {result['engine']}\n"
             f"모델: {result.get('model', 'auto')}\n"
             f"출력: {result.get('output_path', str(RAW_STORE))}\n\n"
             "컴파일을 시작합니다.",
    ).run()

    return result


def _tui_select_model(engine: str, api_key: str | None, default_model: str | None) -> str | None:
    from prompt_toolkit.shortcuts import input_dialog, message_dialog, radiolist_dialog

    if engine == "llama.cpp":
        gguf_list = LLMClient.find_gguf_models()
        if gguf_list:
            values = [(p, label) for label, p in gguf_list]
            sel = radiolist_dialog(
                title="🔧 모델 선택 (GGUF)",
                text="HuggingFace Cache에서 발견된 GGUF 모델:",
                values=values,
            ).run()
            return sel

        sel = radiolist_dialog(
            title="🔧 llama.cpp 모델",
            text="캐시된 GGUF 모델이 없습니다.\n직접 GGUF 파일 경로를 입력하시겠습니까?",
            values=[("__manual__", "직접 경로 입력")],
        ).run()
        if sel == "__manual__":
            path = input_dialog(title="GGUF 경로", text="GGUF 파일 경로:").run()
            return path
        return None

    models = LLMClient.list_models(engine, api_key)
    if not models:
        if engine == "unsloth":
            message_dialog(
                title="⚠️ 연결 실패",
                text="Unsloth Studio API 연결에 실패했습니다.\n"
                     "Studio가 실행 중이고 API Key가 올바른지 확인하세요.",
            ).run()
        return default_model

    values = [(m, m) for m in models]
    default_sel = default_model if default_model in models else values[0][0] if values else None
    sel = radiolist_dialog(
        title="🔧 모델 선택",
        text=f"{engine} 에서 사용 가능한 모델:",
        values=values,
        default=default_sel,
    ).run()
    return sel or default_model


def _tui_select_inputs(default_paths: tuple[str, ...]) -> dict[str, Any]:
    from prompt_toolkit.shortcuts import checkboxlist_dialog

    result: dict[str, Any] = {}

    # Agent 타입
    agent_choices = [
        "agy", "codex", "opencode",
    ]
    if any("agents" in str(p) for p in default_paths) or not default_paths:
        default_agents = ("agy", "codex", "opencode")
    else:
        default_agents = ()

    sel_agents = checkboxlist_dialog(
        title="🤖 Agent 타입 선택",
        text="컴파일할 Agent 세션 타입을 선택하세요 (모두 해제 시 생략):",
        values=[(a, a) for a in agent_choices],
        default=[a for a in default_agents if a in agent_choices],
    ).run()
    if sel_agents:
        result["agents"] = tuple(sel_agents)
        result["input_paths"] = ("data/agents",)

    # Joplin 노트북
    if JOPLIN_DIR.exists():
        notebooks = sorted(d.name for d in JOPLIN_DIR.iterdir() if d.is_dir())
        if notebooks:
            sel_joplin = checkboxlist_dialog(
                title="📓 Joplin 노트북 선택",
                text="컴파일할 Joplin 노트북을 선택하세요 (모두 해제 시 생략):",
                values=[(n, n) for n in notebooks],
            ).run()
            if sel_joplin:
                result["joplin_notebooks"] = tuple(sel_joplin)
                if "input_paths" not in result:
                    result["input_paths"] = ("data/joplin",)
                else:
                    result["input_paths"] = result["input_paths"] + ("data/joplin",)

    return result


# ===========================================================================
# CLI (Click)
# ===========================================================================
@click.command(context_settings=dict(ignore_unknown_options=False))
@click.option("--engine", default=None, type=click.Choice(["ollama", "llama.cpp", "unsloth"]),
              help="LLM 엔진 (기본값: 환경변수 LLM_ENGINE 또는 ollama)")
@click.option("--model", default=None, help="모델명")
@click.option("--api-key", default=None, help="Unsloth Studio API key")
@click.option("--input", "-i", "input_paths", multiple=True,
              help="입력 경로 (여러번 지정 가능, e.g. data/agents/agy)")
@click.option("--output", "output_path", "-o", default=None, help="출력 raw store 경로")
@click.option("--agent", "agents", multiple=True, type=click.Choice(["agy", "codex", "opencode"]),
              help="Agent 타입 필터")
@click.option("--joplin-notebook", "joplin_notebooks", multiple=True,
              help="Joplin 노트북 필터")
@click.option("--date-from", default=None, help="시작일 (YYYY-MM-DD)")
@click.option("--date-to", default=None, help="종료일 (YYYY-MM-DD)")
@click.option("--sample", type=int, default=None, help="카테고리당 최대 파일 수")
@click.option("--no-cache", is_flag=True, help="캐시 사용 안함")
@click.option("--no-clean", is_flag=True, help="출력 디렉토리 청소 안함")
@click.option("--llama-port", type=int, default=8080, help="llama.cpp 서버 포트 (기본값: 8080)")
@click.option("--tui", is_flag=True, help="대화형 TUI 모드")
def compile(**kwargs):
    """OpenKB Compile Pipeline - 에이전트 기록과 Joplin 노트를 지식베이스로 컴파일합니다."""
    tui_mode = kwargs.pop("tui", False)
    if tui_mode:
        selections = run_tui(**kwargs)
        compile_command(**selections)
    else:
        compile_command(**kwargs)


if __name__ == "__main__":
    compile()
