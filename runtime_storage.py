"""Atomic JSON persistence for bounded caches and request budgets."""
import json
import os
import tempfile
from pathlib import Path


def read_json(path, default=None):
    try:
        with open(path, encoding="utf-8") as stream:
            return json.load(stream)
    except (OSError, ValueError):
        return default


def write_json(path, value):
    parent = Path(path).parent
    parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(dir=parent, prefix=".dashboard-", suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as stream:
            json.dump(value, stream, allow_nan=False)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


class DataUnavailable(Exception):
    def __init__(self, message, status=503):
        super().__init__(message)
        self.status = status
