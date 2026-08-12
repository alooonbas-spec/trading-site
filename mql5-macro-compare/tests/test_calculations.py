import pandas as pd
import pytest

from src.calculations import (
    index_100,
    percent_change_from_previous,
    percent_change_months,
    surprise,
    surprise_z,
    year_over_year,
    z_score,
)


def test_index_100_basic():
    s = pd.Series([50.0, 100.0, 150.0])
    result, warning = index_100(s)
    assert warning is None
    assert result.iloc[0] == pytest.approx(100.0)
    assert result.iloc[1] == pytest.approx(200.0)
    assert result.iloc[2] == pytest.approx(300.0)


def test_index_100_sign_change_warns():
    s = pd.Series([10.0, -5.0, 3.0])
    result, warning = index_100(s)
    assert warning == "calc.warning.index100_sign_change"


def test_index_100_zero_base_warns():
    s = pd.Series([0.0, 5.0, 10.0])
    result, warning = index_100(s)
    assert warning == "calc.warning.index100_zero_base"
    assert result.isna().all()


def test_index_100_all_nan():
    s = pd.Series([float("nan"), float("nan")])
    result, warning = index_100(s)
    assert warning == "calc.warning.no_data"


def test_zscore_basic():
    s = pd.Series([1.0, 2.0, 3.0, 4.0, 5.0])
    result, warning = z_score(s)
    assert warning is None
    assert result.mean() == pytest.approx(0.0, abs=1e-9)


def test_zscore_insufficient_data_warns():
    s = pd.Series([1.0, 2.0])
    result, warning = z_score(s)
    assert warning == "calc.warning.zscore_insufficient_data"


def test_zscore_zero_std_warns():
    s = pd.Series([5.0, 5.0, 5.0, 5.0])
    result, warning = z_score(s)
    assert warning == "calc.warning.zscore_zero_std"


def test_percent_change_from_previous():
    s = pd.Series([100.0, 110.0, 99.0])
    result = percent_change_from_previous(s)
    assert result.iloc[1] == pytest.approx(10.0)
    assert result.iloc[2] == pytest.approx(-10.0)


def test_percent_change_months():
    idx = pd.date_range("2025-01-01", periods=13, freq="MS")
    s = pd.Series(range(100, 113), index=idx, dtype=float)
    result = percent_change_months(s, 12)
    # last value vs. value 12 months earlier
    assert result.iloc[-1] == pytest.approx((112 - 100) / 100 * 100)


def test_year_over_year_matches_12_month():
    idx = pd.date_range("2025-01-01", periods=13, freq="MS")
    s = pd.Series(range(100, 113), index=idx, dtype=float)
    assert year_over_year(s).equals(percent_change_months(s, 12))


def test_surprise_handles_missing_forecast():
    actual = pd.Series([1.0, 2.0, 3.0])
    forecast = pd.Series([1.5, float("nan"), 2.5])
    result = surprise(actual, forecast)
    assert result.iloc[0] == pytest.approx(-0.5)
    assert pd.isna(result.iloc[1])
    assert result.iloc[2] == pytest.approx(0.5)


def test_surprise_z_no_division_by_zero_leaks_inf():
    s = pd.Series([1.0, 1.0, 1.0, 1.0, 1.0])
    z = surprise_z(s, window=3)
    assert not (z.replace([float("inf"), float("-inf")], pd.NA).dropna() == float("inf")).any()
