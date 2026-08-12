# MQL5 Macro Compare

A local Streamlit app for automatically collecting historical MQL5
economic-calendar indicator data, storing it in SQLite, and comparing
several indicators in one interactive chart (Raw, Index 100, Z-score,
% change, Surprise).

## Features

- Automatic indicator discovery + manual add-by-URL + CSV/JSON bulk import
- Historical data collection with a documented collector priority (HTTP →
  DOM → Playwright → optional TinyFish fallback) - see
  `docs/MQL5_DATA_SOURCE.md`
- Local SQLite storage, deduplicated/idempotent sync, incremental updates
- Search + filter indicators (country, currency, category, importance)
- Multi-select comparison chart with 5 modes (Raw / Index 100 / Z-score /
  % change [previous, 3m, 6m, 12m, YoY] / Surprise), dual-axis handling for
  incompatible scales, per-indicator mini charts, comparison table
- CSV (UTF-8 BOM) / Excel (multi-sheet) / interactive HTML export
- 10 UI languages (`ru, en, zh-CN, de, fr, es, ar, tr, ja, ko`), RTL for
  Arabic, browser-language auto-detect, persisted language choice that
  never resets your selection/filters
- Background sync (pause/resume/cancel/retry-failed) that never blocks the
  UI - the UI only ever reads from SQLite
- Data Quality page (missing values, duplicates, invalid dates,
  un-normalized raw values, suspicious jumps, missing units/translations)

## Known limitation (read this first)

This project was built in a sandboxed environment whose network policy
blocks `mql5.com`. **Live scraping/investigation could not be verified
against the real site during the build.** Everything downstream of that
(collectors, catalog, sync, UI) is fully implemented, unit-tested against
constructed fixtures, and fails gracefully (per-indicator errors logged to
`sync_errors`, nothing crashes) — but the exact CSS selectors and
History→Report→CSV flow in `src/collectors/history_dom.py` /
`history_playwright.py` are marked `CONFIRMED = False` in
`src/collectors/selector_registry.py` until someone runs
`scripts/inspect_mql5.py` from a network that can actually reach mql5.com
and updates that file + `docs/MQL5_DATA_SOURCE.md` with the real findings.
Run the diagnostic script first (Windows commands below).

## Requirements

- Python 3.12+
- Windows/macOS/Linux with normal internet access to `mql5.com`

## Setup (Windows PowerShell)

```powershell
py -m venv .venv
.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install -r requirements.txt
playwright install chromium
copy .env.example .env
python scripts/inspect_mql5.py
python scripts/bootstrap_indicators.py
streamlit run app.py
```

## Other commands

```powershell
python scripts/sync_all.py
python scripts/retry_failed.py
pytest -q
python -m src.translation_audit
```

## Setup (macOS/Linux)

```bash
python3.12 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
pip install -r requirements.txt
playwright install chromium
cp .env.example .env
python scripts/inspect_mql5.py
python scripts/bootstrap_indicators.py
streamlit run app.py
```

## Project layout

See `docs/ARCHITECTURE.md` for the layer breakdown and the design
rationale (background sync via threads, collector priority, dedup
strategy, i18n fallback chain).

```
app.py                  Entry point (Comparison view)
pages/                  Comparison, Indicators, Synchronization, Data Quality, Settings
src/                    Config, DB, models, repositories, i18n, calculations, services, collectors
scripts/                inspect_mql5.py, bootstrap_indicators.py, sync_all.py, retry_failed.py
locales/                10 locale JSON files
tests/                  pytest suite (80 tests)
docs/                   MQL5_DATA_SOURCE.md, ARCHITECTURE.md
```

## Stage-2 MVP indicators

`scripts/bootstrap_indicators.py` seeds 5 real MQL5 indicators (Non-Farm
Payrolls, CPI, Unemployment Rate, Euro Zone GDP, UK GDP) with real
metadata and translations, then runs their first sync. If the exact URL
slug MQL5 uses differs from what's hard-coded there, that one indicator's
sync fails with a clear `sync_errors` entry (not a crash) - fix the slug or
add it manually via the Indicators page once confirmed.

## Security & data hygiene

- Secrets only via `.env` (see `.env.example`); `.env` is gitignored.
- Only `https://www.mql5.com/.../economic-calendar/<country>/<slug>` URLs
  are ever fetched or stored (`collectors/discovery.py::validate_indicator_url`).
- No cookies/session tokens are persisted to disk or committed.
- No CAPTCHA/auth bypass. Sync uses bounded concurrency (default 3, max 5),
  exponential-backoff retries, and a minimum delay between requests.
- Every schema change backs up `data/macro.db` first
  (`src/database.py::backup_database`) and never drops/truncates on error.
