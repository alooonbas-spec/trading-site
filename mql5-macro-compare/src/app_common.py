"""Shared Streamlit UI plumbing: init, top bar, sidebar filters, CSS/RTL.

Used by app.py and every file under pages/ so state (locale, filters,
selection, comparison mode) survives navigating between pages and switching
languages - nothing here resets st.session_state on a language change.
"""
from __future__ import annotations

import datetime as dt

import streamlit as st

from src import background_jobs
from src.calculations import MIN_OBSERVATIONS_FOR_ZSCORE  # noqa: F401  (re-export for pages that need it)
from src.config import settings
from src.database import get_session, init_db
from src.i18n import available_locales, detect_browser_locale, is_rtl, normalize_locale, set_active_locale, t
from src.repositories import AppSettingRepository, IndicatorRepository
from src.services import catalog_service

FONT_STACK = (
    "'Inter', 'Noto Sans', 'Noto Sans CJK SC', 'Noto Sans Arabic', "
    "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
)


@st.cache_resource
def _ensure_db_initialized() -> bool:
    init_db()
    return True


def _detect_initial_locale() -> str:
    try:
        header = st.context.headers.get("Accept-Language") if hasattr(st, "context") else None
    except Exception:
        header = None
    return detect_browser_locale(header)


def init_session_state() -> None:
    _ensure_db_initialized()

    defaults = {
        "locale": _detect_initial_locale(),
        "filter_search": "",
        "filter_country": None,
        "filter_currency": None,
        "filter_category": None,
        "filter_importance": None,
        "period_start": dt.date.today() - dt.timedelta(days=365 * 3),
        "period_end": dt.date.today(),
        "selected_indicator_ids": [],
        "series_actual": True,
        "series_forecast": False,
        "series_previous": False,
        "comparison_mode": "raw",
        "pct_change_variant": "previous",
        "active_sync_job_id": None,
        "concurrency": settings.max_concurrency,
        "request_timeout": settings.request_timeout_seconds,
        "max_retries": settings.max_retries,
        "export_dir": str(settings.export_dir),
        "tinyfish_enabled": settings.tinyfish_enabled,
        "theme": "light",
    }
    for key, value in defaults.items():
        if key not in st.session_state:
            st.session_state[key] = value

    # Persisted locale (from a previous session, via app_settings) wins over
    # browser detection once a user has explicitly chosen a language.
    session = get_session()
    try:
        saved_locale = AppSettingRepository(session).get("locale")
    finally:
        session.close()
    if saved_locale and "locale_loaded_from_db" not in st.session_state:
        st.session_state["locale"] = normalize_locale(saved_locale)
    st.session_state["locale_loaded_from_db"] = True

    set_active_locale(st.session_state["locale"])
    _load_persisted_settings()


def _load_persisted_settings() -> None:
    """Apply previously saved Settings-page overrides (app_settings table)
    to the live `settings` object once per process, so a value the user
    saved survives across Streamlit reruns and app restarts. Concurrency
    takes effect on the next sync job (semaphore size is read at call
    time); timeout/retries are baked into collector retry decorators at
    import time and only take effect after a process restart - reflected
    honestly, not silently ignored.
    """
    if st.session_state.get("_settings_overrides_loaded"):
        return
    session = get_session()
    try:
        repo = AppSettingRepository(session)
        concurrency = repo.get("max_concurrency")
        if concurrency:
            settings.max_concurrency = min(int(concurrency), 5)
        timeout = repo.get("request_timeout_seconds")
        if timeout:
            settings.request_timeout_seconds = float(timeout)
        retries = repo.get("max_retries")
        if retries:
            settings.max_retries = int(retries)
        tinyfish = repo.get("tinyfish_enabled")
        if tinyfish is not None:
            settings.tinyfish_enabled = tinyfish.lower() == "true"
        export_dir = repo.get("export_dir")
        if export_dir:
            settings.export_dir = type(settings.export_dir)(export_dir)
        theme = repo.get("theme")
        if theme:
            st.session_state["theme"] = theme
    finally:
        session.close()
    st.session_state["concurrency"] = settings.max_concurrency
    st.session_state["request_timeout"] = settings.request_timeout_seconds
    st.session_state["max_retries"] = settings.max_retries
    st.session_state["tinyfish_enabled"] = settings.tinyfish_enabled
    st.session_state["export_dir"] = str(settings.export_dir)
    st.session_state["_settings_overrides_loaded"] = True


