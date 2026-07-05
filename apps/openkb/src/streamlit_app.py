"""
Streamlit GUI for OpenKB Compiler — Job Queue Mode.
- Enqueues compile jobs to Redis queue
- Worker processes jobs asynchronously
- CLI guide for manual execution
"""
from __future__ import annotations

import json
import time
from pathlib import Path

import streamlit as st

from config import OpenKbConfig
from llm import LLMClient
from jobs import enqueue_job, list_jobs, get_job_progress, get_job_result



def _project_root() -> Path:
    return OpenKbConfig.from_env().project_root


def _init_session_state() -> None:
    if "selected_paths" not in st.session_state:
        st.session_state.selected_paths = set()
    if "engine" not in st.session_state:
        st.session_state.engine = "ollama"
    if "prev_engine" not in st.session_state:
        st.session_state.prev_engine = None
    if "model_options" not in st.session_state:
        st.session_state.model_options = ["-- 선택 --"]
    if "tab" not in st.session_state:
        st.session_state.tab = "설정"
    if "last_job_id" not in st.session_state:
        st.session_state.last_job_id = None
    if "output_auto" not in st.session_state:
        st.session_state.output_auto = "data/obsidian"


def _refresh_models() -> None:
    engine = st.session_state.engine
    try:
        if engine == "llama.cpp":
            gguf = LLMClient.find_gguf_models()
            if gguf:
                st.session_state.model_options = [label for label, _ in gguf]
                return
            fetched = LLMClient.list_models("llama.cpp", None)
            if fetched:
                st.session_state.model_options = fetched
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
                with st.expander(f"\U0001f4c1 {entry.name}", expanded=False):
                    _render_tree(entry, depth + 1, max_depth)
        else:
            checked = st.checkbox(f"\U0001f4c1 {entry.name}", key=f"sel_{key}")
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


def _quote(val: str) -> str:
    return f'"{val}"' if " " in val else val


def _mirror_output(input_path: str, output_prefix: str) -> str:
    """input 절대경로에서 project_root 이하 상대경로를 추출, output_prefix에 이어붙임."""
    try:
        rel = Path(input_path).relative_to(_project_root())
        return str(Path(output_prefix) / rel)
    except ValueError:
        return output_prefix


def _sync_output_on_input() -> None:
    """Input 경로 변경 시 Output 필드를 mirror 경로로 자동 갱신.
    사용자가 Output을 직접 수정한 경우 auto-sync 중단."""
    paths = sorted(st.session_state.selected_paths)
    current = st.session_state.get("output", "").strip()
    auto_ref = st.session_state.get("output_auto", "data/obsidian")

    if paths:
        first = paths[0]
        # base prefix = auto_ref에서 input 상대경로를 제외한 부분
        try:
            rel = Path(first).relative_to(_project_root())
            base_prefix = "data/obsidian"
            mirror = str(Path(base_prefix) / rel)
        except ValueError:
            return

        if current == auto_ref or not current:
            # 사용자가 건드리지 않음 → auto 갱신
            if mirror != current:
                st.session_state.output = mirror
                st.session_state.output_auto = mirror
                st.rerun()
    else:
        if current == auto_ref or not current:
            st.session_state.output = "data/obsidian"
            st.session_state.output_auto = "data/obsidian"


def _build_cli_cmd() -> str:
    parts = ["task openkb:compile --"]
    engine = st.session_state.engine
    model = _get_model_value()
    if model:
        parts.append(f"--engine {engine}")
        parts.append(f"--model {model}")
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
    sample = st.session_state.get("sample_limit", 0)
    if sample and int(sample) > 0:
        parts.append(f"--sample {int(sample)}")
    return " \\\n  ".join(parts)


def _gather_selections() -> dict:
    selections = {}
    selections["engine"] = st.session_state.engine
    selections["model"] = _get_model_value()
    paths = sorted(st.session_state.selected_paths)
    if paths:
        selections["input_paths"] = tuple(paths)
    out = st.session_state.get("output", "").strip() or None
    if out:
        selections["output"] = out
    selections.pop("output_path", None)
    sample = st.session_state.get("sample_limit", 0)
    selections["sample"] = int(sample) if sample and int(sample) > 0 else None
    return selections


def _render_setup_tab() -> None:
    left_col, right_col = st.columns([0.38, 0.62])

    with left_col:
        st.subheader("\U0001f4c1 Sources")
        _render_tree(_project_root())

        st.markdown("---")
        st.text_input(
            "Custom path (relative to data/)",
            placeholder="agents/agy",
            key="custom_path_text",
            label_visibility="collapsed",
        )
        if st.button("\u2795 Add custom path", key="add_path_btn"):
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
        st.subheader("\u2699\ufe0f Settings")
        engines = ["ollama", "llama.cpp"]
        eng_idx = engines.index(st.session_state.engine) if st.session_state.engine in engines else 0
        st.radio("LLM Engine", engines, index=eng_idx, horizontal=True, key="engine")
        st.selectbox("Model", st.session_state.model_options, key="model_select")

        st.text_input("Output Directory", value="data/obsidian", key="output", help="Input 경로 변경 시 자동 mirror. 직접 수정 시 auto-sync 중단.")
        _sync_output_on_input()
        st.number_input("Sample Limit (0 = all)", min_value=0, value=0, key="sample_limit")

        st.markdown("### \U0001f4a1 CLI Guide")
        st.code(_build_cli_cmd(), language="bash")
        st.caption("터미널에서 위 명령어를 실행하거나, 아래 버튼으로 작업을 큐에 등록하세요.")

        if st.button("\u25b6 Enqueue Compile", type="primary", use_container_width=True):
            selections = _gather_selections()
            try:
                job_id = enqueue_job(selections)
                st.session_state.last_job_id = job_id
                st.success(f"Job #{job_id} enqueued!")
                time.sleep(1)
                st.rerun()
            except Exception as e:
                st.error(f"Failed to enqueue job: {e}")
                st.info(
                    "Redis 연결을 확인하세요.\n"
                    "`task redis:up` 으로 Redis를 먼저 실행해야 합니다."
                )


def _render_jobs_tab() -> None:
    st.subheader("\U0001f4cb Job Status")

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
        sel = job.get("selections", {})

        if status == "running":
            label = f"\U0001f504 #{job_id} Running"
        elif status == "queued":
            label = f"\u23f3 #{job_id} Queued"
        elif status == "completed" and exit_code == 0:
            label = f"\u2705 #{job_id} Completed"
        else:
            label = f"\u274c #{job_id} Failed (exit={exit_code})"

        with st.expander(label, expanded=(status == "running" or job_id == st.session_state.get("last_job_id"))):
            if sel:
                paths = sel.get("input_paths", [])
                out = sel.get("output", "")
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
    st.set_page_config(page_title="OpenKB Web", page_icon="\U0001f9e0", layout="wide")
    _init_session_state()

    engine_changed = st.session_state.engine != st.session_state.prev_engine
    if engine_changed:
        _refresh_models()
        st.session_state.prev_engine = st.session_state.engine

    st.title("\U0001f9e0 OpenKB Compile")
    st.markdown("---")

    tab_setup, tab_jobs = st.tabs(["\u2699\ufe0f Settings", "\U0001f4cb Jobs"])

    with tab_setup:
        _render_setup_tab()

    with tab_jobs:
        _render_jobs_tab()

    st.markdown("---")
    st.caption("\U0001f517 https://kb.localhost | `task openkb:worker` \u2014 Worker\uac00 \uc2e4\ud589\uc911\uc774\uc5b4\uc57c \ud569\ub2c8\ub2e4.")


if __name__ == "__main__":
    main()
