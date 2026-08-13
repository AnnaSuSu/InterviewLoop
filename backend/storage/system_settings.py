"""Persistence for global flags controlled by the administrator."""

import json
import os
import tempfile
from pathlib import Path

from backend.config import settings
from backend.models import SystemSettings


def load_system_settings() -> SystemSettings | None:
    """Return the persisted override, or None when .env remains authoritative."""
    path = settings.system_settings_path()
    if not path.exists():
        return None
    return SystemSettings.model_validate_json(path.read_text(encoding="utf-8"))


def save_system_settings(system: SystemSettings) -> None:
    """Atomically persist flags so container restarts do not discard admin changes."""
    path = settings.system_settings_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    temp_path: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="w",
            encoding="utf-8",
            dir=path.parent,
            prefix=f".{path.name}.",
            suffix=".tmp",
            delete=False,
        ) as temp_file:
            temp_path = Path(temp_file.name)
            json.dump(system.model_dump(), temp_file, ensure_ascii=False, indent=2)
            temp_file.write("\n")
            temp_file.flush()
            os.fsync(temp_file.fileno())
        os.replace(temp_path, path)
        temp_path = None
    finally:
        if temp_path is not None:
            temp_path.unlink(missing_ok=True)


def apply_persisted_system_settings() -> bool:
    """Apply a saved override to the live settings object during startup."""
    persisted = load_system_settings()
    if persisted is None:
        return False
    settings.allow_registration = persisted.allow_registration
    return True
