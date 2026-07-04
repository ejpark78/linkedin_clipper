"""
Streamlit GUI for OpenKB Compiler.
Replaces the old Textual TUI (tui_app.py).
"""
from __future__ import annotations

import io
import sys
import threading
import time
from pathlib import Path
from typing import Any

import streamlit as st

from openkb import PROJECT_ROOT, RAW_STORE, LLMClient


def _init_session_state() -> None:
    if "selected_paths" not in st.session_state:
        st.session_state.selected_paths = set()
    if "engine" not in st.session_state:
        st.session_state.engine = "ollama"
    if "prev_engine" not in st.session_state:
        st.session_state.prev_engine = None
    if "model_options" not in st.session_state:
        st.session_state.model_options = ["-- 선택 --"]
    if "compile_running" not in st.session_state:
        st.session_state.compile_running = False


def _refresh_models() -> None:
    engine = st.session_state.engine
    try:
        if engine == "llama.cpp":
            models = LLMClient.find_gguf_models()
            if models:
                st.session_state.model_options = [label for label, _ in models]
                return
        else:
            fetched = LLMClient.list_models(engine, None)
            if fetched:
                st.session_state.model_options = fetched
                return
    except Exception:
        pass
    st.session_state.model_options = ["(모델 없음)"]


def _render_tree(path: Path, depth: int = 0, max_depth: int = 3) -> None:
    if depth > max_depth or not path.exists():
        return
    try:
        entries = sorted(
            path.iterdir(),
            key=lambda x: (not x.is_dir(), x.name.lower()),
        )
    except PermissionError:
        return
    for entry in entries:
        if entry.name.startswith(".") or not entry.is_dir():
            continue
        key = str(entry)
        has_children = False
        if depth < max_depth - 1:
            try:
                has_children = any(
                    c.is_dir() and not c.name.startswith(".")
                    for c in entry.iterdir()
                )
            except PermissionError:
                pass
        if has_children:
            with st.expander(f"📁 {entry.name}", expanded=False):
                c1, c2 = st.columns([0.05, 0.95])
                with c1:
                    checked = st.checkbox("Select", key=f"sel_{key}", label_visibility="collapsed")
                with c2:
                    st.markdown("**Select this folder**")
                if checked:
                    st.session_state.selected_paths.add(key)
                else:
                    st.session_state.selected_paths.discard(key)
                _render_tree(entry, depth + 1, max_depth)
        else:
            checked = st.checkbox(f"📁 {entry.name}", key=f"sel_{key}")
            if checked:
                st.session_state.selected_paths.add(key)
            else:
                st.session_state.selected_paths.discard(key)


def _get_model_value() -> str | None:
    model = st.session_state.get("model_select", "")
    if not model or model in ("-- 선택 --", "(모델 없음)"):
        return None
    if st.session_state.engine == "llama.cpp":
        for label, path in LLMClient.find_gguf_models():
            if label == model:
                return path
    return model


def _show_engine_help() -> None:
    engine = st.session_state.engine
    model = st.session_state.get("model_select", "")
    if model != "(모델 없음)":
        return
    if engine == "llama.cpp":
        st.info(
            "llama.cpp 서버가 실행되지 않았습니다.\n\n"
            "1. GGUF 모델 다운로드: `huggingface-cli download <model>`\n"
            "2. 서버 실행: `llama-server -m <gguf_path> --host 127.0.0.1 --port 8080`\n\n"
            "또는 CLI에서 자동 실행:\n"
            "`task openkb:compile --engine llama.cpp --model <gguf_path>`"
        )
    elif engine == "unsloth":
        st.info(
            "Unsloth Studio 서버가 실행되지 않았습니다.\n\n"
            "Unsloth Studio를 실행하세요:\n"
            "`unsloth studio --port 8888`\n\n"
            "또는 환경변수 `UNSLOTH_API_KEY` 설정 후 CLI 실행:\n"
            "`task openkb:compile --engine unsloth --model <model>`"
        )
    else:
        st.info("Ollama 서버가 실행되지 않았습니다.\n\n`ollama serve`")


def _build_cli_cmd() -> str:
    parts = ["task openkb:compile"]
    engine = st.session_state.engine
    model = _get_model_value()
    if model:
        parts.append(f"--engine {engine}")
        parts.append(f"--model {model}")
    paths = sorted(st.session_state.selected_paths)
    if paths:
        for p in paths:
            try:
                rel = Path(p).relative_to(PROJECT_ROOT)
                parts.append(f"-i {rel}")
            except ValueError:
                parts.append(f"-i {p}")
    sample = st.session_state.get("sample_limit", 0)
    if sample and int(sample) > 0:
        parts.append(f"--sample {int(sample)}")
    return " \\\n  ".join(parts)


