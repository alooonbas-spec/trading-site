import asyncio

import pandas as pd
import streamlit as st

from src.app_common import init_session_state, locale, render_top_bar
from src.collectors import InvalidUrlError
from src.database import get_session
from src.i18n import t
from src.repositories import ObservationRepository
from src.services import catalog_service

st.set_page_config(page_title="Indicators - MQL5 Macro Compare", layout="wide")

init_session_state()
render_top_bar()
loc = locale()

st.header(t("indicators.title", loc))

col_add, col_import = st.columns(2)

with col_add:
    st.subheader(t("indicators.add_url", loc))
    with st.form("add_indicator_form", clear_on_submit=True):
        url = st.text_input(t("indicators.add_url", loc), placeholder=t("indicators.url_placeholder", loc),
                             label_visibility="collapsed")
        submitted = st.form_submit_button(t("indicators.add_button", loc))
        if submitted and url:
            session = get_session()
            try:
                catalog_service.add_indicator_by_url(session, url)
                st.success(t("settings.saved", loc))
            except InvalidUrlError:
                st.error(t("indicators.invalid_url", loc))
            finally:
                session.close()

with col_import:
    st.subheader(t("indicators.import_bulk", loc))
    fmt = st.radio("Format", options=["csv", "json"], horizontal=True, label_visibility="collapsed", key="bulk_import_fmt")
    bulk_text = st.text_area(t("indicators.import_bulk", loc), height=100, label_visibility="collapsed", key="bulk_import_text")
    if st.button(t("indicators.import_button", loc), key="bulk_import_button") and bulk_text.strip():
        session = get_session()
        try:
            summary = catalog_service.bulk_import(session, bulk_text, fmt)
            st.success(f"{t('indicators.add_button', loc)}: {summary['added']} / {summary['total_valid_urls']}")
        finally:
            session.close()

st.divider()

if st.button(f"\U0001F50D {t('sync.start_full_sync', loc)} (discovery)", key="run_discovery_button"):
    session = get_session()
    try:
        summary = asyncio.run(catalog_service.run_discovery(session))
        if summary.get("error"):
            st.error(f"{t('error.network', loc)}: {summary['error']}")
        else:
            st.success(f"{t('indicators.add_button', loc)}: {summary['added']} / {summary['found']}")
    finally:
        session.close()

st.divider()

session = get_session()
try:
    indicators = catalog_service.search_indicators(session)
    obs_repo = ObservationRepository(session)
    rows = []
    for ind in indicators:
        stats = obs_repo.stats_for_indicator(ind.id)
        rows.append(
            {
                t("table.col_indicator", loc): ind.canonical_name,
                t("filter.country", loc): ind.country_code,
                t("filter.currency", loc): ind.currency_code,
                t("filter.category", loc): t(f"category.{ind.category_code}", loc),
                t("filter.importance", loc): t(f"importance.{ind.importance}", loc),
                t("indicators.observations_count", loc): stats["count"],
                t("indicators.first_date", loc): stats["first_date"],
                t("indicators.last_date", loc): stats["last_date"],
                t("indicators.status", loc): t(f"status.{ind.sync_status}", loc) if ind.sync_status in
                    ("pending", "running", "synced", "error") else ind.sync_status,
            }
        )
finally:
    session.close()

st.dataframe(pd.DataFrame(rows), use_container_width=True, hide_index=True)
