import streamlit as st

from src.app_common import render_comparison_page

st.set_page_config(page_title="Comparison - MQL5 Macro Compare", layout="wide")

render_comparison_page()
