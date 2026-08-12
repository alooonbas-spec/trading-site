"""Priority 1: direct HTTP/XHR/CSV endpoint for indicator history.

Disabled until src/collectors/selector_registry.py has a CONFIRMED endpoint
template - see docs/MQL5_DATA_SOURCE.md for why (live investigation was
blocked by sandbox network policy during the initial build). The sync
service treats DataSourceNotConfirmed as "try the next method", not a hard
failure.
"""
from __future__ import annotations

import httpx
from tenacity import retry, retry_if_exception_type, stop_after_attempt, wait_exponential

from src.collectors import DataSourceNotConfirmed, FetchError
from src.collectors.selector_registry import CONFIRMED, HISTORY_ENDPOINT_TEMPLATE
from src.config import settings


@retry(
    retry=retry_if_exception_type(FetchError),
    stop=stop_after_attempt(settings.max_retries),
    wait=wait_exponential(multiplier=1, min=1, max=20),
    reraise=True,
)
async def fetch_history_http(indicator_slug: str, country_slug: str) -> list[dict]:
    if not CONFIRMED or not HISTORY_ENDPOINT_TEMPLATE:
        raise DataSourceNotConfirmed(
            "No confirmed HTTP/XHR history endpoint for MQL5 yet. "
            "Run scripts/inspect_mql5.py from a network that can reach mql5.com "
            "and update src/collectors/selector_registry.py."
        )

    url = HISTORY_ENDPOINT_TEMPLATE.format(
        base_url=settings.mql5_base_url, country_slug=country_slug, indicator_slug=indicator_slug
    )
    try:
        async with httpx.AsyncClient(timeout=settings.request_timeout_seconds) as client:
            resp = await client.get(url, headers={"User-Agent": "Mozilla/5.0"})
            resp.raise_for_status()
            return resp.json()
    except httpx.HTTPError as exc:
        raise FetchError(f"HTTP history endpoint failed for {url}: {exc}") from exc
