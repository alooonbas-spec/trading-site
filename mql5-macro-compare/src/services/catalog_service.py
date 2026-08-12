"""Indicator catalog: automatic discovery, manual add-by-URL, bulk import.

Never re-adds a URL/slug already in the catalog (upsert by slug), and never
re-crawls the whole site on every app start - discovery is an explicit,
user-triggered action (Indicators page / bootstrap script), not something
that runs on import.
"""
from __future__ import annotations

import logging

from sqlalchemy.orm import Session

from src.collectors import FetchError, InvalidUrlError
from src.collectors.discovery import discover_indicator_links, parse_bulk_import_list, validate_indicator_url
from src.models import Indicator
from src.repositories import IndicatorRepository

logger = logging.getLogger(__name__)


def _slug_to_title(slug: str) -> str:
    return " ".join(word.capitalize() for word in slug.replace("_", "-").split("-"))


def add_indicator_by_url(session: Session, url: str, importance: str = "medium") -> tuple[Indicator, bool]:
    """Register a single indicator from its individual MQL5 page URL.

    Only stores what can be derived without a network call (slug, URL,
    placeholder name); the first sync fills in the real canonical/original
    name, currency, unit, etc. Raises InvalidUrlError for anything that
    isn't a genuine mql5.com economic-calendar indicator URL.
    """
    normalized = validate_indicator_url(url)
    parts = normalized.rsplit("/", 2)
    country_slug, indicator_slug = parts[-2], parts[-1]
    slug = f"{country_slug}__{indicator_slug}"

    repo = IndicatorRepository(session)
    placeholder_name = _slug_to_title(indicator_slug)
    indicator, created = repo.upsert(
        slug=slug,
        canonical_name=placeholder_name,
        original_name=placeholder_name,
        country_code=country_slug[:8].upper(),
        country_name=_slug_to_title(country_slug),
        currency_code="",
        category_code="general",
        importance=importance,
        unit="",
        frequency="",
        source_name="MQL5",
        source_url=normalized,
        sync_status="pending",
    )
    if created:
        indicator.discovery_method = "manual"
        session.flush()
    session.commit()
    return indicator, created


def bulk_import(session: Session, raw_text: str, fmt: str) -> dict:
    """Import a batch of URLs from CSV or JSON text. Returns a summary dict."""
    urls = parse_bulk_import_list(raw_text, fmt)
    added, skipped_existing, failed = 0, 0, 0
    for url in urls:
        try:
            _indicator, created = add_indicator_by_url(session, url)
            added += 1 if created else 0
            skipped_existing += 0 if created else 1
        except InvalidUrlError:
            failed += 1
    return {"total_valid_urls": len(urls), "added": added, "already_existed": skipped_existing, "failed": failed}


async def run_discovery(session: Session) -> dict:
    """Auto-discover indicator links from the general calendar page.

    Adds any not already in the catalog (dedup by slug); never removes
    existing entries. Returns a summary; network failures are caught and
    reported rather than raised, since discovery failing must not affect
    indicators already synced.
    """
    try:
        links = await discover_indicator_links()
    except FetchError as exc:
        logger.warning("Discovery failed: %s", exc)
        return {"error": str(exc), "found": 0, "added": 0}

    added = 0
    for link in links:
        _indicator, created = add_indicator_by_url(session, link.url)
        if created:
            added += 1

    return {"found": len(links), "added": added}


def search_indicators(
    session: Session,
    query: str = "",
    country: str | None = None,
    currency: str | None = None,
    category: str | None = None,
    importance: str | None = None,
) -> list[Indicator]:
    repo = IndicatorRepository(session)
    indicators = repo.list_all()

    query_lower = query.strip().lower()
    results = []
    for ind in indicators:
        if query_lower and query_lower not in ind.canonical_name.lower() and query_lower not in ind.original_name.lower():
            continue
        if country and ind.country_code != country:
            continue
        if currency and ind.currency_code != currency:
            continue
        if category and ind.category_code != category:
            continue
        if importance and ind.importance != importance:
            continue
        results.append(ind)
    return results
