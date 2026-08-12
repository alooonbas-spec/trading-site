"""Seed the catalog with 5 real, well-known MQL5 economic-calendar indicators
(the stage-2 MVP set) and run their first sync.

The URLs below follow MQL5's documented individual-indicator URL pattern
(/en/economic-calendar/<country>/<indicator-slug>) for five indicators that
are known to exist on the public MQL5 economic calendar. Because live
investigation was blocked by network policy in the build sandbox (see
docs/MQL5_DATA_SOURCE.md), the exact slug spelling has not been confirmed
against the live site - if MQL5 uses a slightly different slug, the sync
for that one indicator will fail with a clear sync_errors entry (never
silently, never crashing the rest) and can be corrected via the Indicators
page's "add by URL" once the real slug is known.

Usage:
    python scripts/bootstrap_indicators.py
"""
from __future__ import annotations

import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from src.collectors import InvalidUrlError  # noqa: E402
from src.database import get_session, init_db  # noqa: E402
from src.repositories import IndicatorRepository  # noqa: E402
from src.services import catalog_service  # noqa: E402
from src.services.sync_service import run_sync  # noqa: E402

MVP_INDICATORS = [
    {
        "url": "https://www.mql5.com/en/economic-calendar/united-states/nonfarm-payrolls",
        "canonical_name": "Non-Farm Payrolls",
        "country_code": "US",
        "country_name": "United States",
        "currency_code": "USD",
        "category_code": "labor_market",
        "importance": "high",
        "unit": "K",
        "frequency": "monthly",
        "translations": {
            "en": "Non-Farm Payrolls", "ru": "Занятость вне сельского хозяйства", "zh-CN": "非农就业人数",
            "de": "Beschäftigung außerhalb der Landwirtschaft", "fr": "Emplois non agricoles",
            "es": "Nóminas no agrícolas", "ar": "الوظائف خارج القطاع الزراعي",
            "tr": "Tarım Dışı İstihdam", "ja": "非農業部門雇用者数", "ko": "비농업 고용지수",
        },
    },
    {
        "url": "https://www.mql5.com/en/economic-calendar/united-states/cpi",
        "canonical_name": "Consumer Price Index (CPI)",
        "country_code": "US",
        "country_name": "United States",
        "currency_code": "USD",
        "category_code": "prices",
        "importance": "high",
        "unit": "%",
        "frequency": "monthly",
        "translations": {
            "en": "Consumer Price Index (CPI)", "ru": "Индекс потребительских цен (ИПЦ)", "zh-CN": "消费者物价指数(CPI)",
            "de": "Verbraucherpreisindex (VPI)", "fr": "Indice des prix à la consommation (IPC)",
            "es": "Índice de Precios al Consumidor (IPC)", "ar": "مؤشر أسعار المستهلك",
            "tr": "Tüketici Fiyat Endeksi (TÜFE)", "ja": "消費者物価指数(CPI)", "ko": "소비자물가지수(CPI)",
        },
    },
    {
        "url": "https://www.mql5.com/en/economic-calendar/united-states/unemployment-rate",
        "canonical_name": "Unemployment Rate",
        "country_code": "US",
        "country_name": "United States",
        "currency_code": "USD",
        "category_code": "labor_market",
        "importance": "high",
        "unit": "%",
        "frequency": "monthly",
        "translations": {
            "en": "Unemployment Rate", "ru": "Уровень безработицы", "zh-CN": "失业率",
            "de": "Arbeitslosenquote", "fr": "Taux de chômage", "es": "Tasa de desempleo",
            "ar": "معدل البطالة", "tr": "İşsizlik Oranı", "ja": "失業率", "ko": "실업률",
        },
    },
    {
        "url": "https://www.mql5.com/en/economic-calendar/euro-zone/gdp",
        "canonical_name": "GDP Growth Rate",
        "country_code": "EU",
        "country_name": "Euro Zone",
        "currency_code": "EUR",
        "category_code": "gdp_growth",
        "importance": "high",
        "unit": "%",
        "frequency": "quarterly",
        "translations": {
            "en": "GDP Growth Rate (Euro Zone)", "ru": "Темп роста ВВП (еврозона)", "zh-CN": "GDP增长率(欧元区)",
            "de": "BIP-Wachstum (Eurozone)", "fr": "Croissance du PIB (zone euro)",
            "es": "Crecimiento del PIB (zona euro)", "ar": "معدل نمو الناتج المحلي الإجمالي (منطقة اليورو)",
            "tr": "GSYİH Büyüme Oranı (Euro Bölgesi)", "ja": "GDP成長率(ユーロ圏)", "ko": "GDP 성장률(유로존)",
        },
    },
    {
        "url": "https://www.mql5.com/en/economic-calendar/united-kingdom/gdp",
        "canonical_name": "GDP Growth Rate",
        "country_code": "GB",
        "country_name": "United Kingdom",
        "currency_code": "GBP",
        "category_code": "gdp_growth",
        "importance": "high",
        "unit": "%",
        "frequency": "quarterly",
        "translations": {
            "en": "GDP Growth Rate (UK)", "ru": "Темп роста ВВП (Великобритания)", "zh-CN": "GDP增长率(英国)",
            "de": "BIP-Wachstum (Vereinigtes Königreich)", "fr": "Croissance du PIB (Royaume-Uni)",
            "es": "Crecimiento del PIB (Reino Unido)", "ar": "معدل نمو الناتج المحلي الإجمالي (المملكة المتحدة)",
            "tr": "GSYİH Büyüme Oranı (Birleşik Krallık)", "ja": "GDP成長率(英国)", "ko": "GDP 성장률(영국)",
        },
    },
]


