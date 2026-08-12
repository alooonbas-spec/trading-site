"""Parsing/normalization for raw MQL5 economic-calendar values and dates.

Never discards the original string: callers should keep both the raw text
and the value returned here.
"""
from __future__ import annotations

import datetime as dt
import re

_NA_TOKENS = {"", "-", "--", "n/a", "na", "null", "none", "nan"}

_MAGNITUDE_SUFFIXES = {
    "K": 1_000,
    "M": 1_000_000,
    "B": 1_000_000_000,
    "T": 1_000_000_000_000,
}

_NUMBER_RE = re.compile(
    r"^(?P<sign>[+-])?"
    r"(?P<number>[0-9][0-9.,\s ]*)"
    r"(?P<suffix>[KMBTkmbt])?"
    r"(?P<percent>%)?$"
)


class ParseError(ValueError):
    pass


def parse_number(raw: str | None) -> float | None:
    """Parse a raw MQL5 numeric string into a float.

    Handles: thousands separators (comma or space/nbsp), decimal comma or
    point, leading +/-, K/M/B/T magnitude suffixes, trailing %, and
    N/A-like tokens (returned as None).
    """
    if raw is None:
        return None
    text = raw.strip().replace(" ", " ")
    if text.lower() in _NA_TOKENS:
        return None

    match = _NUMBER_RE.match(text)
    if not match:
        raise ParseError(f"Cannot parse numeric value: {raw!r}")

    number_part = match.group("number").strip()
    number_part = number_part.replace(" ", "")

    if "," in number_part and "." in number_part:
        if number_part.rfind(",") > number_part.rfind("."):
            number_part = number_part.replace(".", "").replace(",", ".")
        else:
            number_part = number_part.replace(",", "")
    elif "," in number_part:
        integer_part, _, frac_part = number_part.rpartition(",")
        if len(frac_part) in (1, 2) and integer_part:
            number_part = number_part.replace(",", ".")
        else:
            number_part = number_part.replace(",", "")

    try:
        value = float(number_part)
    except ValueError as exc:
        raise ParseError(f"Cannot parse numeric value: {raw!r}") from exc

    suffix = (match.group("suffix") or "").upper()
    if suffix:
        value *= _MAGNITUDE_SUFFIXES[suffix]

    if match.group("sign") == "-":
        value = -abs(value)

    return value


_DATE_FORMATS = [
    "%Y-%m-%d",
    "%Y/%m/%d",
    "%d.%m.%Y",
    "%d/%m/%Y",
    "%m/%d/%Y",
    "%b %d, %Y",
    "%B %d, %Y",
    "%d %b %Y",
    "%d %B %Y",
    "%Y.%m.%d",
]


def parse_date(raw: str | None) -> dt.date | None:
    if raw is None:
        return None
    text = raw.strip().replace(" ", " ")
    if not text or text.lower() in _NA_TOKENS:
        return None

    iso_candidate = text[:10]
    for fmt in _DATE_FORMATS:
        try:
            return dt.datetime.strptime(text, fmt).date()
        except ValueError:
            continue
    try:
        return dt.date.fromisoformat(iso_candidate)
    except ValueError:
        pass
    raise ParseError(f"Cannot parse date value: {raw!r}")


def is_preliminary(raw_flag_text: str | None) -> bool:
    if not raw_flag_text:
        return False
    return "prelim" in raw_flag_text.strip().lower()


def is_revised(actual_raw: str | None) -> bool:
    if not actual_raw:
        return False
    return "revis" in actual_raw.strip().lower() or "*" in actual_raw