def save_settings(*, concurrency: int, timeout: float, retries: int, export_dir: str,
                   tinyfish_enabled: bool, theme: str) -> None:
    settings.max_concurrency = min(max(1, concurrency), 5)
    settings.request_timeout_seconds = timeout
    settings.max_retries = retries
    settings.export_dir = type(settings.export_dir)(export_dir)
    settings.tinyfish_enabled = tinyfish_enabled

    session = get_session()
    try:
        repo = AppSettingRepository(session)
        repo.set("max_concurrency", str(settings.max_concurrency))
        repo.set("request_timeout_seconds", str(settings.request_timeout_seconds))
        repo.set("max_retries", str(settings.max_retries))
        repo.set("export_dir", str(settings.export_dir))
        repo.set("tinyfish_enabled", str(settings.tinyfish_enabled))
        repo.set("theme", theme)
        session.commit()
    finally:
        session.close()

    st.session_state["concurrency"] = settings.max_concurrency
    st.session_state["request_timeout"] = settings.request_timeout_seconds
    st.session_state["max_retries"] = settings.max_retries
    st.session_state["export_dir"] = str(settings.export_dir)
    st.session_state["tinyfish_enabled"] = settings.tinyfish_enabled
    st.session_state["theme"] = theme


def locale() -> str:
    return st.session_state.get("locale", settings.default_locale)


def set_locale(new_locale: str) -> None:
    st.session_state["locale"] = normalize_locale(new_locale)
    set_active_locale(st.session_state["locale"])
    session = get_session()
    try:
        AppSettingRepository(session).set("locale", st.session_state["locale"])
        session.commit()
    finally:
        session.close()


def inject_css() -> None:
    loc = locale()
    rtl = is_rtl(loc)
    direction = "rtl" if rtl else "ltr"
    theme = st.session_state.get("theme", "light")
    dark_css = (
        ".stApp { background-color: #0e1117; color: #fafafa; }"
        if theme == "dark"
        else ""
    )
    rtl_css = (
        """
        .stApp, section[data-testid="stSidebar"] { direction: rtl; text-align: right; }
        section[data-testid="stSidebar"] label, .stMarkdown, .stCaption, h1, h2, h3, p {
            text-align: right;
        }
        [data-testid="stMetricValue"], [data-testid="stMetricLabel"] { text-align: right; }
        """
        if rtl
        else f'.stApp {{ direction: {direction}; }}'
    )
    st.markdown(
        f"""
        <style>
        html, body, [class*="css"] {{ font-family: {FONT_STACK}; }}
        {rtl_css}
        {dark_css}
        </style>
        """,
        unsafe_allow_html=True,
    )


def render_top_bar() -> None:
    inject_css()

    col_title, col_status, col_lang, col_refresh = st.columns([3, 2, 1, 1])

    # The language selectbox is resolved *before* col_title/col_status are
    # rendered (even though it visually sits to the right) so the rest of
    # this run - and every widget rendered after it, including the sidebar's
    # indicator multiselect - uses the final locale for this pass. Calling
    # st.rerun() here instead used to wipe the indicator selection: rerun
    # aborts the script before the sidebar's multiselect gets a chance to
    # register itself for this run, and Streamlit garbage-collects widget
    # state it didn't see registered in the last completed run.
    with col_lang:
        loc = locale()
        codes = [c for c, _ in available_locales()]
        names = {c: n for c, n in available_locales()}
        current = loc if loc in codes else "en"
        chosen = st.selectbox(
            t("app.language_switch", loc),
            options=codes,
            index=codes.index(current),
            format_func=lambda c: names.get(c, c),
            key="language_selector",
        )
        if chosen != loc:
            set_locale(chosen)
        loc = locale()

    with col_title:
        st.title(t("app.title", loc))
        st.caption(t("app.subtitle", loc))

    with col_status:
        session = get_session()
        try:
            repo = IndicatorRepository(session)
            indicators = repo.list_all()
            last_updates = [i.last_updated_at for i in indicators if i.last_updated_at]
            last_update = max(last_updates) if last_updates else None
        finally:
            session.close()

        job_id = st.session_state.get("active_sync_job_id")
        if job_id and background_jobs.is_active(job_id):
            status_label = t("app.sync_status.running", loc)
        else:
            status_label = t("app.sync_status.idle", loc)

        st.metric(t("app.last_updated", loc), last_update.strftime("%Y-%m-%d %H:%M UTC") if last_update else "-")
        st.caption(f"{t('app.sync_status_label', loc)}: {status_label}")

    with col_refresh:
        st.write("")
        st.write("")
        if st.button(t("app.refresh_selected", loc), key="refresh_selected_button", use_container_width=True):
            selected = st.session_state.get("selected_indicator_ids", [])
            if selected:
                job_id = background_jobs.start_background_sync("selected", indicator_ids=selected)
                st.session_state["active_sync_job_id"] = job_id
                st.toast(t("msg.background_sync_running", loc))
            else:
                st.toast(t("msg.no_indicators_selected", loc))


