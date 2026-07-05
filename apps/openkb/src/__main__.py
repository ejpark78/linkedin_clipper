"""
OpenKB — CLI entry point for `python -m src`.
"""
import sys
from pathlib import Path

_src = str(Path(__file__).parent.resolve())
if _src not in sys.path:
    sys.path.insert(0, _src)

from cli import cli

if __name__ == "__main__":
    cli()
