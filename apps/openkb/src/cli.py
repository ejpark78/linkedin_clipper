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
@click.option("--output", "-o", default=None, help="\ucd9c\ub825 \ubca0\uc774\uc2a4 \ub514\ub809\ud1a0\ub9ac (\ud558\uc704\uc5d0 raw/, cache.json \uc0dd\uc131)")
@click.option("--output-path", default=None, help="\ucd9c\ub825 raw store \uacbd\ub85c (\uc9c1\uc811 \uc9c0\uc815)")
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
        _map_output(kwargs)
        compile_command(**kwargs)


@cli.command()
def worker() -> None:
    """OpenKB Worker - Redis \ud050\uc5d0\uc11c job\uc744 \uc18c\ube44\ud558\uc5ec \ucef4\ud30c\uc77c \uc2e4\ud589"""
    run_worker()


def _map_output(kwargs: dict) -> None:
    if kwargs.get("output") and not kwargs.get("output_base") and not kwargs.get("output_path"):
        kwargs["output_base"] = kwargs.pop("output")
    elif kwargs.get("output"):
        kwargs.pop("output")


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
