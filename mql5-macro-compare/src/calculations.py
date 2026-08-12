"""Comparison-mode calculations: Raw, Index100, Z-score, % change, Surprise.

All functions take a pandas.Series indexed by release_date (sorted
ascending) and return (result_series, warning | None). The warning is a
translation-key-friendly short code, not user-facing text - callers map it
through i18n.
"""
from __future__ import annotations

import pandas as pd

MIN_OBSERVATIONS_FOR_ZSCORE = 3


def index_100(series: pd.Series) -> tuple[pd.Series, str | None]:
    """Rescale so the first valid observation in the window equals 100."""
    valid = series.dropna()
    if valid.empty:
        return series * float("nan"), "calc.warning.no_data"

    base = valid.iloc[0]
    warning = None
    if base == 0:
        return series * float("nan"), "calc.warning.index100_zero_base"
    if (valid < 0).any() and (valid > 0).any():
        warning = "calc.warning.index100_sign_change"

    return (series / base) * 100.0, warning


def z_score(series: pd.Series) -> tuple[pd.Series, str | None]:
    valid = series.dropna()
    if len(valid) < MIN_OBSERVATIONS_FOR_ZSCORE:
        return series * float("nan"), "calc.warning.zscore_insufficient_data"

    mean = valid.mean()
    std = valid.std(ddof=0)
    if std == 0 or pd.isna(std):
        return series * float("nan"), "calc.warning.zscore_zero_std"

    return (series - mean) / std, None


def percent_change_from_previous(series: pd.Series) -> pd.Series:
    return series.pct_change() * 100.0


def percent_change_months(series_by_date: pd.Series, months: int) -> pd.Series:
    """% change vs. the observation ~N calendar months earlier.

    `series_by_date` must be indexed by pandas.Timestamp (release_date),
    sorted ascending. Uses an as-of (backward) match on shifted dates so it
    tolerates irregular publication calendars.
    """
    if series_by_date.empty:
        return series_by_date * float("nan")

    idx = pd.DatetimeIndex(series_by_date.index)
    target_dates = idx - pd.DateOffset(months=months)

    lookup = pd.Series(series_by_date.values, index=idx).sort_index()
    positions = lookup.index.searchsorted(target_dates, side="right") - 1

    result = []
    for pos, current in zip(positions, series_by_date.values):
        if pos < 0:
            result.append(float("nan"))
            continue
        past_value = lookup.iloc[pos]
        if past_value in (0, None) or pd.isna(past_value) or pd.isna(current):
            result.append(float("nan"))
        else:
            result.append((current - past_value) / abs(past_value) * 100.0)

    return pd.Series(result, index=series_by_date.index)


def year_over_year(series_by_date: pd.Series) -> pd.Series:
    return percent_change_months(series_by_date, 12)


def surprise(actual: pd.Series, forecast: pd.Series) -> pd.Series:
    """actual - forecast, NaN where forecast is missing (never dropped/filled)."""
    return actual - forecast


def surprise_z(surprise_series: pd.Series, window: int = 8) -> pd.Series:
    rolling_std = surprise_series.rolling(window=window, min_periods=MIN_OBSERVATIONS_FOR_ZSCORE).std(ddof=0)
    z = surprise_series / rolling_std
    return z.replace([float("inf"), float("-inf")], float("nan"))
