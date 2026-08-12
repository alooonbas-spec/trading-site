"""Centralized configuration, loaded from environment variables / .env."""
from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv

PROJECT_ROOT = Path(__file__).resolve().parent.parent
load_dotenv(PROJECT_ROOT / ".env")


def _bool(name: str, default: bool) -> bool:
    val = os.environ.get(name)
    if val is None:
        return default
    return val.strip().lower() in {"1", "true", "yes", "on"}


def _int(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, default))
    except (TypeError, ValueError):
        return default


def _float(name: str, default: float) -> float:
    try:
        return float(os.environ.get(name, default))
    except (TypeError, ValueError):
        return default


@dataclass
class Settings:
    mql5_base_url: str = os.environ.get("MQL5_BASE_URL", "https://www.mql5.com")
    max_concurrency: int = min(_int("MQL5_MAX_CONCURRENCY", 3), 5)
    request_timeout_seconds: float = _float("MQL5_REQUEST_TIMEOUT_SECONDS", 30.0)
    max_retries: int = _int("MQL5_MAX_RETRIES", 4)
    min_request_delay_seconds: float = _float("MQL5_MIN_REQUEST_DELAY_SECONDS", 1.0)

    tinyfish_enabled: bool = _bool("TINYFISH_ENABLED", False)
    tinyfish_api_key: str = os.environ.get("TINYFISH_API_KEY", "")

    database_path: Path = PROJECT_ROOT / os.environ.get("DATABASE_PATH", "data/macro.db")
    export_dir: Path = PROJECT_ROOT / os.environ.get("EXPORT_DIR", "data/exports")
    raw_dir: Path = PROJECT_ROOT / "data" / "raw"
    locales_dir: Path = PROJECT_ROOT / "locales"

    default_locale: str = os.environ.get("DEFAULT_LOCALE", "en")
    supported_locales: tuple = (
        "ru", "en", "zh-CN", "de", "fr", "es", "ar", "tr", "ja", "ko",
    )
    rtl_locales: tuple = ("ar",)


settings = Settings()
settings.database_path.parent.mkdir(parents=True, exist_ok=True)
settings.export_dir.mkdir(parents=True, exist_ok=True)
settings.raw_dir.mkdir(parents=True, exist_ok=True)
