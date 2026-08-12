"""Sync orchestration tests: one indicator's failure must not stop the others,
and progress must be recorded incrementally (resumable, no dupes on retry).

Uses a temp-file SQLite database (not the in-memory `db_session` fixture) so
that the independent Session objects sync_service opens per-coroutine behave
exactly as they do in production against data/macro.db - i.e. each commit is
immediately visible to every other session reading the same file.
"""
import asyncio

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from src.collectors import FetchError
from src.models import Base
from src.repositories import IndicatorRepository, ObservationRepository, SyncErrorRepository, SyncJobRepository
from src.services import sync_service


@pytest.fixture()
def file_db(tmp_path):
    db_path = tmp_path / "test_sync.db"
    engine = create_engine(f"sqlite:///{db_path}", connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    session_factory = sessionmaker(bind=engine)
    yield session_factory
    engine.dispose()


def _add_indicator(session_factory, slug):
    session = session_factory()
    repo = IndicatorRepository(session)
    ind, _ = repo.upsert(
        slug=slug,
        canonical_name=slug,
        original_name=slug,
        country_code="US",
        source_url=f"https://www.mql5.com/en/economic-calendar/united-states/{slug}",
        sync_status="pending",
    )
    session.commit()
    indicator_id = ind.id
    session.close()
    return indicator_id


@pytest.mark.asyncio
async def test_one_indicator_failure_does_not_stop_others(file_db, monkeypatch):
    good_id = _add_indicator(file_db, "good-ind")
    bad_id = _add_indicator(file_db, "bad-ind")

    monkeypatch.setattr(sync_service, "get_session", file_db)

    async def fake_fetch(indicator_slug, country_slug, page_url):
        if "bad" in page_url:
            raise FetchError("simulated network failure")
        return [
            {
                "release_date_raw": "2026-07-01",
                "reference_period_raw": "Jun",
                "actual_raw": "100",
                "forecast_raw": "95",
                "previous_raw": "90",
                "source_url": page_url,
            }
        ]

    monkeypatch.setattr(sync_service, "_fetch_one_indicator", fake_fetch)

    session = file_db()
    job = SyncJobRepository(session).create("selected", total_items=2)
    session.commit()
    job_id = job.id
    session.close()

    pause_event = asyncio.Event()
    pause_event.set()
    cancel_event = asyncio.Event()

    await sync_service.run_sync(job_id, [good_id, bad_id], pause_event, cancel_event)

    check = file_db()
    refreshed_job = SyncJobRepository(check).get(job_id)
    assert refreshed_job.status == "completed"
    assert refreshed_job.processed_items == 2
    assert refreshed_job.successful_items == 1
    assert refreshed_job.failed_items == 1

    indicator_repo = IndicatorRepository(check)
    assert indicator_repo.get_by_id(good_id).sync_status == "synced"
    assert indicator_repo.get_by_id(bad_id).sync_status == "error"

    obs_repo = ObservationRepository(check)
    assert obs_repo.stats_for_indicator(good_id)["count"] == 1
    assert obs_repo.stats_for_indicator(bad_id)["count"] == 0

    error_repo = SyncErrorRepository(check)
    errors = error_repo.recent()
    assert len(errors) == 1
    assert errors[0].indicator_id == bad_id
    check.close()


@pytest.mark.asyncio
async def test_cancel_stops_processing(file_db, monkeypatch):
    indicator_ids = [_add_indicator(file_db, f"ind-{i}") for i in range(5)]
    monkeypatch.setattr(sync_service, "get_session", file_db)

    call_count = 0

    async def slow_fetch(indicator_slug, country_slug, page_url):
        nonlocal call_count
        call_count += 1
        await asyncio.sleep(0.05)
        return [
            {
                "release_date_raw": "2026-07-01",
                "reference_period_raw": "Jun",
                "actual_raw": "1",
                "forecast_raw": "1",
                "previous_raw": "1",
                "source_url": page_url,
            }
        ]

    monkeypatch.setattr(sync_service, "_fetch_one_indicator", slow_fetch)

    session = file_db()
    job = SyncJobRepository(session).create("full", total_items=len(indicator_ids))
    session.commit()
    job_id = job.id
    session.close()

    pause_event = asyncio.Event()
    pause_event.set()
    cancel_event = asyncio.Event()
    cancel_event.set()  # cancel before starting - nothing should be processed

    await sync_service.run_sync(job_id, indicator_ids, pause_event, cancel_event)

    check = file_db()
    refreshed_job = SyncJobRepository(check).get(job_id)
    assert refreshed_job.status == "cancelled"
    assert call_count == 0
    check.close()
