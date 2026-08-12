"""Run a full catalog sync from the command line (same job the
Synchronization page's "Start full catalog sync" button triggers).

Usage:
    python scripts/sync_all.py
"""
from __future__ import annotations

import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from src.database import get_session, init_db  # noqa: E402
from src.repositories import SyncJobRepository  # noqa: E402
from src.services.sync_service import indicator_ids_for_job_type, run_sync  # noqa: E402


def main() -> None:
    init_db()
    session = get_session()
    try:
        indicator_ids = indicator_ids_for_job_type(session, "full", None)
        if not indicator_ids:
            print("No indicators in the catalog yet. Run scripts/bootstrap_indicators.py first.")
            return
        job = SyncJobRepository(session).create("full", total_items=len(indicator_ids))
        session.commit()
        job_id = job.id
    finally:
        session.close()

    print(f"Starting full sync job #{job_id} for {len(indicator_ids)} indicator(s)...")

    pause_event = asyncio.Event()
    pause_event.set()
    cancel_event = asyncio.Event()
    asyncio.run(run_sync(job_id, indicator_ids, pause_event, cancel_event))

    session = get_session()
    try:
        job = SyncJobRepository(session).get(job_id)
        print(f"\nJob #{job.id} finished: status={job.status}, "
              f"successful={job.successful_items}, failed={job.failed_items}, "
              f"processed={job.processed_items}/{job.total_items}")
    finally:
        session.close()


if __name__ == "__main__":
    main()
