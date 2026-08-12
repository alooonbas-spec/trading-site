"""Locale loading and translation lookup.

Framework-agnostic: callers (Streamlit pages) pass the active locale
explicitly or use `set_active_locale`/`t` for a simple module-level
default. Never put user-facing strings directly in Python code - always
go through `t("some.key")`.
"""
from __future__ import annotations

import json
import logging
from functools import lru_cache

from src.config import settings

logger = logging.getLogger(__name__)

FALLBACK_LOCALE = "en"

_active_locale = settings.default_locale


@lru_cache(maxsize=None)
def _load_locale_file(locale: str) -> dict:
    path = settings.locales_dir / f"{locale}.json"
    if not path.exists():
        return {}
    try:
        with path.open(encoding="utf-8") as f:
            return json.load(f)
    except json.JSONDecodeError as exc:
        logger.error("Broken locale file %s: %s", path, exc)
        return {}


def clear_cache() -> None:
    _load_locale_file.cache_clear()


def normalize_locale(locale: str | None) -> str:
    if not locale:
        return FALLBACK_LOCALE
    if locale in settings.supported_locales:
        return locale
    # try matching just the language subtag, e.g. "en-US" -> "en", "zh" -> "zh-CN"
    base = locale.split("-")[0].lower()
    for supported in settings.supported_locales:
        if supported.lower() == base or supported.split("-")[0].lower() == base:
            return supported
    return FALLBACK_LOCALE


def detect_browser_locale(accept_language_header: str | None) -> str:
    """Pick the best supported locale from a browser Accept-Language header."""
    if not accept_language_header:
        return FALLBACK_LOCALE
    candidates = [part.split(";")[0].strip() for part in accept_language_header.split(",")]
    for candidate in candidates:
        normalized = normalize_locale(candidate)
        if normalized != FALLBACK_LOCALE or candidate.lower().startswith("en"):
            return normalized
    return FALLBACK_LOCALE


def set_active_locale(locale: str) -> None:
    global _active_locale
    _active_locale = normalize_locale(locale)


def get_active_locale() -> str:
    return _active_locale


def is_rtl(locale: str | None = None) -> bool:
    return normalize_locale(locale or _active_locale) in settings.rtl_locales


def t(key: str, locale: str | None = None, **kwargs) -> str:
    """Translate `key`. Fallback chain: locale -> English -> key itself."""
    loc = normalize_locale(locale or _active_locale)

    for candidate_locale in ([loc] if loc == FALLBACK_LOCALE else [loc, FALLBACK_LOCALE]):
        data = _load_locale_file(candidate_locale)
        if key in data:
            value = data[key]
            try:
                return value.format(**kwargs) if kwargs else value
            except (KeyError, IndexError):
                return value

    return key


def available_locales() -> list[tuple[str, str]]:
    """Return [(code, native_display_name), ...] for the language switcher."""
    names = {
        "ru": "Русский",
        "en": "English",
        "zh-CN": "简体中文",
        "de": "Deutsch",
        "fr": "Français",
        "es": "Español",
        "ar": "العربية",
        "tr": "Türkçe",
        "ja": "日本語",
        "ko": "한국어",
    }
    return [(code, names.get(code, code)) for code in settings.supported_locales]


def indicator_display_name(locale: str, translations_by_locale: dict[str, str],
                            english_name: str | None, original_name: str) -> str:
    """Never use a translated *label* as an ID; this only picks display text.

    Fallback order: locale translation -> English translation -> original
    MQL5 name. Never returns empty/None so charts/tables never hide data.
    """
    loc = normalize_locale(locale)
    if loc in translations_by_locale and translations_by_locale[loc]:
        return translations_by_locale[loc]
    if english_name:
        return english_name
    if "en" in translations_by_locale and translations_by_locale["en"]:
        return translations_by_locale["en"]
    return original_name
