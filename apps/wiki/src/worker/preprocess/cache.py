from __future__ import annotations

import json
from pathlib import Path
from typing import Any


class FileCache:
    def __init__(self, cache_path: Path) -> None:
        self.cache_path = cache_path
        self._data: dict[str, Any] = {}
        self._load()

    def _load(self) -> None:
        if self.cache_path.exists():
            try:
                with open(self.cache_path, encoding="utf-8") as f:
                    self._data = json.load(f)
            except Exception:
                self._data = {}

    def _save(self) -> None:
        try:
            with open(self.cache_path, "w", encoding="utf-8") as f:
                json.dump(self._data, f, indent=2)
        except Exception:
            pass

    def is_up_to_date(self, file_path: str, mtime_ms: float) -> bool:
        entry = self._data.get(file_path)
        if isinstance(entry, dict):
            return entry.get("mtime") == mtime_ms
        return entry == mtime_ms

    def update(self, file_path: str, mtime_ms: float, raw_name: str = "") -> None:
        self._data[file_path] = {"mtime": mtime_ms, "raw_name": raw_name}
        self._save()

    def remove_by_source(self, file_path: str) -> None:
        self._data.pop(file_path, None)
        self._save()
