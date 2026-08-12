"""Plotly figure builders for the comparison chart, mini charts, and export."""
from __future__ import annotations

import pandas as pd
import plotly.graph_objects as go

from src.i18n import indicator_display_name, t

_PALETTE = [
    "#4C78A8", "#F58518", "#54A24B", "#E45756", "#72B7B2",
    "#B279A2", "#FF9DA6", "#9D755D", "#BAB0AC", "#EECA3B",
]


def _display_name(meta: dict, locale: str) -> str:
    return indicator_display_name(locale, meta.get("translations", {}), meta.get("canonical_name"), meta.get("original_name", ""))


def _hover_template(locale: str) -> str:
    return (
        f"<b>%{{customdata[0]}}</b><br>"
        f"{t('chart.hover_date', locale)}: %{{x|%Y-%m-%d}}<br>"
        f"{t('chart.hover_period', locale)}: %{{customdata[1]}}<br>"
        f"{t('chart.hover_actual', locale)}: %{{customdata[2]}}<br>"
        f"{t('chart.hover_forecast', locale)}: %{{customdata[3]}}<br>"
        f"{t('chart.hover_previous', locale)}: %{{customdata[4]}}<br>"
        f"{t('chart.hover_surprise', locale)}: %{{customdata[5]}}"
        "<extra></extra>"
    )


def _customdata(group: pd.DataFrame, display_name: str) -> list[list]:
    def _fmt(v):
        return "-" if pd.isna(v) else round(float(v), 4)

    surprise_vals = group["actual"] - group["forecast"]
    return [
        [display_name, period, _fmt(actual), _fmt(forecast), _fmt(previous), _fmt(sur)]
        for period, actual, forecast, previous, sur in zip(
            group["reference_period"], group["actual"], group["forecast"], group["previous"], surprise_vals
        )
    ]


def build_comparison_figure(
    value_df: pd.DataFrame,
    indicator_meta: dict[int, dict],
    axis_by_indicator: dict[int, str],
    locale: str = "en",
) -> go.Figure:
    fig = go.Figure()

    if value_df.empty:
        fig.update_layout(
            annotations=[{"text": t("chart.no_data", locale), "showarrow": False, "xref": "paper", "yref": "paper", "x": 0.5, "y": 0.5}]
        )
        return fig

    hover_template = _hover_template(locale)

    for i, (indicator_id, group) in enumerate(value_df.groupby("indicator_id")):
        meta = indicator_meta.get(indicator_id, {})
        display_name = _display_name(meta, locale)
        axis = axis_by_indicator.get(indicator_id, "left")

        fig.add_trace(
            go.Scatter(
                x=group["release_date"],
                y=group["value"],
                mode="lines+markers",
                name=display_name,
                line={"color": _PALETTE[i % len(_PALETTE)]},
                yaxis="y2" if axis == "right" else "y",
                customdata=_customdata(group, display_name),
                hovertemplate=hover_template,
            )
        )

    right_axis_used = any(v == "right" for v in axis_by_indicator.values())
    layout = {
        "legend": {"orientation": "h", "yanchor": "bottom", "y": 1.02},
        "hovermode": "closest",
        "margin": {"t": 40, "b": 40, "l": 60, "r": 60 if right_axis_used else 20},
        "yaxis": {"title": t("chart.left_axis", locale) if right_axis_used else ""},
    }
    if right_axis_used:
        layout["yaxis2"] = {"title": t("chart.right_axis", locale), "overlaying": "y", "side": "right"}
    fig.update_layout(**layout)
    return fig


def build_mini_figure(value_df: pd.DataFrame, indicator_id: int, meta: dict, locale: str = "en") -> go.Figure:
    group = value_df[value_df["indicator_id"] == indicator_id]
    display_name = _display_name(meta, locale)

    fig = go.Figure()
    fig.add_trace(
        go.Scatter(
            x=group["release_date"],
            y=group["value"],
            mode="lines+markers",
            name=display_name,
            line={"color": _PALETTE[indicator_id % len(_PALETTE)]},
            hovertemplate=_hover_template(locale),
            customdata=_customdata(group, display_name),
        )
    )
    fig.update_layout(
        title=display_name,
        margin={"t": 40, "b": 30, "l": 40, "r": 20},
        height=260,
        showlegend=False,
    )
    return fig
