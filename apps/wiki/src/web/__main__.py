"""Web UI entry point: python -m src.web"""

import sys
from pathlib import Path

_src = str(Path(__file__).parent.parent.resolve())
if _src not in sys.path:
    sys.path.insert(0, _src)

from web.app import main

if __name__ == "__main__":
    main()
