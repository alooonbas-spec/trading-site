"""Priority 4 (last resort): optional TinyFish Browser API fallback.

Disabled by default. Only used if all of history_http / history_dom /
history_playwright fail AND the user has explicitly opted in via
TINYFISH_ENABLED=true plus TINYFISH_API_KEY in .env. This module never runs
an AI agent per indicator by default - it is a manual, explicit opt-in
escape hatch, not the primary collection path.

TinyFish's actual Browser API contract could not be verified from this
build sandbox (no network access, see docs/MQL5_DATA_SOURCE.md), so this
raises NotConfiguredError with a clear explanation rather than shipping a
fabricated integration. A real integration should replace the body of
`fetch_history_tinyfish` once the API is available to test against.
"""
from __future__ import annotations

from src.collectors import CollectorError
from src.config import settings


class NotConfiguredError(CollectorError):
    pass


async def fetch_history_tinyfish(indicator_page_url: str) -> list[dict]:
    if not settings.tinyfish_enabled:
        raise NotConfiguredError(
            "TinyFish fallback is disabled (TINYFISH_ENABLED=false). "
            "Enable it in Settings/.env only if the primary collectors keep failing."
        )
    if not settings.tinyfish_api_key:
        raise NotConfiguredError(
            "TINYFISH_ENABLED=true but TINYFISH_API_KEY is not set. "
            "Set it via the environment / .env file, never hardcode it."
        )

    raise NotConfiguredError(
        "TinyFish Browser API integration has not been implemented against a verified API contract "
        "(no network access to validate it during initial build). Configure and implement this method "
        f"before relying on it for {indicator_page_url}."
    )
