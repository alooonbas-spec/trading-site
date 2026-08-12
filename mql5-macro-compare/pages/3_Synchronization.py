import datetime as dt

import pandas as pd
import streamlit as st

from src import background_jobs
from src.app_common import init_session_state, locale, render_top_bar
from src.database import get_session
from src.i18n import t
from src.repositories import IndicatorRepository, SyncErrorRepository, SyncJobRepository

st.set_page_config(page_title="Synchronization - MQL5 Macro Compare", layout="wide")

init_session_state()
render_top_bar()
loc = locale()

st.header(t("sync.title", loc))

col_start1, col_start2 = st.columns(2)
with col_start1:
    if st.button(t("sync.start_full_sync", loc), key="start_full_sync_button", use_container_width=True):
        job_id = background_jobs.start_background_sync("full")
        st.session_state["active_sync_job_id"] = job_id
        st.rerun()
with col_start2:
    if st.button(t("sync.retry_failed", loc), key="retry_failed_button", use_container_width=True):
        job_id = background_jobs.start_background_sync("retry_failed")
        st.session_state["active_sync_job_id"] = job_id
        st.rerun()

st.divider()

session = get_session()
try:
    job_repo = SyncJobRepository(session)
    job_id = st.session_state.get("active_sync_job_id")
    job = job_repo.get(job_id) if job_id else job_repo.latest()

    if job is None:
        st.info(t("sync.no_active_job", loc))
    else:
        st.subheader(f"{t('sync.active_job', loc)} #{job.id} ({job.job_type})")

        progress_col, metrics_col = st.columns([2, 3])
        with progress_col:
            pct = (job.processed_items / job.total_items) if job.total_items else 0.0
            st.progress(min(1.0, pct), text=f"{t('sync.progress', loc)}: {job.processed_items}/{job.total_items}")

            elapsed = ((job.finished_at or dt.datetime.now(dt.timezone.utc)) - job.started_at).total_seconds() if job.started_at else 0
            speed = (job.processed_items / elapsed * 60) if elapsed > 0 else 0.0
            st.caption(f"{t('sync.speed', loc)}: {speed:.1f} / min")

        with metrics_col:
            m1, m2, m3 = st.columns(3)
            m1.metric(t("sync.successful", loc), job.successful_items)
            m2.metric(t("sync.failed", loc), job.failed_items)
            m3.metric(t(f"status.{job.status}", loc) if job.status in
                      ("pending", "running", "completed", "failed", "cancelled") else job.status, "")

        is_active = background_jobs.is_active(job.id)
        b1, b2, b3 = st.columns(3)
        with b1:
            if is_active and not background_jobs.is_paused(job.id):
                if st.button(t("sync.pause", loc), key="pause_job_button", use_container_width=True):
                    background_jobs.pause(job.id)
                    st.rerun()
            elif is_active:
                if st.button(t("sync.resume", loc), key="resume_job_button", use_container_width=True):
                    background_jobs.resume(job.id)
                    st.rerun()
        with b2:
            if is_active and st.button(t("sync.cancel", loc), key="cancel_job_button", use_container_width=True):
                background_jobs.cancel(job.id)
                st.rerun()
        with b3:
            if st.button(t("sync.retry_failed", loc), key="retry_failed_button_2", use_container_width=True):
                new_job_id = background_jobs.start_background_sync("retry_failed")
                st.session_state["active_sync_job_id"] = new_job_id
                st.rerun()

    st.subheader(t("sync.log", loc))
    error_repo = SyncErrorRepository(session)
    indicator_repo = IndicatorRepository(session)
    errors = error_repo.recent(limit=100)
    log_rows = []
    for err in errors:
        indicator = indicator_repo.get_by_id(err.indicator_id) if err.indicator_id else None
        log_rows.append(
            {
                "time": err.created_at,
                t("table.col_indicator", loc): indicator.canonical_name if indicator else "-",
                "type": err.error_type,
                "message": err.error_message,
            }
        )
    st.dataframe(pd.DataFrame(log_rows), use_container_width=True, hide_index=True)
finally:
    session.close()