def _gather_selections() -> dict[str, Any]:
    result: dict[str, Any] = {}
    result["engine"] = st.session_state.engine
    result["model"] = _get_model_value()
    paths = sorted(st.session_state.selected_paths)
    if paths:
        result["input_paths"] = tuple(paths)
    result["date_from"] = None
    result["date_to"] = None
    out = st.session_state.get("output_path", "").strip()
    result["output_path"] = out or None
    sample = st.session_state.get("sample_limit", 0)
    result["sample"] = int(sample) if sample and int(sample) > 0 else None
    result["no_clean"] = False
    result["no_cache"] = False
    result["api_key"] = None
    result["llama_port"] = 8080
    return result


def _capture_stdout(compile_fn: Any, selections: dict, buf: io.StringIO) -> None:
    old_stdout = sys.stdout
    sys.stdout = _StdoutRedirector(buf)
    try:
        compile_fn(**selections)
    except SystemExit:
        pass
    except Exception as e:
        print(f"❌ Error: {e}")
    finally:
        sys.stdout = old_stdout


class _StdoutRedirector:
    def __init__(self, buf: io.StringIO) -> None:
        self._buf = buf

    def write(self, text: str) -> None:
        self._buf.write(text)

    def flush(self) -> None:
        pass

    @property
    def encoding(self) -> str:
        return "utf-8"


def main() -> None:
    st.set_page_config(page_title="OpenKB Compiler", page_icon="🧠", layout="wide")
    _init_session_state()

    engine_changed = st.session_state.engine != st.session_state.prev_engine
    if engine_changed:
        _refresh_models()
        st.session_state.prev_engine = st.session_state.engine

    st.title("🧠 OpenKB Compile Pipeline")
    st.markdown("---")

    left_col, right_col = st.columns([0.38, 0.62])

    with left_col:
        st.subheader("📁 Sources")
        _render_tree(PROJECT_ROOT)

        st.markdown("---")
        st.text_input(
            "Custom path (relative to data/)",
            placeholder="agents/agy",
            key="custom_path_text",
            label_visibility="collapsed",
        )
        if st.button("➕ Add custom path", key="add_path_btn"):
            cp = st.session_state.custom_path_text.strip()
            if cp:
                full = PROJECT_ROOT / cp
                st.session_state.selected_paths.add(str(full))
                st.rerun()

        if st.session_state.selected_paths:
            st.markdown("**Selected:**")
            for p in sorted(st.session_state.selected_paths):
                try:
                    rel = Path(p).relative_to(PROJECT_ROOT)
                    st.markdown(f"- `{rel}`")
                except ValueError:
                    st.markdown(f"- `{p}`")

    with right_col:
        st.subheader("⚙️ Settings")
        st.radio(
            "LLM Engine",
            ["ollama", "llama.cpp", "unsloth"],
            index=["ollama", "llama.cpp", "unsloth"].index(st.session_state.engine),
            horizontal=True,
            key="engine",
        )
        st.selectbox(
            "Model",
            st.session_state.model_options,
            key="model_select",
        )

        _show_engine_help()

        st.text_input("Output Path", value=str(RAW_STORE), key="output_path")
        st.number_input("Sample Limit (0 = all)", min_value=0, value=0, key="sample_limit")

        st.code(_build_cli_cmd(), language="bash")

        compile_btn = st.button("▶ Compile", type="primary", use_container_width=True)

        if compile_btn and not st.session_state.compile_running:
            st.session_state.compile_running = True
            st.rerun()

        if st.session_state.compile_running:
            _run_compile()

    st.markdown("---")
    st.caption("🔗 https://kb.localhost | Ctrl+C to stop container")


def _run_compile() -> None:
    from openkb import compile_command

    selections = _gather_selections()
    status = st.status("Compiling...", expanded=True)
    buf = io.StringIO()

    thread = threading.Thread(
        target=_capture_stdout,
        args=(compile_command, selections, buf),
        daemon=True,
    )
    thread.start()

    while thread.is_alive():
        content = buf.getvalue()
        if content:
            status.text(content)
        time.sleep(0.15)

    thread.join()
    final = buf.getvalue()
    if final:
        status.text(final)
    status.update(label="✅ Compile complete", state="complete")
    st.session_state.compile_running = False


if __name__ == "__main__":
    main()
