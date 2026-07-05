"""Worker entry point: python -m src.worker [subcommand]"""

from __future__ import annotations

import sys
from pathlib import Path

_src = str(Path(__file__).parent.parent.resolve())
if _src not in sys.path:
    sys.path.insert(0, _src)

import click
from worker.dispatcher import run_worker
from worker.plugins.openkb import compile as run_openkb
from worker.preprocess.pipeline import run as run_preprocess


@click.group()
def cli() -> None:
    """Wiki Pipeline Worker — preprocess / openkb / worker"""


@cli.command()
def worker() -> None:
    """Run Redis queue consumer."""
    run_worker()


@cli.command()
@click.option("--input", "-i", "input_paths", multiple=True, help="Input paths")
@click.option("--output", "-o", default=None, help="Output directory")
@click.option("--engine", default="ollama", help="LLM engine")
@click.option("--model", default=None, help="LLM model")
@click.option("--chunk-size", default=2000, type=int, help="Chunk token limit")
def preprocess(**kwargs: dict) -> None:
    """Run preprocess pipeline."""
    run_preprocess(**kwargs)


@cli.command()
@click.option("--input", "-i", "input_paths", multiple=True, help="Input paths")
@click.option("--output", "-o", default=None, help="Output directory")
@click.option("--engine", default="ollama", help="LLM engine")
@click.option("--model", default=None, help="LLM model")
def openkb(**kwargs: dict) -> None:
    """Run openkb compile pipeline."""
    run_openkb(**kwargs)


if __name__ == "__main__":
    cli()
