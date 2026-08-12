"""Entry point: `streamlit run app.py`.

This is the Comparison view (the app's primary screen) - see
pages/1_Comparison.py for the identical page reachable from the sidebar
nav, and pages/2-5 for the catalog/sync/quality/settings screens.
"""
import streamlit as st

from src.app_common import render_comparison_page

st.set_page_config(page_title="MQL5 Macro Compare", page_icon="\U0001F4CA", layout="wide")

render_comparison_page()
