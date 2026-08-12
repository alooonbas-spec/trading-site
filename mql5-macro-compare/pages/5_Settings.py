import streamlit as st

from src.app_common import init_session_state, locale, render_top_bar, save_settings
from src.i18n import t

st.set_page_config(page_title="Settings - MQL5 Macro Compare", layout="wide")

init_session_state()
render_top_bar()
loc = locale()

st.header(t("settings.title", loc))

with st.form("settings_form"):
    theme = st.selectbox(
        t("settings.theme", loc), options=["light", "dark"],
        index=["light", "dark"].index(st.session_state.get("theme", "light")),
        format_func=lambda v: t(f"settings.theme_{v}", loc),
    )
    concurrency = st.slider(t("settings.concurrency", loc), min_value=1, max_value=5,
                             value=st.session_state["concurrency"])
    timeout = st.number_input(t("settings.timeout", loc), min_value=5.0, max_value=120.0,
                               value=float(st.session_state["request_timeout"]), step=5.0)
    retries = st.number_input(t("settings.retries", loc), min_value=1, max_value=10,
                               value=int(st.session_state["max_retries"]), step=1)
    export_dir = st.text_input(t("settings.export_path", loc), value=st.session_state["export_dir"])
    tinyfish_enabled = st.checkbox(t("settings.tinyfish_enable", loc), value=st.session_state["tinyfish_enabled"])
    st.caption(t("settings.tinyfish_key_hint", loc))

    if st.form_submit_button(t("settings.save", loc)):
        save_settings(
            concurrency=concurrency, timeout=timeout, retries=retries,
            export_dir=export_dir, tinyfish_enabled=tinyfish_enabled, theme=theme,
        )
        st.success(t("settings.saved", loc))
        st.rerun()
