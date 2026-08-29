from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


@dataclass(frozen=True, slots=True)
class Settings:
    district_package: Path = Path(os.getenv("SETU_DISTRICT_PACKAGE", ROOT / "district_package" / "meppadi-2024-landslide"))
    database_path: Path = Path(os.getenv("SETU_DATABASE", ROOT / "setu.db"))
    allowed_origins: tuple[str, ...] = tuple(
        value.strip() for value in os.getenv(
            "SETU_ALLOWED_ORIGINS",
            "http://localhost:3000,http://localhost:5173,http://127.0.0.1:5173",
        ).split(",") if value.strip()
    )
    checkpoint_interval_minutes: int = 15


settings = Settings()
