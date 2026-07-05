"""
Pipeline Web UI — Orchestrates preprocess → openkb → ...
Streamlit app, accessible at https://wiki.localhost
"""

from __future__ import annotations

import os
import sys
import time
from pathlib import Path

_src = str(Path(__file__).parent.parent.resolve())
if _src not in sys.path:
    sys.path.insert(0, _src)

import streamlit as st
from worker.preprocess import llm_client as llm_extract
from worker.preprocess.config import PreprocessConfig

from web.jobs import enqueue_job, get_job_progress, get_job_result, list_jobs


def _project_root() -> Path:
    return PreprocessConfig.from_env().project_root


def _init_session_state() -> None:
    if "selected_paths" not in st.session_state:
        st.session_state.selected_paths = set()
    if "engine" not in st.session_state:
        st.session_state.engine = "ollama"
    if "pipeline_step" not in st.session_state:
        st.session_state.pipeline_step = "preprocess"
    if "model_options" not in st.session_state:
        st.session_state.model_options = ["-- 선택 --"]
    if "prev_engine" not in st.session_state:
        st.session_state.prev_engine = None
    if "last_job_id" not in st.session_state:
        st.session_state.last_job_id = None
    if "output" not in st.session_state:
        st.session_state.output = "preprocessed"
    if "output_auto" not in st.session_state:
        st.session_state.output_auto = "preprocessed"


def _refresh_models() -> None:
    engine = st.session_state.engine
    try:
        if engine == "llama.cpp":
            gguf = llm_extract.find_gguf_models()
            if gguf:
                st.session_state.model_options = [label for label, _ in gguf]
                return
        models = llm_extract.list_models(engine)
        if models:
            st.session_state.model_options = models
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
        has_children = depth < max_depth - 1 and any(
            c.is_dir() and not c.name.startswith(".") for c in entry.iterdir()
        ) or False
        if has_children:
            c1, c2 = st.columns([0.04, 0.96])
            with c1:
                checked = st.checkbox(" ", key=f"sel_{key}", label_visibility="collapsed")
            if checked:
                st.session_state.selected_paths.add(key)
            else:
                st.session_state.selected_paths.discard(key)
            with c2:
                with st.expander(f"📁 {entry.name}", expanded=False):
                    _render_tree(entry, depth + 1, max_depth)
        else:
            checked = st.checkbox(f"📁 {entry.name}", key=f"sel_{key}")
            if checked:
                st.session_state.selected_paths.add(key)
            else:
                st.session_state.selected_paths.discard(key)


def _quote(val: str) -> str:
    return f'"{val}"' if " " in val else val


def _build_cli_cmd() -> str:
    step = st.session_state.pipeline_step
    engine = st.session_state.engine
    model = st.session_state.get("model_select", "")

    if step == "openkb":
        parts = ["task wiki:pipeline:openkb --"]
    else:
        parts = ["task wiki:pipeline:preprocess --"]

    if model and model not in ("-- 선택 --", "(모델 없음)"):
        parts.append(f"--engine {engine}")
        parts.append(f"--model {_quote(model)}")

    paths = sorted(st.session_state.selected_paths)
    if paths:
        for p in paths:
            try:
                rel = Path(p).relative_to(_project_root())
                parts.append(f"--input {_quote(str(rel))}")
            except ValueError:
                parts.append(f"--input {_quote(p)}")

    out = st.session_state.get("output", "").strip()
    if out:
        parts.append(f"--output {_quote(out)}")

    if step == "preprocess":
        cs = st.session_state.get("chunk_size", 2000)
        if cs:
            parts.append(f"--chunk-size {cs}")

    return " \\\n  ".join(parts)


def _gather_selections() -> dict:
    step = st.session_state.pipeline_step
    sel = {"engine": st.session_state.engine}
    model = st.session_state.get("model_select", "")
    if model and model not in ("-- 선택 --", "(모델 없음)"):
        sel["model"] = model

    paths = sorted(st.session_state.selected_paths)
    if paths:
        sel["input_paths"] = tuple(paths)
    out = st.session_state.get("output", "").strip() or None
    if out:
        sel["output"] = out

    if step == "preprocess":
        sel["chunk_size"] = st.session_state.get("chunk_size", 2000)

    return sel


def _mirror_output(input_path: str, output_prefix: str) -> str:
    try:
        rel = Path(input_path).relative_to(_project_root())
        return str(Path(output_prefix) / rel)
    except ValueError:
        return output_prefix


def _mirror_common(paths: list[str], output_prefix: str) -> str:
    try:
        if len(paths) == 1:
            return _mirror_output(paths[0], output_prefix)
        common = Path(os.path.commonpath(paths))
        return _mirror_output(str(common), output_prefix)
    except Exception:
        return _mirror_output(paths[0], output_prefix) if paths else output_prefix


