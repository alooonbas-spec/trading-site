"""Async sync orchestration: fetch history for one or many indicators.

Fixed collector priority per indicator: history_dom -> history_playwright ->
tinyfish (optional). history_http is tried first only once a confirmed
endpoint exists (see selector_registry.CONFIRMED). Each indicator's failure
is isolated (recorded in sync_errors) and never stops the rest of the job.
Progress is written to the sync_jobs row after every single indicator, so a
kill/restart can resume from where it left off (unsynced/failed indicators
simply get retried).
"""
from __future__ import annotations

import asyncio
import logging
import time

from sqlalchemy.orm import Session

from src.collectors import CollectorError, DataSourceNotConfirmed
from src.collectors.history_dom import fetch_history_dom
from src.collectors.history_http import fetch_history_http
from src.collectors.history_playwright import fetch_history_playwright
from src.collectors.tinyfish_fallback import fetch_history_tinyfish
from src.config import settings
from src.database import get_session
from src.models import utcnow
from src.repositories import IndicatorRepository, SyncErrorRepository, SyncJobRepository
from src.services.observation_service import ingest_history

logger = logging.getLogger(__name__)


async def _fetch_one_indicator(indicator_slug: str, country_slug: str, page_url: str) -> list[dict]:
    """Try collectors in priority order; the first success wins.

    The error surfaced to the caller (and recorded in sync_errors) is the
    last *real* attempt (history_dom or history_playwright) rather than
    TinyFish's "disabled" message when TinyFish isn't configured - that
    message is true but not the actual reason the fetch failed, and would
    otherwise mask the real network/parse error in the log.
    """
    try:
        return await fetch_history_http(indicator_slug, country_slug)
    except DataSourceNotConfirmed:
        pass  # expected until selector_registry.CONFIRMED is True; not an error worth logging per-call

    last_error: CollectorError | None = None

    try:
        return await fetch_history_dom(page_url)
    except CollectorError as exc:
        logger.info("history_dom failed for %s (%s); trying Playwright", page_url, exc)
        last_error = exc

    try:
        return await fetch_history_playwright(page_url)
    except CollectorError as exc:
        logger.info("history_playwright failed for %s (%s); trying TinyFish fallback", page_url, exc)
        last_error = exc

    try:
        return await fetch_history_tinyfish(page_url)
    except CollectorError as tinyfish_exc:
        from src.collectors.tinyfish_fallback import NotConfiguredError

        if isinstance(tinyfish_exc, NotConfiguredError) and last_error is not None:
            raise last_error
        raise


async def run_sync(
    job_id: int,
    indicator_ids: list[int],
    pause_event: asyncio.Event,
    cancel_event: asyncio.Event,
) -> None:
    """Run the sync job. `pause_event` set = running, cleared = paused."""
    session: Session = get_session()
    job_repo = SyncJobRepository(session)

    semaphore = asyncio.Semaphore(settings.max_concurrency)
    processed = 0
    successful = 0
    failed = 0
    lock = asyncio.Lock()

    async def process_one(indicator_id: int) -> None:
        nonlocal processed, successful, failed

        await pause_event.wait()
        if cancel_event.is_set():
            return

        async with semaphore:
            await pause_event.wait()
            if cancel_event.is_set():
                return

            local_session = get_session()
            try:
                local_repo = IndicatorRepository(local_session)
                indicator = local_repo.get_by_id(indicator_id)
                if indicator is None:
                    return

                country_slug = indicator.slug.split("__")[0] if "__" in indicator.slug else indicator.country_code.lower()
                indicator_slug = indicator.slug.split("__")[-1]

                attempt = 1
                try:
                    raw_rows = await _fetch_one_indicator(indicator_slug, country_slug, indicator.source_url)
                    ingest_history(local_session, indicator.id, raw_rows, unit=indicator.unit)
                    local_repo.mark_sync_status(indicator.id, "synced", when=utcnow())
                    local_session.commit()
                    async with lock:
                        successful += 1
                except CollectorError as exc:
                    local_repo.mark_sync_status(indicator.id, "error")
                    local_session.commit()
                    error_repo2 = SyncErrorRepository(local_session)
                    error_repo2.add(
                        indicator_id=indicator.id,
                        job_id=job_id,
                        error_type=type(exc).__name__,
                        error_message=str(exc),
                        attempt=attempt,
                    )
                    local_session.commit()
                    async with lock:
                        failed += 1
                except Exception as exc:  # unexpected - still isolate it
                    logger.exception("Unexpected error syncing indicator %s", indicator_id)
                    error_repo2 = SyncErrorRepository(local_session)
                    error_repo2.add(
                        indicator_id=indicator.id,
                        job_id=job_id,
                        error_type="UnexpectedError",
                        error_message=str(exc),
                        attempt=attempt,
                    )
                    local_session.commit()
                    async with lock:
                        failed += 1
                finally:
                    await asyncio.sleep(settings.min_request_delay_seconds)
            finally:
                local_session.close()

            async with lock:
                processed += 1
                job_repo2 = SyncJobRepository(session)
                job_repo2.update_progress(job_id, processed=processed, successful=successful, failed=failed)
                session.commit()

    try:
        job_repo.update_progress(job_id, status="running")
        session.commit()

        tasks = [asyncio.create_task(process_one(iid)) for iid in indicator_ids]
        await asyncio.gather(*tasks)

        final_status = "cancelled" if cancel_event.is_set() else "completed"
        job_repo.update_progress(job_id, status=final_status)
        session.commit()
    finally:
        session.close()


def indicator_ids_for_job_type(session: Session, job_type: str, explicit_ids: list[int] | None) -> list[int]:
    repo = IndicatorRepository(session)
    if job_type == "selected" and explicit_ids:
        return list(explicit_ids)
    if job_type == "retry_failed":
        error_repo = SyncErrorRepository(session)
        return error_repo.failed_indicator_ids()
    return [ind.id for ind in repo.list_all()]
