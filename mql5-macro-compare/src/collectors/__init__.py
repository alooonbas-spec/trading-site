"""Data collectors for the MQL5 economic calendar.

Priority order (see docs/MQL5_DATA_SOURCE.md):
  1. history_http    - direct HTTP/XHR/CSV endpoint (fastest, once confirmed)
  2. history_dom      - parse the History table out of server-rendered HTML
  3. history_playwright - full browser automation: History tab -> Report -> CSV
  4. tinyfish_fallback - optional, disabled by default, manual opt-in only

Every collector raises a subclass of CollectorError instead of crashing the
caller, so a failure on one indicator never stops a sync job.
"""
from __future__ import annotations


class CollectorError(Exception):
    """Base class for all collector failures."""


class DataSourceNotConfirmed(CollectorError):
    """Raised when a collector's selector/endpoint has not been verified.

    See docs/MQL5_DATA_SOURCE.md - live investigation was blocked by network
    policy in the build sandbox, so this collector deliberately refuses to
    guess instead of shipping an unconfirmed selector as if it were real.
    """


class FetchError(CollectorError):
    """Network/HTTP-level failure while fetching a page or endpoint."""


class ParseError(CollectorError):
    """The page/response did not have the expected structure."""


class InvalidUrlError(CollectorError):
    """A URL failed the allow-list check (must be an https mql5.com economic-calendar URL)."""
