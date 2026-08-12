import datetime as dt

import pandas as pd
import pytest

from src.collectors import InvalidUrlError
from src.models import Indicator
from src.repositories import (
    AppSettingRepository,
    IndicatorRepository,
    ObservationRepository,
    SyncErrorRepository,
    SyncJobRepository,
)
from src.services import catalog_service, comparison_service, observation_service
from src.services.export_service import build_comparison_table, export_csv_bytes, export_xlsx_bytes


def _make_indicator(session, slug="united-states__nonfarm-payrolls", unit="K"):
    repo = IndicatorRepository(session)
    indicator, created = repo.upsert(
        slug=slug,
        canonical_name="Nonfarm Payrolls",
        original_name="Nonfarm Payrolls",
        country_code="US",
        country_name="United States",
        currency_code="USD",
        category_code="labor_market",
        importance="high",
        unit=unit,
        frequency="monthly",
        source_name="MQL5",
        source_url="https://www.mql5.com/en/economic-calendar/united-states/nonfarm-payrolls",
        sync_status="pending",
        discovery_method="manual",
    )
    session.commit()
    return indicator, created


def test_indicator_upsert_dedup_by_slug(db_session):
    ind1, created1 = _make_indicator(db_session)
    ind2, created2 = _make_indicator(db_session)
    assert created1 is True
    assert created2 is False
    assert ind1.id == ind2.id
    assert db_session.query(Indicator).count() == 1


def test_observation_bulk_upsert_dedup_and_update(db_session):
    indicator, _ = _make_indicator(db_session)
    obs_repo = ObservationRepository(db_session)

    rows = [
        {
            "release_date": dt.date(2026, 7, 3),
            "reference_period": "Jun",
            "actual": 206000.0,
            "forecast": 190000.0,
            "previous": 218000.0,
            "actual_raw": "206K",
            "forecast_raw": "190K",
            "previous_raw": "218K",
            "unit": "K",
            "is_preliminary": False,
            "is_revised": False,
            "source_url": "https://www.mql5.com/en/economic-calendar/united-states/nonfarm-payrolls",
        }
    ]
    inserted, updated = obs_repo.bulk_upsert(indicator.id, rows)
    db_session.commit()
    assert inserted == 1
    assert updated == 0

    # Re-running the exact same row must not create a duplicate.
    inserted2, updated2 = obs_repo.bulk_upsert(indicator.id, rows)
    db_session.commit()
    assert inserted2 == 0
    assert updated2 == 0
    assert len(obs_repo.for_indicators([indicator.id])) == 1

    # Changing the value should update in place, not duplicate.
    rows[0]["actual"] = 210000.0
    rows[0]["actual_raw"] = "210K"
    inserted3, updated3 = obs_repo.bulk_upsert(indicator.id, rows)
    db_session.commit()
    assert inserted3 == 0
    assert updated3 == 1
    assert len(obs_repo.for_indicators([indicator.id])) == 1
    assert obs_repo.for_indicators([indicator.id])[0].actual == 210000.0


def test_catalog_service_add_by_url_rejects_invalid(db_session):
    with pytest.raises(InvalidUrlError):
        catalog_service.add_indicator_by_url(db_session, "https://evil.com/en/economic-calendar/us/cpi")


def test_catalog_service_add_by_url_idempotent(db_session):
    url = "https://www.mql5.com/en/economic-calendar/united-states/cpi"
    ind1, created1 = catalog_service.add_indicator_by_url(db_session, url)
    ind2, created2 = catalog_service.add_indicator_by_url(db_session, url)
    assert created1 is True
    assert created2 is False
    assert ind1.id == ind2.id


def test_catalog_service_bulk_import(db_session):
    text = (
        "https://www.mql5.com/en/economic-calendar/united-states/cpi\n"
        "https://www.mql5.com/en/economic-calendar/united-states/nonfarm-payrolls\n"
        "not-a-valid-url\n"
    )
    summary = catalog_service.bulk_import(db_session, text, "csv")
    assert summary["total_valid_urls"] == 2
    assert summary["added"] == 2
    assert summary["failed"] == 0


