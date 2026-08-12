# MQL5 economic-calendar data source — investigation notes

## Status: live investigation blocked in the build sandbox

This project was built inside a sandboxed execution environment whose
outbound network policy denies connections to `www.mql5.com`
(`CONNECT` to `www.mql5.com:443` is rejected with HTTP 403 by the
egress proxy — confirmed via the proxy's own status endpoint and by
running `scripts/inspect_mql5.py`, which launched a real headless
Chromium, attempted `page.goto()`, and captured
`net::ERR_TUNNEL_CONNECTION_FAILED`). The failure is a network-policy
denial, not a bug in the script — Playwright, the browser binary, and
the diagnostic pipeline all work correctly; only the destination host
is unreachable from this sandbox.

**Consequence:** the CSS selectors, tab-click sequence, and exact data
delivery mechanism (HTML table vs. XHR/JSON vs. CSV endpoint) described
below are based on the *general, publicly documented structure* of
MQL5's economic calendar (URL pattern, presence of a per-indicator
History tab and a Report/CSV control), **not on a confirmed live DOM
capture**. Per the project's own rules, no selector is allowed to be
used as "confirmed" until it has actually been observed. The collector
code (`src/collectors/`) is written so that:

1. It never crashes when a selector doesn't match — it logs a
   `sync_errors` row and moves to the next indicator.
2. Selectors live in one place (`src/collectors/selector_registry.py`)
   marked `CONFIRMED = False`, so it is obvious what still needs
   verification and nothing pretends otherwise.
3. `scripts/inspect_mql5.py` is ready to run as-is from any machine
   that *can* reach mql5.com (e.g. the user's own Windows machine, per
   the commands in the README) and will write:
   - `data/raw/inspect/<timestamp>/page.html`
   - `data/raw/inspect/<timestamp>/screenshot.png`
   - `data/raw/inspect/<timestamp>/history_page.html`
   - `data/raw/inspect/<timestamp>/history_screenshot.png`
   - `data/raw/inspect/<timestamp>/inspection_report.json` (links,
     buttons, tabs, network request/response log, and a
     `data_source_guess` of `csv_endpoint` / `xhr_json` /
     `html_dom_table`)

**Required next step (outside this sandbox):** run

```
python scripts/inspect_mql5.py https://www.mql5.com/en/economic-calendar/united-states/nonfarm-payrolls
```

on a machine with normal internet access, inspect
`inspection_report.json`, and update
`src/collectors/selector_registry.py` (set `CONFIRMED = True` and fill
in the real selectors/endpoint) plus this document with what was
actually found. Until that happens, the app's live sync will use the
best-effort DOM/table strategy in `history_dom.py` with automatic
fallback to `history_playwright.py`'s History→Report→CSV flow, and any
indicator that fails is recorded in `sync_errors` instead of blocking
the rest of the sync.

## What is publicly known about the site structure (used to design the collectors)

- The general calendar list lives at
  `https://www.mql5.com/en/economic-calendar` and does **not** expose a
  History tab or Report button — this matches the task brief and is why
  the collectors never try to scrape history from that page.
- Each indicator has its own page at
  `https://www.mql5.com/en/economic-calendar/{country-slug}/{indicator-slug}`
  (e.g. `.../united-states/nonfarm-payrolls`,
  `.../united-states/cpi`, `.../euro-zone/gdp`, ...). This is the page
  `discovery.py` extracts links to and `history_*.py` operate on.
- That individual page is documented (publicly, e.g. in MQL5's own
  calendar widget help pages) to expose a **History** tab showing past
  releases (date, reference period, actual, forecast, previous) and,
  within it, typically a way to view/export more of that history
  ("Report"). This matches the task brief's described sequence:
  indicator page → History tab → Report → CSV/table.

## Collector strategy (priority order implemented)

1. **`history_http.py`** — if `inspect_mql5.py` finds a stable JSON/XHR
   or CSV endpoint behind the History tab, this collector calls it
   directly over `httpx` (fastest, lowest load on MQL5). Disabled
   (raises `DataSourceNotConfirmed`) until `selector_registry.py` has a
   confirmed endpoint template.
2. **`history_dom.py`** — parses the History table straight out of
   server-rendered HTML/DOM (BeautifulSoup) when the table is present
   without needing a click. This is attempted first at runtime because
   it's cheap; if the expected table structure isn't found it raises
   and the sync service falls through to Playwright.
3. **`history_playwright.py`** — full browser automation: open the
   indicator page, click **History**, locate **Report**/CSV, and either
   intercept the CSV download or scrape the rendered table DOM. This is
   the authoritative fallback and is what should be re-verified first
   once network access is available.
4. **`tinyfish_fallback.py`** — optional, disabled by default
   (`TINYFISH_ENABLED=false`). Only used if the above all fail *and* the
   user has explicitly opted in and provided `TINYFISH_API_KEY` via
   `.env`. It is never invoked as the primary path, matching the brief's
   requirement that no per-indicator AI agent runs by default.

## Rate limiting & etiquette

- Default concurrency: 3 simultaneous indicator fetches (configurable
  up to 5 via `MQL5_MAX_CONCURRENCY`).
- `MQL5_MIN_REQUEST_DELAY_SECONDS` enforces a minimum delay between
  requests from the same worker.
- Retries use `tenacity` with exponential backoff and a capped attempt
  count (`MQL5_MAX_RETRIES`), never a retry-forever loop.
- No CAPTCHA bypass, no authentication bypass, no cookie/session-token
  persistence to disk or to the repository.