def _sync_output_on_input() -> None:
    paths = sorted(st.session_state.selected_paths)
    current = st.session_state.get("output", "").strip()
    auto_ref = st.session_state.get("output_auto", "preprocessed")

    if paths:
        try:
            mirror = _mirror_common(paths, "preprocessed")
        except Exception:
            return

        if current == auto_ref or not current:
            if mirror != current:
                st.session_state.output = mirror
                st.session_state.output_auto = mirror
                st.rerun()
    else:
        if current == auto_ref or not current:
            st.session_state.output = "preprocessed"
            st.session_state.output_auto = "preprocessed"


def _render_setup_tab() -> None:
    left_col, right_col = st.columns([0.38, 0.62])

    with left_col:
        st.subheader("📁 Sources")
        _render_tree(_project_root())

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
                full = _project_root() / cp
                st.session_state.selected_paths.add(str(full))
                st.rerun()

        if st.session_state.selected_paths:
            st.markdown("**Selected:**")
            for p in sorted(st.session_state.selected_paths):
                try:
                    rel = Path(p).relative_to(_project_root())
                    st.markdown(f"- `{rel}`")
                except ValueError:
                    st.markdown(f"- `{p}`")

    with right_col:
        st.subheader("⚙️ Settings")

        st.radio(
            "Pipeline Step",
            ["preprocess", "openkb"],
            index=0,
            horizontal=True,
            key="pipeline_step",
            help="preprocess: chunk + LLM extraction | openkb: wiki compile | full: both",
        )

        engines = ["ollama", "llama.cpp"]
        eng_idx = engines.index(st.session_state.engine) if st.session_state.engine in engines else 0
        st.radio("LLM Engine", engines, index=eng_idx, horizontal=True, key="engine")
        st.selectbox("Model", st.session_state.model_options, key="model_select")

        _sync_output_on_input()
        st.text_input("Output Directory", key="output", help="Input 경로 변경 시 자동 mirror. 직접 수정 시 auto-sync 중단.")

        if st.session_state.pipeline_step == "preprocess":
            st.number_input("Chunk Size (tokens)", min_value=500, value=2000, step=500, key="chunk_size")

        st.markdown("### 💡 CLI Guide")
        st.code(_build_cli_cmd(), language="bash")
        st.caption("터미널에서 위 명령어를 실행하거나, 아래 버튼으로 작업을 큐에 등록하세요.")

        if st.button("▶️ Enqueue Job", type="primary", use_container_width=True):
            job_type = st.session_state.pipeline_step
            params = _gather_selections()
            try:
                job_id = enqueue_job(job_type, params)
                st.session_state.last_job_id = job_id
                st.success(f"Job #{job_id} enqueued ({job_type})!")
                time.sleep(1)
                st.rerun()
            except Exception as e:
                st.error(f"Failed to enqueue job: {e}")
                st.info("Redis 연결을 확인하세요.\n`task redis:up` 으로 Redis를 먼저 실행해야 합니다.")


def _render_jobs_tab() -> None:
    st.subheader("📋 Job Status")

    try:
        jobs = list_jobs(20)
    except Exception as e:
        st.warning(f"Redis 연결 실패: {e}")
        st.info("`task redis:up` 으로 Redis를 먼저 실행하세요.")
        return

    if not jobs:
        st.info("No jobs found.")
        return

    for job in jobs:
        job_id = job.get("job_id", "?")
        status = job.get("status", "unknown")
        exit_code = job.get("exit_code")
        job_type = job.get("type", "?")
        params = job.get("params", {})

        if status == "running":
            label = f"🔄 #{job_id} [{job_type}] Running"
        elif status == "queued":
            label = f"⏳ #{job_id} [{job_type}] Queued"
        elif status == "completed" and exit_code == 0:
            label = f"✅ #{job_id} [{job_type}] Completed"
        else:
            label = f"❌ #{job_id} [{job_type}] Failed (exit={exit_code})"

        with st.expander(label, expanded=(status == "running" or job_id == st.session_state.get("last_job_id"))):
            if params:
                paths = params.get("input_paths", [])
                out = params.get("output", "")
                st.text(f"Inputs: {', '.join(paths) if paths else '(default)'}")
                if out:
                    st.text(f"Output: {out}")

            if status == "running":
                progress = get_job_progress(job_id)
                if progress:
                    st.code(progress, language="")
                st.caption("Auto-refreshing...")

            result = get_job_result(job_id)
            if result:
                output = result.get("output", "")
                if output:
                    with st.expander("Full Output"):
                        st.code(output, language="")


def main() -> None:
    st.set_page_config(page_title="Wiki Pipeline", page_icon="🧠", layout="wide")
    _init_session_state()

    engine_changed = st.session_state.engine != st.session_state.prev_engine
    if engine_changed:
        _refresh_models()
        st.session_state.prev_engine = st.session_state.engine

    st.title("🧠 Wiki Pipeline")
    st.markdown("---")

    tab_setup, tab_jobs = st.tabs(["⚙️ Settings", "📋 Jobs"])

    with tab_setup:
        _render_setup_tab()

    with tab_jobs:
        _render_jobs_tab()

    st.markdown("---")
    st.caption("🔗 https://wiki.localhost | `task wiki:up` 으로 컨테이너를 실행하세요.")


if __name__ == "__main__":
    main()
