"""Run sync jobs in a background thread so the Streamlit UI never blocks.

Streamlit reruns the whole script on every interaction and has no
persistent async runtime of its own, so each sync job gets its own daemon
thread with a private asyncio event loop. The sync_jobs / sync_errors /
observations tables in SQLite are the durable source of truth the UI reads
from (services/comparison_service.py, pages/*) - this module only holds the
in-memory pause/cancel handles needed to control a *running* job from
another Streamlit session rerun.
"""
from __future__ import annotations

import asyncio
import logging
import threading

from src.database import get_session
from src.repositories import SyncJobRepository
from src.services.sync_service import indicator_ids_for_job_type, run_sync

logger = logging.getLogger(__name__)


class JobControl:
    def __init__(self) -> None:
        self.pause_event = threading.Event()
        self.pause_event.set()  # set = running
        self.cancel_event = threading.Event()
        self.thread: threading.Thread | None = None


_lock = threading.Lock()
_active_jobs: dict[int, JobControl] = {}


def _run_in_thread(job_id: int, indicator_ids: list[int], control: JobControl) -> None:
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)

    # Bridge threading.Event -> asyncio.Event by polling cheaply; simplest
    # correct approach without cross-thread asyncio primitives.
    async_pause = asyncio.Event()
    async_cancel = asyncio.Event()
    if control.pause_event.is_set():
        async_pause.set()

    async def bridge() -> None:
        while not async_cancel.is_set():
            if control.cancel_event.is_set():
                async_cancel.set()
                async_pause.set()  # unblock any waiter so it can observe cancel
                break
            if control.pause_event.is_set():
                async_pause.set()
            else:
                async_pause.clear()
            await asyncio.sleep(0.25)

    async def main() -> None:
        bridge_task = asyncio.create_task(bridge())
        try:
            await run_sync(job_id, indicator_ids, async_pause, async_cancel)
        finally:
            bridge_task.cancel()

    try:
        loop.run_until_complete(main())
    except Exception:
        logger.exception("Background sync job %s crashed", job_id)
    finally:
        loop.close()
        with _lock:
            _active_jobs.pop(job_id, None)


def start_background_sync(job_type: str, indicator_ids: list[int] | None = None) -> int:
    session = get_session()
    try:
        ids = indicator_ids_for_job_type(session, job_type, indicator_ids)
        job_repo = SyncJobRepository(session)
        job = job_repo.create(job_type=job_type, total_items=len(ids))
        session.commit()
        job_id = job.id
    finally:
        session.close()

    control = JobControl()
    thread = threading.Thread(target=_run_in_thread, args=(job_id, ids, control), daemon=True)
    control.thread = thread
    with _lock:
        _active_jobs[job_id] = control
    thread.start()
    return job_id


def pause(job_id: int) -> bool:
    with _lock:
        control = _active_jobs.get(job_id)
    if control:
        control.pause_event.clear()
        return True
    return False


def resume(job_id: int) -> bool:
    with _lock:
        control = _active_jobs.get(job_id)
    if control:
        control.pause_event.set()
        return True
    return False


def cancel(job_id: int) -> bool:
    with _lock:
        control = _active_jobs.get(job_id)
    if control:
        control.cancel_event.set()
        control.pause_event.set()
        return True
    return False


def is_active(job_id: int) -> bool:
    with _lock:
        return job_id in _active_jobs


def is_paused(job_id: int) -> bool:
    with _lock:
        control = _active_jobs.get(job_id)
    return bool(control and not control.pause_event.is_set())