def test_observation_service_ingest_history_end_to_end(db_session):
    indicator, _ = _make_indicator(db_session)
    raw_rows = [
        {
            "release_date_raw": "2026-07-03",
            "reference_period_raw": "Jun",
            "actual_raw": "206K",
            "forecast_raw": "190K",
            "previous_raw": "218K",
            "source_url": indicator.source_url,
        },
        {
            "release_date_raw": "2026-06-05",
            "reference_period_raw": "May",
            "actual_raw": "N/A",
            "forecast_raw": "200K",
            "previous_raw": "175K",
            "source_url": indicator.source_url,
        },
    ]
    result = observation_service.ingest_history(db_session, indicator.id, raw_rows, unit="K")
    assert result["inserted"] == 2

    obs_repo = ObservationRepository(db_session)
    stats = obs_repo.stats_for_indicator(indicator.id)
    assert stats["count"] == 2
    assert stats["first_date"] == dt.date(2026, 6, 5)


def test_comparison_service_modes_end_to_end(db_session):
    indicator, _ = _make_indicator(db_session)
    obs_repo = ObservationRepository(db_session)
    base_rows = []
    for i, actual in enumerate([100.0, 110.0, 121.0, 133.1]):
        base_rows.append(
            {
                "release_date": dt.date(2026, 1, 1) + dt.timedelta(days=30 * i),
                "reference_period": f"P{i}",
                "actual": actual,
                "forecast": actual - 2,
                "previous": actual - 5,
                "actual_raw": str(actual),
                "forecast_raw": str(actual - 2),
                "previous_raw": str(actual - 5),
                "unit": "K",
                "is_preliminary": False,
                "is_revised": False,
                "source_url": indicator.source_url,
            }
        )
    obs_repo.bulk_upsert(indicator.id, base_rows)
    db_session.commit()

    df = comparison_service.get_observations_dataframe(db_session, [indicator.id])
    assert len(df) == 4

    raw_result, warnings = comparison_service.apply_mode(df, "raw")
    assert warnings == {}
    assert raw_result["value"].iloc[0] == 100.0

    index_result, _ = comparison_service.apply_mode(df, "index100")
    assert index_result["value"].iloc[0] == pytest.approx(100.0)
    assert index_result["value"].iloc[-1] == pytest.approx(133.1)

    z_result, _ = comparison_service.apply_mode(df, "zscore")
    assert z_result["value"].mean() == pytest.approx(0.0, abs=1e-6)

    surprise_result, _ = comparison_service.apply_mode(df, "surprise")
    assert surprise_result["value"].iloc[0] == pytest.approx(2.0)

    meta = comparison_service.get_indicator_meta(db_session, [indicator.id])
    axis_map, warn = comparison_service.assign_axes(meta, "raw")
    assert axis_map[indicator.id] == "left"
    assert warn is False


def test_export_csv_has_bom(db_session):
    indicator, _ = _make_indicator(db_session)
    obs_repo = ObservationRepository(db_session)
    obs_repo.bulk_upsert(
        indicator.id,
        [
            {
                "release_date": dt.date(2026, 1, 1),
                "reference_period": "P0",
                "actual": 100.0,
                "forecast": 98.0,
                "previous": 95.0,
                "actual_raw": "100",
                "forecast_raw": "98",
                "previous_raw": "95",
                "unit": "K",
                "is_preliminary": False,
                "is_revised": False,
                "source_url": indicator.source_url,
            }
        ],
    )
    db_session.commit()

    df = comparison_service.get_observations_dataframe(db_session, [indicator.id])
    value_df, _ = comparison_service.apply_mode(df, "raw")
    meta = comparison_service.get_indicator_meta(db_session, [indicator.id])
    table = build_comparison_table(value_df, meta, "en")

    csv_bytes = export_csv_bytes(table)
    assert csv_bytes.startswith(b"\xef\xbb\xbf")

    xlsx_bytes = export_xlsx_bytes(table, table, pd.DataFrame(), pd.DataFrame(), [indicator.source_url])
    assert xlsx_bytes[:2] == b"PK"  # xlsx is a zip archive


def test_sync_job_and_error_repositories(db_session):
    job_repo = SyncJobRepository(db_session)
    job = job_repo.create("full", total_items=5)
    db_session.commit()
    assert job.status == "running"

    job_repo.update_progress(job.id, processed=3, successful=2, failed=1)
    db_session.commit()
    refreshed = job_repo.get(job.id)
    assert refreshed.processed_items == 3

    error_repo = SyncErrorRepository(db_session)
    error_repo.add(indicator_id=None, job_id=job.id, error_type="FetchError", error_message="boom", attempt=1)
    db_session.commit()
    assert len(error_repo.recent()) == 1


def test_app_settings_repository(db_session):
    repo = AppSettingRepository(db_session)
    assert repo.get("locale", "en") == "en"
    repo.set("locale", "ru")
    db_session.commit()
    assert repo.get("locale") == "ru"
