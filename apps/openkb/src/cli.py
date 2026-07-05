"""
OpenKB CLI — Click command-line interface.

의존성: pipeline, queue
"""
from __future__ import annotations

import os
import sys
from pathlib import Path
from typing import Any

import click

from pipeline import compile_command
from jobs import run_worker


@click.group()
def cli() -> None:
    """OpenKB - \uc9c0\uc2dd\ubca0\uc774\uc2a4 \ucef4\ud30c\uc77c \ubc0f \uc791\uc5c5 \ud050 \uad00\ub9ac"""


@cli.command()
@click.option("--engine", default=None, type=click.Choice(["ollama", "llama.cpp", "unsloth"]),
              help="LLM \uc5d4\uc9c4 (\uae30\ubcf8\uac12: \ud658\uacbd\ubcc0\uc218 LLM_ENGINE \ub610\ub294 ollama)")
@click.option("--model", default=None, help="\ubaa8\ub378\uba85")
@click.option("--api-key", default=None, help="Unsloth Studio API key")
@click.option("--input", "-i", "input_paths", multiple=True,
              help="\uc785\ub825 \uacbd\ub85c (\uc5ec\ub7ec\ubc88 \uc9c0\uc815 \uac00\ub2a5, e.g. --input data/agents/agy)")
@click.option("--output", "-o", default=None, help="\ucd9c\ub825 KB \ubca0\uc774\uc2a4 \ub514\ub809\ud1a0\ub9ac (\ud558\uc704\uc5d0 raw/, wiki/, .openkb/\uc0dd\uc131). \ubbf8\uc9c0\uc815 \uc2dc OPENKB_OUTPUT_PREFIX env \uae30\ubc18 input mirror")
@click.option("--agent", "agents", multiple=True, type=click.Choice(["agy", "codex", "opencode"]),
              help="Agent \ud0c0\uc785 \ud544\ud130")
@click.option("--joplin-notebook", "joplin_notebooks", multiple=True,
              help="Joplin \ub178\ud2b8\ubd81 \ud544\ud130")
@click.option("--date-from", default=None, help="\uc2dc\uc791\uc77c (YYYY-MM-DD)")
@click.option("--date-to", default=None, help="\uc885\ub8cc\uc77c (YYYY-MM-DD)")
@click.option("--sample", type=int, default=None, help="\uce74\ud14c\uace0\ub9ac\ub2f9 \ucd5c\ub300 \ud30c\uc77c \uc218")
@click.option("--no-cache", is_flag=True, help="\uce90\uc2dc \uc0ac\uc6a9 \uc548\ud568")
@click.option("--full-rebuild", is_flag=True, help="raw/ \ucd08\uae30\ud654 \ud6c4 \uc804\uccb4 \uc7ac\ucc98\ub9ac (\uc99d\ubd84 \ucc98\ub9ac \ube44\ud65c\uc131\ud654)")
@click.option("--llama-port", type=int, default=8080, help="llama.cpp \uc11c\ubc84 \ud3ec\ud2b8 (\uae30\ubcf8\uac12: 8080)")
@click.option("--streamlit", is_flag=True, help="Streamlit GUI \ubaa8\ub4dc")
def compile(**kwargs: Any) -> None:
    """OpenKB Compile Pipeline - \uc5d0\uc774\uc804\ud2b8 \uae30\ub85d\uacfc Joplin \ub178\ud2b8\ub97c \uc9c0\uc2dd\ubca0\uc774\uc2a4\ub85c \ucef4\ud30c\uc77c\ud569\ub2c8\ub2e4."""
    streamlit_mode = kwargs.pop("streamlit", False)
    if streamlit_mode:
        _run_streamlit(**kwargs)
    else:
        kwargs.pop("output_path", None)
        compile_command(**kwargs)


def _run_streamlit(**defaults: Any) -> None:
    try:
        _src = str(Path(__file__).parent.resolve())
        if _src not in sys.path:
            sys.path.insert(0, _src)
        from streamlit_app import main  # type: ignore
    except ImportError as e:
        print(f"\u26a0\ufe0f Streamlit GUI not available: {e}")
        return
    main()


if __name__ == "__main__":
    cli()
