"""Discover indicator pages from the MQL5 economic calendar.

Three ways indicators enter the catalog (per spec):
  1. `discover_indicator_links()` - automatic discovery from the calendar page(s)
  2. manual single-URL add - just `validate_indicator_url()` + catalog_service
  3. bulk import from a CSV/JSON list of URLs - same validation, batched

All three funnel through `validate_indicator_url` so nothing but a genuine
https://www.mql5.com/.../economic-calendar/<country>/<slug> URL is ever
stored or fetched.
"""
from __future__ import annotations

import logging
import re
from dataclasses import dataclass
from urllib.parse import urlparse

import httpx
from bs4 import BeautifulSoup

from src.collectors import FetchError, InvalidUrlError
from src.config import settings

logger = logging.getLogger(__name__)

_INDICATOR_PATH_RE = re.compile(r"^/[a-z]{2}/economic-calendar/([a-z0-9-]+)/([a-z0-9-]+)/?$")


@dataclass
class DiscoveredIndicator:
    url: str
    country_slug: str
    indicator_slug: str
    link_text: str = ""


def validate_indicator_url(url: str) -> str:
    """Allow only https://*.mql5.com/.../economic-calendar/<country>/<slug> URLs.

    Returns the normalized URL, raises InvalidUrlError otherwise. This is
    the one gate every catalog-entry path (auto-discovery, manual add, bulk
    import) must pass through before a URL is fetched or persisted.
    """
    try:
        parsed = urlparse(url.strip())
    except Exception as exc:
        raise InvalidUrlError(f"Could not parse URL: {url!r}") from exc

    if parsed.scheme != "https":
        raise InvalidUrlError(f"Only https URLs are allowed: {url!r}")
    if parsed.netloc not in ("www.mql5.com", "mql5.com"):
        raise InvalidUrlError(f"Only mql5.com URLs are allowed: {url!r}")
    if not _INDICATOR_PATH_RE.match(parsed.path):
        raise InvalidUrlError(
            f"URL must point to an individual indicator page "
            f"(/en/economic-calendar/<country>/<indicator>): {url!r}"
        )

    return f"https://www.mql5.com{parsed.path.rstrip('/')}"


def parse_indicator_links_from_html(html: str, base_url: str) -> list[DiscoveredIndicator]:
    """Extract individual-indicator links from calendar page HTML.

    Deliberately generic (any <a href> matching the URL shape) rather than
    tied to an unconfirmed CSS class, since the calendar page's DOM
    structure has not been verified live (see docs/MQL5_DATA_SOURCE.md).
    """
    soup = BeautifulSoup(html, "html.parser")
    found: dict[str, DiscoveredIndicator] = {}

    for anchor in soup.find_all("a", href=True):
        href = anchor["href"]
        if href.startswith("/"):
            full_url = f"{base_url.rstrip('/')}{href}"
        elif href.startswith(base_url):
            full_url = href
        else:
            continue

        try:
            normalized = validate_indicator_url(full_url)
        except InvalidUrlError:
            continue

        parsed = urlparse(normalized)
        match = _INDICATOR_PATH_RE.match(parsed.path)
        if not match:
            continue
        country_slug, indicator_slug = match.group(1), match.group(2)

        found[normalized] = DiscoveredIndicator(
            url=normalized,
            country_slug=country_slug,
            indicator_slug=indicator_slug,
            link_text=anchor.get_text(strip=True),
        )

    return list(found.values())


async def discover_indicator_links(base_url: str | None = None) -> list[DiscoveredIndicator]:
    """Fetch the general calendar page and extract individual indicator links.

    Raises FetchError on network failure - callers (catalog_service) should
    catch this and surface it rather than crash the whole app; discovery
    failing does not affect indicators already in the catalog.
    """
    base_url = base_url or settings.mql5_base_url
    url = f"{base_url.rstrip('/')}/en/economic-calendar"

    try:
        async with httpx.AsyncClient(timeout=settings.request_timeout_seconds, follow_redirects=True) as client:
            resp = await client.get(url, headers={"User-Agent": "Mozilla/5.0"})
            resp.raise_for_status()
    except httpx.HTTPError as exc:
        raise FetchError(f"Failed to fetch calendar page {url}: {exc}") from exc

    links = parse_indicator_links_from_html(resp.text, base_url)
    logger.info("Discovered %d candidate indicator links from %s", len(links), url)
    return links


def parse_bulk_import_list(raw_text: str, fmt: str) -> list[str]:
    """Parse a CSV or JSON list of URLs for bulk import. Returns validated URLs only.

    Invalid lines are skipped (not raised) so one bad row doesn't block the
    rest of a batch; callers should report skipped-count to the user.
    """
    candidates: list[str] = []
    if fmt == "json":
        import json

        data = json.loads(raw_text)
        if isinstance(data, list):
            candidates = [str(item) for item in data]
        elif isinstance(data, dict) and "urls" in data:
            candidates = [str(item) for item in data["urls"]]
    else:  # csv - one URL per line, optional header
        for line in raw_text.splitlines():
            line = line.strip().strip(",")
            if not line or line.lower() in ("url", "urls"):
                continue
            candidates.append(line.split(",")[0].strip())

    valid_urls = []
    for candidate in candidates:
        try:
            valid_urls.append(validate_indicator_url(candidate))
        except InvalidUrlError as exc:
            logger.warning("Skipping invalid URL in bulk import: %s", exc)
    return valid_urls
