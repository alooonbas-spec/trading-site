"""Locale-aware number/date/percent formatting via Babel.

Dates are always *stored* as ISO 8601 and numbers as plain floats (see
models.py) - this module only affects how they're *displayed*.
"""
from __future__ import annotations

import datetime as dt

from babel.dates import format_date as _babel_format_date
from babel.numbers import format_decimal, format_percent

from src.i18n import normalize_locale

_BABEL_LOCALE_MAP = {
    "zh-CN": "zh_Hans_CN",
    "ar": "ar",
}


def _babel_locale(locale: str) -> str:
    normalized = normalize_locale(locale)
    return _BABEL_LOCALE_MAP.get(normalized, normalized.replace("-", "_"))


def format_number(value: float | None, locale: str, decimals: int = 2) -> str:
    if value is None:
        return "-"
    try:
        return format_decimal(round(value, decimals), locale=_babel_locale(locale))
    except Exception:
        return f"{value:.{decimals}f}"


def format_pct(value: float | None, locale: str, decimals: int = 2) -> str:
    if value is None:
        return "-"
    try:
        return format_percent(value / 100.0, format=f"#,##0.{'0' * decimals}%", locale=_babel_locale(locale))
    except Exception:
        return f"{value:.{decimals}f}%"


def format_date(value: dt.date | None, locale: str, fmt: str = "medium") -> str:
    if value is None:
        return "-"
    try:
        return _babel_format_date(value, format=fmt, locale=_babel_locale(locale))
    except Exception:
        return value.isoformat()


def to_iso_date(value: dt.date | None) -> str:
    return value.isoformat() if value else ""
