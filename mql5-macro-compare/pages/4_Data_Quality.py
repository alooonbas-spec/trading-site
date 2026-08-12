import pandas as pd
import streamlit as st

from src.app_common import init_session_state, locale, render_top_bar
from src.config import settings
from src.database import get_session
from src.i18n import t
from src.models import Observation
from src.repositories import IndicatorRepository, SyncErrorRepository

st.set_page_config(page_title="Data Quality - MQL5 Macro Compare", layout="wide")

init_session_state()
render_top_bar()
loc = locale()

st.header(t("quality.title", loc))

session = get_session()
try:
    indicator_repo = IndicatorRepository(session)
    indicators = indicator_repo.list_all()
    all_observations = session.query(Observation).all()

    obs_df = pd.DataFrame(
        [
            {
                "indicator_id": o.indicator_id,
                "release_date": o.release_date,
                "reference_period": o.reference_period,
                "actual": o.actual,
                "actual_raw": o.actual_raw,
                "forecast": o.forecast,
                "forecast_raw": o.forecast_raw,
            }
            for o in all_observations
        ]
    )

    indicators_by_id = {i.id: i for i in indicators}

    missing_count = int(obs_df["actual"].isna().sum()) if not obs_df.empty else 0
    duplicate_count = (
        int(obs_df.duplicated(subset=["indicator_id", "release_date", "reference_period"]).sum())
        if not obs_df.empty
        else 0
    )

    def _looks_na(raw: str) -> bool:
        return not raw or raw.strip().lower() in ("", "-", "--", "n/a", "na", "null", "none")

    unnormalized_df = (
        obs_df[obs_df["actual"].isna() & ~obs_df["actual_raw"].apply(_looks_na)] if not obs_df.empty else obs_df
    )
    unnormalized_count = len(unnormalized_df)

    suspicious_jumps = []
    if not obs_df.empty:
        for indicator_id, group in obs_df.sort_values("release_date").groupby("indicator_id"):
            series = group["actual"].dropna()
            if len(series) < 2:
                continue
            pct = series.pct_change().abs()
            jumps = pct[pct > 5.0]  # >500% move between consecutive releases
            for idx in jumps.index:
                suspicious_jumps.append({"indicator_id": indicator_id, "release_date": group.loc[idx, "release_date"]})

    missing_units = [i for i in indicators if not i.unit]
    missing_translation = [i for i in indicators if len(i.translations) < len(settings.supported_locales)]

    error_repo = SyncErrorRepository(session)
    date_parse_errors = [e for e in error_repo.recent(500) if "date" in e.error_message.lower()]

    last_updates = [i.last_updated_at for i in indicators if i.last_updated_at]
    last_update = max(last_updates) if last_updates else None

    metrics = st.columns(4)
    metrics[0].metric(t("quality.missing_values", loc), missing_count)
    metrics[1].metric(t("quality.duplicates", loc), duplicate_count)
    metrics[2].metric(t("quality.invalid_dates", loc), len(date_parse_errors))
    metrics[3].metric(t("quality.unnormalized", loc), unnormalized_count)

    metrics2 = st.columns(4)
    metrics2[0].metric(t("quality.suspicious_jumps", loc), len(suspicious_jumps))
    metrics2[1].metric(t("quality.missing_units", loc), len(missing_units))
    metrics2[2].metric(t("quality.missing_translation", loc), len(missing_translation))
    metrics2[3].metric(t("quality.last_update", loc), last_update.strftime("%Y-%m-%d %H:%M") if last_update else "-")

    total_issues = (
        missing_count + duplicate_count + len(date_parse_errors) + unnormalized_count
        + len(suspicious_jumps) + len(missing_units) + len(missing_translation)
    )
    if total_issues == 0:
        st.success(t("quality.no_issues", loc))

    if missing_units:
        st.subheader(t("quality.missing_units", loc))
        st.dataframe(pd.DataFrame([{"indicator": i.canonical_name, "slug": i.slug} for i in missing_units]),
                     use_container_width=True, hide_index=True)

    if missing_translation:
        st.subheader(t("quality.missing_translation", loc))
        st.dataframe(
            pd.DataFrame(
                [
                    {
                        "indicator": i.canonical_name,
                        "locales_present": ", ".join(sorted(tr.locale for tr in i.translations)) or "-",
                    }
                    for i in missing_translation
                ]
            ),
            use_container_width=True, hide_index=True,
        )

    if suspicious_jumps:
        st.subheader(t("quality.suspicious_jumps", loc))
        rows = [
            {
                "indicator": indicators_by_id[j["indicator_id"]].canonical_name if j["indicator_id"] in indicators_by_id else j["indicator_id"],
                "release_date": j["release_date"],
            }
            for j in suspicious_jumps
        ]
        st.dataframe(pd.DataFrame(rows), use_container_width=True, hide_index=True)
finally:
    session.close()
