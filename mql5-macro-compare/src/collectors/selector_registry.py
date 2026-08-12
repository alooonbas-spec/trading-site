"""Single source of truth for MQL5 selectors and endpoint templates.

CONFIRMED is False until someone has actually run scripts/inspect_mql5.py
from a network that can reach mql5.com and verified the values below
against a real `inspection_report.json`. See docs/MQL5_DATA_SOURCE.md.

Nothing in this file should be treated as authoritative while CONFIRMED is
False - collectors check this flag and either skip the HTTP-endpoint path
entirely (history_http.py) or log a warning before trying the best-effort
DOM/Playwright selectors below.
"""
from __future__ import annotations

CONFIRMED = False
CONFIRMED_AT: str | None = None  # ISO timestamp, set when someone verifies this file
CONFIRMED_BY_REPORT: str | None = None  # path to the inspection_report.json used to confirm

# Individual indicator page URL template. Publicly observable from any
# mql5.com economic-calendar link, not selector-dependent.
INDICATOR_PAGE_URL_TEMPLATE = "{base_url}/en/economic-calendar/{country_slug}/{indicator_slug}"
CALENDAR_LIST_URL = "{base_url}/en/economic-calendar"

# --- Below: best-effort, NOT confirmed against a live DOM capture ---------

HISTORY_TAB_TEXT = "History"
REPORT_CONTROL_TEXT_CANDIDATES = ("Report", "CSV", "Export")

# Candidate CSS selectors for the History table, tried in order by
# history_dom.py. Kept broad/generic on purpose (table rows with a date-like
# first cell) since no real selector has been confirmed.
HISTORY_TABLE_SELECTORS = (
    "table.history-table",
    "table[class*=history]",
    "table[class*=calendar]",
    "table",
)

# Direct HTTP/XHR endpoint template - intentionally left unset until
# inspect_mql5.py confirms one exists. history_http.py refuses to run while
# this is None.
HISTORY_ENDPOINT_TEMPLATE: str | None = None
