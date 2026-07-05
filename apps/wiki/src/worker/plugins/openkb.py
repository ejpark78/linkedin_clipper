"""OpenKB plugin — runs openkb add to compile wiki pages.

Relies on the `openkb` pip package and existing openkb pipeline code.
"""

from __future__ import annotations

import os
import subprocess
from pathlib import Path


def run_openkb_add(
    raw_store: Path,
    engine: str = "ollama",
    model: str | None = None,
    api_key: str | None = None,
) -> None:
    """Run `openkb add <raw_store>` to compile wiki pages."""
    kb_root = raw_store.parent
    kb_root.mkdir(parents=True, exist_ok=True)
    (kb_root / ".openkb").mkdir(parents=True, exist_ok=True)
    (kb_root / ".config" / "openkb").mkdir(parents=True, exist_ok=True)

    model_ref = model or "default"
    if engine == "llama.cpp":
        config_model = f"openai/{model_ref}"
        config_base = "http://127.0.0.1:8080/v1"
    else:
        config_model = f"{engine}/{model_ref}"
        config_base = "http://127.0.0.1:11434"

    (kb_root / ".openkb" / "config.yaml").write_text(
        f"model: {config_model}\napi_base: {config_base}\napi_key: anything\nlanguage: ko\npageindex_threshold: 20\n"
    )
    (kb_root / ".config" / "openkb" / "global.yaml").write_text(
        f"default_kb: {kb_root}\nknown_kbs:\n- {kb_root}\n"
    )

    env = os.environ.copy()
    env["OPENKB_HOME"] = str(kb_root.resolve())
    env["HOME"] = str(kb_root.resolve())
    env["OPENAI_API_KEY"] = "ollama"

    if model:
        env["LLM_MODEL"] = model

    try:
        subprocess.run(["openkb", "add", str(raw_store)], env=env, check=True, cwd=str(kb_root))
        print("  OpenKB compile complete.")
    except subprocess.CalledProcessError as e:
        print(f"  OpenKB compile failed: {e}")
        raise


def compile(
    input_paths: tuple[str, ...] | None = None,
    output: str | None = None,
    engine: str = "ollama",
    model: str | None = None,
    api_key: str | None = None,
) -> None:
    """Full openkb compile pipeline (collect → metadata → openkb add)."""
    from openkb.pipeline import compile_command
    compile_command(
        input_paths=input_paths,
        output=output,
        engine=engine,
        model=model,
        api_key=api_key,
    )
