"""Priority 3: full browser automation - History tab -> Report -> CSV/table.

This is the authoritative fallback: open the individual indicator page,
click "History", look for a "Report"/CSV control, and either capture a CSV
download or scrape the rendered table DOM. Used when history_http.py is not
confirmed and history_dom.py can't find a server-rendered table (i.e. the
history is client-rendered after the History tab is clicked).
"""
from __future__ import annotations

import csv
import io
import logging

from tenacity import retry, retry_if_exception_type, stop_after_attempt, wait_exponential

from src.collectors import FetchError, ParseError
from src.collectors.browser_utils import DEFAULT_USER_AGENT, find_chromium_executable
from src.collectors.history_dom import parse_history_table
from src.collectors.selector_registry import HISTORY_TAB_TEXT, REPORT_CONTROL_TEXT_CANDIDATES
from src.config import settings

logger = logging.getLogger(__name__)


def _parse_csv_rows(csv_text: str, source_url: str) -> list[dict]:
    reader = csv.reader(io.StringIO(csv_text))
    rows = list(reader)
    if len(rows) < 2:
        raise ParseError(f"Downloaded CSV from {source_url} has no data rows")

    header = [c.strip().lower() for c in rows[0]]

    def _find_col(*keywords: str) -> int | None:
        for i, cell in enumerate(header):
            if any(kw in cell for kw in keywords):
                return i
        return None

    col_date = _find_col("date", "release")
    col_period = _find_col("period", "for")
    col_actual = _find_col("actual")
    col_forecast = _find_col("forecast")
    col_previous = _find_col("previous")

    if col_date is None or col_actual is None:
        raise ParseError(f"CSV from {source_url} missing Date/Actual columns (header={header!r})")

    out = []
    for row in rows[1:]:
        if not row or len(row) <= col_actual:
            continue
        out.append(
            {
                "release_date_raw": row[col_date],
                "reference_period_raw": row[col_period] if col_period is not None and col_period < len(row) else "",
                "actual_raw": row[col_actual],
                "forecast_raw": row[col_forecast] if col_forecast is not None and col_forecast < len(row) else "",
                "previous_raw": row[col_previous] if col_previous is not None and col_previous < len(row) else "",
                "source_url": source_url,
            }
        )
    return out


@retry(
    retry=retry_if_exception_type(FetchError),
    stop=stop_after_attempt(settings.max_retries),
    wait=wait_exponential(multiplier=1, min=2, max=30),
    reraise=True,
)
async def fetch_history_playwright(indicator_page_url: str) -> list[dict]:
    from playwright.async_api import async_playwright

    try:
        async with async_playwright() as pw:
            browser = await pw.chromium.launch(headless=True, executable_path=find_chromium_executable())
            context = await browser.new_context(user_agent=DEFAULT_USER_AGENT, accept_downloads=True)
            page = await context.new_page()
            try:
                await page.goto(
                    indicator_page_url, wait_until="networkidle", timeout=int(settings.request_timeout_seconds * 1000)
                )
                await page.wait_for_timeout(1000)

                try:
                    await page.get_by_text(HISTORY_TAB_TEXT, exact=True).first.click(timeout=5000)
                except Exception as exc:
                    raise ParseError(f"Could not find/click '{HISTORY_TAB_TEXT}' tab on {indicator_page_url}") from exc

                await page.wait_for_timeout(1500)

                for control_text in REPORT_CONTROL_TEXT_CANDIDATES:
                    locator = page.get_by_text(control_text, exact=False)
                    if await locator.count() > 0:
                        try:
                            async with page.expect_download(timeout=8000) as download_info:
                                await locator.first.click()
                            download = await download_info.value
                            path = await download.path()
                            if path:
                                with open(path, "r", encoding="utf-8", errors="replace") as f:
                                    csv_text = f.read()
                                return _parse_csv_rows(csv_text, indicator_page_url)
                        except Exception:
                            logger.debug("Report/CSV control '%s' did not trigger a download; falling back to DOM scrape", control_text)
                        break

                html = await page.content()
                return parse_history_table(html, indicator_page_url)
            finally:
                await context.close()
                await browser.close()
    except ParseError:
        raise
    except Exception as exc:
        raise FetchError(f"Playwright history fetch failed for {indicator_page_url}: {exc}") from exc