def seed_catalog() -> list[int]:
    session = get_session()
    indicator_ids = []
    try:
        repo = IndicatorRepository(session)
        for spec in MVP_INDICATORS:
            try:
                indicator, created = catalog_service.add_indicator_by_url(session, spec["url"], importance=spec["importance"])
            except InvalidUrlError as exc:
                print(f"  SKIP {spec['url']}: {exc}")
                continue

            indicator.canonical_name = spec["canonical_name"]
            indicator.original_name = spec["canonical_name"]
            indicator.country_code = spec["country_code"]
            indicator.country_name = spec["country_name"]
            indicator.currency_code = spec["currency_code"]
            indicator.category_code = spec["category_code"]
            indicator.unit = spec["unit"]
            indicator.frequency = spec["frequency"]
            indicator.discovery_method = "bootstrap"
            session.commit()

            for loc, display_name in spec.get("translations", {}).items():
                repo.set_translation(indicator.id, loc, display_name=display_name, short_name=display_name)
            session.commit()

            print(f"  {'Added' if created else 'Updated'}: {indicator.canonical_name} ({indicator.slug})")
            indicator_ids.append(indicator.id)
        return indicator_ids
    finally:
        session.close()


async def sync_seeded(indicator_ids: list[int]) -> None:
    from src.repositories import SyncJobRepository

    session = get_session()
    try:
        job = SyncJobRepository(session).create("bootstrap", total_items=len(indicator_ids))
        session.commit()
        job_id = job.id
    finally:
        session.close()

    pause_event = asyncio.Event()
    pause_event.set()
    cancel_event = asyncio.Event()
    await run_sync(job_id, indicator_ids, pause_event, cancel_event)


def main() -> None:
    init_db()
    print("Seeding catalog with 5 MVP indicators...")
    indicator_ids = seed_catalog()

    print(f"\nRunning first sync for {len(indicator_ids)} indicator(s)...")
    print("(If mql5.com is unreachable from this network, each failure is logged")
    print(" to sync_errors and reported below - it will not crash this script.)\n")
    asyncio.run(sync_seeded(indicator_ids))

    session = get_session()
    try:
        from src.repositories import ObservationRepository, SyncErrorRepository

        obs_repo = ObservationRepository(session)
        error_repo = SyncErrorRepository(session)
        print("\nResult:")
        for indicator_id in indicator_ids:
            indicator = IndicatorRepository(session).get_by_id(indicator_id)
            stats = obs_repo.stats_for_indicator(indicator_id)
            print(f"  {indicator.canonical_name}: status={indicator.sync_status}, observations={stats['count']}")

        recent_errors = error_repo.recent(10)
        if recent_errors:
            print("\nRecent sync errors:")
            for err in recent_errors:
                print(f"  [{err.error_type}] {err.error_message[:200]}")
    finally:
        session.close()


if __name__ == "__main__":
    main()