def render_sidebar_filters() -> dict:
    loc = locale()
    with st.sidebar:
        st.header(t("filter.indicators", loc))

        search = st.text_input(t("filter.search", loc), value=st.session_state["filter_search"],
                                placeholder=t("filter.search_placeholder", loc), key="filter_search")

        session = get_session()
        try:
            all_indicators = IndicatorRepository(session).list_all()
        finally:
            session.close()

        countries = sorted({i.country_code for i in all_indicators if i.country_code})
        currencies = sorted({i.currency_code for i in all_indicators if i.currency_code})
        categories = sorted({i.category_code for i in all_indicators if i.category_code})
        importances = ["low", "medium", "high"]

        all_label = t("filter.all", loc)
        country = st.selectbox(t("filter.country", loc), options=[None, *countries],
                                format_func=lambda c: all_label if c is None else c, key="filter_country")
        currency = st.selectbox(t("filter.currency", loc), options=[None, *currencies],
                                 format_func=lambda c: all_label if c is None else c, key="filter_currency")
        category = st.selectbox(t("filter.category", loc), options=[None, *categories],
                                 format_func=lambda c: all_label if c is None else t(f"category.{c}", loc), key="filter_category")
        importance = st.selectbox(t("filter.importance", loc), options=[None, *importances],
                                   format_func=lambda c: all_label if c is None else t(f"importance.{c}", loc), key="filter_importance")

        session = get_session()
        try:
            filtered = catalog_service.search_indicators(
                session, query=search, country=country, currency=currency, category=category, importance=importance
            )
            # Extract plain data while the session is open - ind.translations
            # is a lazy relationship and would raise DetachedInstanceError if
            # touched after the session closes below.
            options = {
                ind.id: {
                    "canonical_name": ind.canonical_name,
                    "original_name": ind.original_name,
                    "translations": {tr.locale: tr.display_name for tr in ind.translations},
                }
                for ind in filtered
            }
        finally:
            session.close()

        def _label(indicator_id: int) -> str:
            from src.i18n import indicator_display_name

            ind = options.get(indicator_id)
            if not ind:
                return str(indicator_id)
            return indicator_display_name(loc, ind["translations"], ind["canonical_name"], ind["original_name"])

        # Prune stale ids (e.g. a filter narrowed the list) directly in
        # session_state *before* the widget reads it, instead of passing a
        # separate `default=`: st.multiselect ignores `default` once `key`
        # already has a session_state entry anyway, and passing both was
        # implicated in a state-loss quirk across rapid reruns (see below).
        st.session_state["selected_indicator_ids"] = [
            i for i in st.session_state["selected_indicator_ids"] if i in options
        ]
        selected_ids = st.multiselect(
            t("filter.indicators", loc), options=list(options.keys()),
            format_func=_label, key="selected_indicator_ids",
        )

        # Defensive: on a rapid double language switch, Streamlit's
        # multiselect can momentarily hand back a stale formatted label
        # instead of the underlying option id (a frontend/backend widget
        # sync quirk tied to format_func changing between two fast reruns).
        # Filter those out and self-heal session_state so a bad value never
        # reaches the DB query layer or lingers for the next run.
        sanitized_ids = [i for i in selected_ids if i in options]
        if sanitized_ids != selected_ids:
            st.session_state["selected_indicator_ids"] = sanitized_ids
        selected_ids = sanitized_ids

        st.subheader(t("filter.period", loc))
        period_col1, period_col2 = st.columns(2)
        with period_col1:
            start = st.date_input(t("filter.period_from", loc), value=st.session_state["period_start"], key="period_start")
        with period_col2:
            end = st.date_input(t("filter.period_to", loc), value=st.session_state["period_end"], key="period_end")

        st.subheader(t("filter.series", loc))
        st.checkbox(t("filter.series_actual", loc), key="series_actual")
        st.checkbox(t("filter.series_forecast", loc), key="series_forecast")
        st.checkbox(t("filter.series_previous", loc), key="series_previous")

        st.subheader(t("filter.mode", loc))
        mode_options = ["raw", "index100", "zscore", "pct_change", "surprise"]
        mode_labels = {m: t(f"mode.{m}", loc) for m in mode_options}
        st.selectbox(t("filter.mode", loc), options=mode_options, format_func=lambda m: mode_labels[m],
                     key="comparison_mode", label_visibility="collapsed")

        if st.session_state["comparison_mode"] == "pct_change":
            variant_options = ["previous", "3m", "6m", "12m", "yoy"]
            variant_labels = {v: t(f"pct_change.{v}", loc) for v in variant_options}
            st.selectbox(t("filter.mode", loc), options=variant_options, format_func=lambda v: variant_labels[v],
                         key="pct_change_variant", label_visibility="collapsed")

        if st.button(t("filter.reset", loc), key="reset_filters_button"):
            for key in ("filter_search", "filter_country", "filter_currency", "filter_category", "filter_importance"):
                st.session_state[key] = "" if key == "filter_search" else None
            st.rerun()

    return {
        "selected_ids": selected_ids,
        "start": start,
        "end": end,
    }


