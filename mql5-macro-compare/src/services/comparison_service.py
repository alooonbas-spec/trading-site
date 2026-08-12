"""Build the data behind the comparison chart/table: fetch, reshape, apply
the selected comparison mode, and decide left/right axis assignment.

The UI (pages/1_Comparison.py) only calls into this module and charts.py -
it never touches SQLAlchemy or pandas directly.
"""
from __future__ import annotations

import datetime as dt

import pandas as pd
from sqlalchemy.orm import Session

from src.calculations import (
    index_100,
    percent_change_from_previous,
    percent_change_months,
    surprise,
    surprise_z,
    year_over_year,
    z_score,
)
from src.repositories import IndicatorRepository, ObservationRepository

PCT_CHANGE_VARIANTS = ("previous", "3m", "6m", "12m", "yoy")


def get_observations_dataframe(
    session: Session, indicator_ids: list[int], start: dt.date | None = None, end: dt.date | None = None
) -> pd.DataFrame:
    obs_repo = ObservationRepository(session)
    rows = obs_repo.for_indicators(indicator_ids, start=start, end=end)
    if not rows:
        return pd.DataFrame(
            columns=["indicator_id", "release_date", "reference_period", "actual", "forecast", "previous", "unit"]
        )

    data = [
        {
            "indicator_id": r.indicator_id,
            "release_date": pd.Timestamp(r.release_date),
            "reference_period": r.reference_period,
            "actual": r.actual,
            "forecast": r.forecast,
            "previous": r.previous,
            "unit": r.unit,
        }
        for r in rows
    ]
    df = pd.DataFrame(data).sort_values(["indicator_id", "release_date"])
    return df


def get_indicator_meta(session: Session, indicator_ids: list[int]) -> dict[int, dict]:
    repo = IndicatorRepository(session)
    meta = {}
    for iid in indicator_ids:
        ind = repo.get_by_id(iid)
        if ind:
            meta[iid] = {
                "slug": ind.slug,
                "canonical_name": ind.canonical_name,
                "original_name": ind.original_name,
                "unit": ind.unit,
                "country_code": ind.country_code,
                "currency_code": ind.currency_code,
                "importance": ind.importance,
                "translations": {t.locale: t.display_name for t in ind.translations},
            }
    return meta


def apply_mode(
    df: pd.DataFrame, mode: str, pct_change_variant: str = "previous", series: str = "actual"
) -> tuple[pd.DataFrame, dict[int, str]]:
    """Apply a comparison mode to each indicator's series independently.

    Returns (long DataFrame with a 'value' column, {indicator_id: warning_key}).
    `series` selects which raw column (actual/forecast/previous) Raw/Index100/
    Z-score/%change operate on; Surprise always uses actual vs forecast.
    """
    warnings: dict[int, str] = {}
    if df.empty:
        return df.assign(value=pd.Series(dtype=float)), warnings

    out_frames = []
    for indicator_id, group in df.groupby("indicator_id"):
        group = group.sort_values("release_date").reset_index(drop=True)
        indexed = group.set_index("release_date")

        if mode == "raw":
            value = indexed[series]
        elif mode == "index100":
            value, warning = index_100(indexed[series])
            if warning:
                warnings[indicator_id] = warning
        elif mode == "zscore":
            value, warning = z_score(indexed[series])
            if warning:
                warnings[indicator_id] = warning
        elif mode == "pct_change":
            if pct_change_variant == "previous":
                value = percent_change_from_previous(indexed[series])
            elif pct_change_variant == "yoy":
                value = year_over_year(indexed[series])
            elif pct_change_variant in ("3m", "6m", "12m"):
                months = int(pct_change_variant.rstrip("m"))
                value = percent_change_months(indexed[series], months)
            else:
                raise ValueError(f"Unknown pct_change variant: {pct_change_variant}")
        elif mode == "surprise":
            s = surprise(indexed["actual"], indexed["forecast"])
            value = s
        elif mode == "surprise_z":
            s = surprise(indexed["actual"], indexed["forecast"])
            value = surprise_z(s)
        else:
            raise ValueError(f"Unknown comparison mode: {mode}")

        group = group.copy()
        group["value"] = value.values
        out_frames.append(group)

    result = pd.concat(out_frames, ignore_index=True)
    return result, warnings


def assign_axes(indicator_meta: dict[int, dict], mode: str) -> tuple[dict[int, str], bool]:
    """Left/right axis assignment. Only meaningful in Raw mode (every other
    mode is already unit-normalized, so everything safely shares one axis).

    Returns ({indicator_id: 'left'|'right'}, incompatible_scales_warning).
    """
    if mode != "raw":
        return {iid: "left" for iid in indicator_meta}, False

    units_seen: list[str] = []
    for meta in indicator_meta.values():
        unit = meta.get("unit") or "unknown"
        if unit not in units_seen:
            units_seen.append(unit)

    warn = len(units_seen) > 2
    axis_by_unit = {}
    for i, unit in enumerate(units_seen):
        axis_by_unit[unit] = "left" if i == 0 else "right"

    return {iid: axis_by_unit.get(meta.get("unit") or "unknown", "right") for iid, meta in indicator_meta.items()}, warn
