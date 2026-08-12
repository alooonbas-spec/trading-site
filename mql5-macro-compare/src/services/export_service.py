"""CSV / Excel / interactive-HTML export for the current comparison selection."""
from __future__ import annotations

import datetime as dt
import io

import pandas as pd
import plotly.graph_objects as go

from src.i18n import indicator_display_name


def _display_name(meta: dict, locale: str) -> str:
    return indicator_display_name(locale, meta.get("translations", {}), meta.get("canonical_name"), meta.get("original_name", ""))


def build_comparison_table(value_df: pd.DataFrame, indicator_meta: dict[int, dict], locale: str) -> pd.DataFrame:
    if value_df.empty:
        return pd.DataFrame(
            columns=["indicator", "date", "period", "actual", "forecast", "previous", "surprise", "unit", "value"]
        )
    rows = []
    for _, row in value_df.iterrows():
        meta = indicator_meta.get(row["indicator_id"], {})
        rows.append(
            {
                "indicator": _display_name(meta, locale),
                "date": row["release_date"].date().isoformat() if pd.notna(row["release_date"]) else "",
                "period": row["reference_period"],
                "actual": row["actual"],
                "forecast": row["forecast"],
                "previous": row["previous"],
                "surprise": (row["actual"] - row["forecast"]) if pd.notna(row["actual"]) and pd.notna(row["forecast"]) else None,
                "unit": meta.get("unit", ""),
                "value": row["value"],
            }
        )
    return pd.DataFrame(rows)


def export_csv_bytes(table: pd.DataFrame) -> bytes:
    """UTF-8 with BOM so Excel on Windows opens non-Latin text correctly."""
    return table.to_csv(index=False).encode("utf-8-sig")


def export_xlsx_bytes(
    comparison_table: pd.DataFrame,
    observations_table: pd.DataFrame,
    indicators_table: pd.DataFrame,
    data_quality_table: pd.DataFrame,
    source_urls: list[str],
) -> bytes:
    buffer = io.BytesIO()
    with pd.ExcelWriter(buffer, engine="xlsxwriter") as writer:
        comparison_table.to_excel(writer, sheet_name="Comparison", index=False)
        observations_table.to_excel(writer, sheet_name="Observations", index=False)
        indicators_table.to_excel(writer, sheet_name="Indicators", index=False)
        data_quality_table.to_excel(writer, sheet_name="Data Quality", index=False)

        metadata = pd.DataFrame(
            {
                "field": ["Exported at (UTC)", "Source", *[f"Source URL {i + 1}" for i in range(len(source_urls))]],
                "value": [dt.datetime.now(dt.timezone.utc).isoformat(), "MQL5 economic calendar", *source_urls],
            }
        )
        metadata.to_excel(writer, sheet_name="Metadata", index=False)

    return buffer.getvalue()


def export_html_bytes(fig: go.Figure) -> bytes:
    html = fig.to_html(include_plotlyjs="cdn", full_html=True)
    return html.encode("utf-8")