def render_comparison_page() -> None:
    """The Comparison page: chart, mini charts, table, export, quality snippet.

    Shared by app.py (entry point) and pages/1_Comparison.py so both show
    the same content without duplicating logic.
    """
    import pandas as pd

    from src.charts import build_comparison_figure, build_mini_figure
    from src.services import comparison_service, export_service

    init_session_state()
    render_top_bar()
    filters = render_sidebar_filters()
    loc = locale()

    selected_ids = filters["selected_ids"]
    mode = st.session_state["comparison_mode"]
    pct_variant = st.session_state.get("pct_change_variant", "previous")

    series_flags = {
        "actual": st.session_state["series_actual"],
        "forecast": st.session_state["series_forecast"],
        "previous": st.session_state["series_previous"],
    }
    active_series = [s for s, flag in series_flags.items() if flag] or ["actual"]

    if not selected_ids:
        st.info(t("msg.select_indicators_hint", loc))
        return

    session = get_session()
    try:
        df = comparison_service.get_observations_dataframe(session, selected_ids, filters["start"], filters["end"])
        indicator_meta = comparison_service.get_indicator_meta(session, selected_ids)
    finally:
        session.close()

    if df.empty:
        st.warning(t("error.no_data_for_period", loc))
        return

    primary_series = "actual" if series_flags["actual"] or not any(series_flags.values()) else active_series[0]
    value_df, calc_warnings = comparison_service.apply_mode(df, mode, pct_change_variant=pct_variant, series=primary_series)
    axis_map, axis_warning = comparison_service.assign_axes(indicator_meta, mode)

    if axis_warning:
        st.warning(t("chart.axis_warning", loc))
    for indicator_id, warning_key in calc_warnings.items():
        name = indicator_meta.get(indicator_id, {}).get("canonical_name", str(indicator_id))
        st.warning(f"{name}: {t(warning_key, loc)}")

    st.subheader(t("chart.comparison_title", loc))
    st.caption(t("chart.legend_hide_hint", loc))
    fig = build_comparison_figure(value_df, indicator_meta, axis_map, locale=loc)
    st.plotly_chart(fig, use_container_width=True, key="comparison_chart")

    st.subheader(t("chart.mini_title", loc))
    cols = st.columns(min(3, max(1, len(selected_ids))))
    for i, indicator_id in enumerate(selected_ids):
        with cols[i % len(cols)]:
            mini_fig = build_mini_figure(value_df, indicator_id, indicator_meta.get(indicator_id, {}), locale=loc)
            st.plotly_chart(mini_fig, use_container_width=True, key=f"mini_chart_{indicator_id}")

    st.subheader(t("table.title", loc))
    table = export_service.build_comparison_table(value_df, indicator_meta, loc)
    st.dataframe(table, use_container_width=True, hide_index=True)

    st.subheader(t("export.title", loc))
    export_col1, export_col2, export_col3 = st.columns(3)
    with export_col1:
        st.download_button(
            t("export.csv", loc), data=export_service.export_csv_bytes(table),
            file_name="mql5_macro_comparison.csv", mime="text/csv", key="export_csv_button",
            use_container_width=True,
        )
    with export_col2:
        obs_table = table.rename(columns={"value": f"value_{mode}"})
        indicators_table = pd.DataFrame(
            [{"id": iid, **{k: v for k, v in meta.items() if k != "translations"}} for iid, meta in indicator_meta.items()]
        )
        xlsx_bytes = export_service.export_xlsx_bytes(
            table, obs_table, indicators_table, pd.DataFrame({"info": ["see Data Quality page"]}),
            source_urls=list({m.get("original_name", "") for m in indicator_meta.values()}),
        )
        st.download_button(
            t("export.xlsx", loc), data=xlsx_bytes, file_name="mql5_macro_comparison.xlsx",
            mime="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            key="export_xlsx_button", use_container_width=True,
        )
    with export_col3:
        html_bytes = export_service.export_html_bytes(fig)
        st.download_button(
            t("export.html", loc), data=html_bytes, file_name="mql5_macro_comparison.html",
            mime="text/html", key="export_html_button", use_container_width=True,
        )
