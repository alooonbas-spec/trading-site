"""Normalize raw collector rows into Observation records and persist them.

Keeps the raw string alongside every normalized number/date (never
discarded), and is idempotent: re-running on the same raw rows updates
existing observations in place instead of duplicating them (the DB unique
constraint on indicator_id+release_date+reference_period backs this up).
"""
from __future__ import annotations

import logging

from sqlalchemy.orm import Session

from src.normalizer import ParseError, is_preliminary, is_revised, parse_date, parse_number
from src.repositories import ObservationRepository

logger = logging.getLogger(__name__)


def normalize_raw_rows(raw_rows: list[dict], unit: str = "") -> list[dict]:
    """Convert collector raw-row dicts into Observation-ready field dicts.

    Rows whose date can't be parsed are skipped (logged), since a
    observation without a release_date can't be deduplicated or displayed -
    everything else is preserved even when actual/forecast/previous fail to
    parse (stored as None, with the raw text kept).
    """
    normalized: list[dict] = []
    for row in raw_rows:
        try:
            release_date = parse_date(row.get("release_date_raw"))
        except ParseError as exc:
            logger.warning("Skipping row with unparseable date %r: %s", row.get("release_date_raw"), exc)
            continue
        if release_date is None:
            continue

        def _safe_number(key: str) -> float | None:
            try:
                return parse_number(row.get(key))
            except ParseError:
                logger.debug("Could not parse numeric field %s=%r", key, row.get(key))
                return None

        normalized.append(
            {
                "release_date": release_date,
                "reference_period": (row.get("reference_period_raw") or "").strip(),
                "actual": _safe_number("actual_raw"),
                "forecast": _safe_number("forecast_raw"),
                "previous": _safe_number("previous_raw"),
                "actual_raw": (row.get("actual_raw") or "")[:64],
                "forecast_raw": (row.get("forecast_raw") or "")[:64],
                "previous_raw": (row.get("previous_raw") or "")[:64],
                "unit": unit,
                "is_preliminary": is_preliminary(row.get("actual_raw")),
                "is_revised": is_revised(row.get("actual_raw")),
                "source_url": row.get("source_url", ""),
            }
        )
    return normalized


def ingest_history(session: Session, indicator_id: int, raw_rows: list[dict], unit: str = "") -> dict:
    normalized_rows = normalize_raw_rows(raw_rows, unit=unit)
    repo = ObservationRepository(session)
    inserted, updated = repo.bulk_upsert(indicator_id, normalized_rows)
    session.commit()
    return {"parsed": len(normalized_rows), "raw": len(raw_rows), "inserted": inserted, "updated": updated}
