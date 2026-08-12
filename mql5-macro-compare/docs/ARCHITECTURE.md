# Architecture

## Layers

```
pages/*.py, app.py        Streamlit UI (thin) - calls src.app_common + src.services
src/app_common.py         Shared Streamlit plumbing: init, top bar, sidebar, i18n wiring
src/services/*            Business logic: catalog, observations, sync, comparison, export
src/collectors/*          MQL5 data acquisition (HTTP / DOM / Playwright / TinyFish)
src/repositories.py       Data-access layer over SQLAlchemy models (upserts, dedup)
src/models.py             SQLAlchemy ORM schema
src/database.py           Engine/session, safe init, pre-migration backup
src/normalizer.py         Raw string -> (number|date), keeps original text
src/calculations.py       Raw / Index100 / Z-score / %change / Surprise
src/charts.py             Plotly figure builders
src/i18n.py, locales/*    Translation lookup + fallback chain
src/background_jobs.py    Thread-based background sync runner (pause/resume/cancel)
```

Data flows one direction: collectors → observation_service (normalize) →
repositories (dedup upsert) → SQLite. The UI never talks to collectors
directly and never blocks on a full sync - it only ever reads from SQLite
via repositories/services, and background_jobs.py's threads are the only
things that also write to it (from separate SQLAlchemy sessions).

## Why a background thread instead of Streamlit's own async

Streamlit reruns the entire script top-to-bottom on every UI interaction
and does not keep a persistent asyncio event loop of its own between runs.
To let a sync job survive many reruns (and let the user keep using the app
while it runs), `background_jobs.py` starts a plain daemon `threading.Thread`
per job, which runs its own `asyncio` event loop internally (where the
actual concurrent HTTP/Playwright fetches happen via `asyncio.Semaphore`).
Streamlit session state only holds a lightweight `JobControl` handle
(`threading.Event`s for pause/cancel); the `sync_jobs`/`sync_errors` tables
in SQLite are the durable source of truth the UI polls by re-reading on
each rerun.

## Why collector priority is HTTP → DOM → Playwright → TinyFish

Cheapest/fastest/most respectful of MQL5's servers first:
1. A confirmed JSON/XHR/CSV endpoint (`history_http.py`) - no browser needed.
2. Parsing a server-rendered HTML table (`history_dom.py`) - one HTTP GET.
3. Full browser automation (`history_playwright.py`) - only when the first
   two don't work, since it's the slowest and heaviest.
4. TinyFish Browser API (`tinyfish_fallback.py`) - opt-in only, never runs
   by default, so there is no per-indicator AI-agent cost in the normal
   path.

See `docs/MQL5_DATA_SOURCE.md` for why (1) is currently disabled
(`selector_registry.CONFIRMED = False`) and what to do about it.

## Dedup / idempotency

`observations` has a unique constraint on
`(indicator_id, release_date, reference_period)`. `ObservationRepository.bulk_upsert`
looks up existing rows by that same key before inserting, so re-running a
sync (or resuming after a crash) updates changed values in place instead of
creating duplicates. `indicators` is keyed by `slug`, upserted the same way.

## i18n

`src/i18n.py` loads `locales/<code>.json` (flat dotted keys) with an
`lru_cache`, and `t(key, locale)` falls back locale → English → the raw key
itself, so a missing translation never blanks out the UI. Indicator
*display names* go through a separate fallback
(`indicator_display_name`): locale translation → English translation →
original MQL5 name - the translated name is display-only and is never used
as an identifier (the DB `slug` is).

## Testing without live MQL5 access

Collector unit tests (`tests/test_collectors.py`) use small, hand-built
HTML/CSV fixtures that follow the *documented* MQL5 page structure rather
than a literal live capture (see `docs/MQL5_DATA_SOURCE.md` for why). They
exercise the parsing logic (URL allow-listing, column-by-header-name
mapping, CSV parsing) in isolation from the network. Service/DB tests use
an isolated in-memory or temp-file SQLite database (`tests/conftest.py`),
never `data/macro.db`.
