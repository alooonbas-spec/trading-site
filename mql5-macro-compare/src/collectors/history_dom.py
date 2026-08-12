"""Priority 2: parse the History table straight out of server-rendered HTML/DOM.

Cheaper than full browser automation, so this is tried before
history_playwright.py. Returns *raw* string fields only - normalization
(number/date parsing) happens in services/observation_service.py so the
original text is never lost before it's decided what to do with it.
"""
from __future__ import annotations

import logging

import httpx
from bs4 import BeautifulSoup
from tenacity import retry, retry_if_exception_type, stop_after_attempt, wait_exponential

from src.collectors import FetchError, ParseError
from src.collectors.selector_registry import HISTORY_TABLE_SELECTORS
from src.config import settings

logger = logging.getLogger(__name__)


@retry(
    retry=retry_if_exception_type(FetchError),
    stop=stop_after_attempt(settings.max_retries),
    wait=wait_exponential(multiplier=1, min=1, max=20),
    reraise=True,
)
async def fetch_page_html(url: str) -> str:
    try:
        async with httpx.AsyncClient(timeout=settings.request_timeout_seconds, follow_redirects=True) as client:
            resp = await client.get(url, headers={"User-Agent": "Mozilla/5.0"})
            resp.raise_for_status()
            return resp.text
    except httpx.HTTPError as exc:
        raise FetchError(f"Failed to fetch {url}: {exc}") from exc


def parse_history_table(html: str, source_url: str) -> list[dict]:
    """Parse a History table into raw row dicts.

    Expects each row's first cells to look like [date, period, actual,
    forecast, previous] in some order - since no live capture has confirmed
    the exact column order (docs/MQL5_DATA_SOURCE.md), this looks at header
    cell text to map columns by name rather than assuming a fixed position,
    and raises ParseError if it can't find a usable header.
    """
    soup = BeautifulSoup(html, "html.parser")

    table = None
    for selector in HISTORY_TABLE_SELECTORS:
        table = soup.select_one(selector)
        if table is not None:
            break
    if table is None:
        raise ParseError(f"No history table found in {source_url}")

    header_cells = [th.get_text(strip=True).lower() for th in table.find_all("th")]
    if not header_cells:
        first_row = table.find("tr")
        if first_row:
            header_cells = [td.get_text(strip=True).lower() for td in first_row.find_all("td")]

    def _find_col(*keywords: str) -> int | None:
        for i, cell in enumerate(header_cells):
            if any(kw in cell for kw in keywords):
                return i
        return None

    col_date = _find_col("date", "release")
    col_period = _find_col("period", "for")
    col_actual = _find_col("actual")
    col_forecast = _find_col("forecast")
    col_previous = _find_col("previous")

    if col_date is None or col_actual is None:
        raise ParseError(
            f"History table in {source_url} does not have recognizable Date/Actual columns "
            f"(header={header_cells!r}); selector needs re-confirmation, see docs/MQL5_DATA_SOURCE.md"
        )

    rows_out: list[dict] = []
    body_rows = table.find_all("tr")[1:] if header_cells else table.find_all("tr")
    for tr in body_rows:
        cells = [td.get_text(strip=True) for td in tr.find_all("td")]
        if not cells or len(cells) <= col_actual:
            continue
        rows_out.append(
            {
                "release_date_raw": cells[col_date] if col_date < len(cells) else "",
                "reference_period_raw": cells[col_period] if col_period is not None and col_period < len(cells) else "",
                "actual_raw": cells[col_actual] if col_actual < len(cells) else "",
                "forecast_raw": cells[col_forecast] if col_forecast is not None and col_forecast < len(cells) else "",
                "previous_raw": cells[col_previous] if col_previous is not None and col_previous < len(cells) else "",
                "source_url": source_url,
            }
        )

    if not rows_out:
        raise ParseError(f"History table in {source_url} had a header but no data rows")

    return rows_out


async def fetch_history_dom(indicator_page_url: str) -> list[dict]:
    html = await fetch_page_html(indicator_page_url)
    return parse_history_table(html, indicator_page_url)
