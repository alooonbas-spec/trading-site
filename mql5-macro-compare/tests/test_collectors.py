"""Collector unit tests.

The HTML/CSV fixtures below are minimal, hand-constructed samples matching
the *documented* MQL5 structure (see docs/MQL5_DATA_SOURCE.md) - they are
NOT literal captures from mql5.com, because live investigation was blocked
by network policy in the build sandbox. They exist purely to test the
parsing logic (column-by-header-name mapping, URL allow-listing, CSV
parsing) in isolation from the network.
"""
import pytest

from src.collectors import InvalidUrlError, ParseError
from src.collectors.discovery import (
    parse_bulk_import_list,
    parse_indicator_links_from_html,
    validate_indicator_url,
)
from src.collectors.history_dom import parse_history_table
from src.collectors.history_playwright import _parse_csv_rows

CALENDAR_HTML_FIXTURE = """
<html><body>
<div class="calendar-list">
  <a href="/en/economic-calendar/united-states/nonfarm-payrolls">Nonfarm Payrolls</a>
  <a href="/en/economic-calendar/united-states/cpi">CPI</a>
  <a href="/en/economic-calendar/united-states">United States</a>
  <a href="/en/economic-calendar">Economic Calendar</a>
  <a href="https://www.mql5.com/en/forum/whatever">Forum</a>
</div>
</body></html>
"""

HISTORY_TABLE_HTML_FIXTURE = """
<html><body>
<div class="tabs"><a>History</a></div>
<table class="history-table">
  <tr><th>Release Date</th><th>Period</th><th>Actual</th><th>Forecast</th><th>Previous</th></tr>
  <tr><td>2026-07-03</td><td>Jun</td><td>206K</td><td>190K</td><td>218K</td></tr>
  <tr><td>2026-06-05</td><td>May</td><td>218K</td><td>200K</td><td>175K</td></tr>
  <tr><td>2026-05-02</td><td>Apr</td><td>N/A</td><td>210K</td><td>303K</td></tr>
</table>
</body></html>
"""

HISTORY_TABLE_NO_MATCH_HTML = """
<html><body><table><tr><th>Foo</th><th>Bar</th></tr><tr><td>1</td><td>2</td></tr></table></body></html>
"""

CSV_FIXTURE = "Date,Period,Actual,Forecast,Previous\n2026-07-03,Jun,206K,190K,218K\n2026-06-05,May,218K,200K,175K\n"


def test_validate_indicator_url_accepts_valid():
    url = validate_indicator_url("https://www.mql5.com/en/economic-calendar/united-states/nonfarm-payrolls")
    assert url == "https://www.mql5.com/en/economic-calendar/united-states/nonfarm-payrolls"


@pytest.mark.parametrize(
    "bad_url",
    [
        "http://www.mql5.com/en/economic-calendar/united-states/cpi",  # not https
        "https://evil.com/en/economic-calendar/united-states/cpi",  # wrong host
        "https://www.mql5.com/en/economic-calendar",  # calendar root, not an indicator
        "https://www.mql5.com/en/economic-calendar/united-states",  # country page, not indicator
        "https://www.mql5.com/en/forum/thread/123",  # unrelated page
        "not-a-url-at-all",
    ],
)
def test_validate_indicator_url_rejects_invalid(bad_url):
    with pytest.raises(InvalidUrlError):
        validate_indicator_url(bad_url)


def test_parse_indicator_links_from_html():
    links = parse_indicator_links_from_html(CALENDAR_HTML_FIXTURE, "https://www.mql5.com")
    slugs = {link.indicator_slug for link in links}
    assert slugs == {"nonfarm-payrolls", "cpi"}
    assert all(link.country_slug == "united-states" for link in links)


def test_parse_history_table_basic():
    rows = parse_history_table(HISTORY_TABLE_HTML_FIXTURE, "https://www.mql5.com/en/economic-calendar/united-states/nonfarm-payrolls")
    assert len(rows) == 3
    assert rows[0]["release_date_raw"] == "2026-07-03"
    assert rows[0]["actual_raw"] == "206K"
    assert rows[2]["actual_raw"] == "N/A"


def test_parse_history_table_raises_without_recognizable_columns():
    with pytest.raises(ParseError):
        parse_history_table(HISTORY_TABLE_NO_MATCH_HTML, "https://www.mql5.com/en/economic-calendar/x/y")


def test_parse_csv_rows():
    rows = _parse_csv_rows(CSV_FIXTURE, "https://www.mql5.com/en/economic-calendar/united-states/nonfarm-payrolls")
    assert len(rows) == 2
    assert rows[0]["actual_raw"] == "206K"
    assert rows[1]["forecast_raw"] == "200K"


def test_parse_bulk_import_list_csv():
    text = "url\nhttps://www.mql5.com/en/economic-calendar/united-states/cpi\nnot-a-valid-url\n"
    urls = parse_bulk_import_list(text, "csv")
    assert urls == ["https://www.mql5.com/en/economic-calendar/united-states/cpi"]


def test_parse_bulk_import_list_json():
    text = '{"urls": ["https://www.mql5.com/en/economic-calendar/united-states/nonfarm-payrolls", "bad"]}'
    urls = parse_bulk_import_list(text, "json")
    assert urls == ["https://www.mql5.com/en/economic-calendar/united-states/nonfarm-payrolls"]
