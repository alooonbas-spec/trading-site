import datetime as dt

import pytest

from src.normalizer import ParseError, is_preliminary, is_revised, parse_date, parse_number


@pytest.mark.parametrize(
    "raw,expected",
    [
        ("1,234.5", 1234.5),
        ("1.234,5", 1234.5),
        ("-3.2%", -3.2),
        ("+3.2%", 3.2),
        ("1.4K", 1400.0),
        ("2.1M", 2_100_000.0),
        ("0.5B", 500_000_000.0),
        ("1T", 1_000_000_000_000.0),
        ("-1.4K", -1400.0),
        ("  12.3  ", 12.3),
        ("12,3", 12.3),
        ("12,345", 12345.0),
        ("0", 0.0),
        ("-0.1", -0.1),
    ],
)
def test_parse_number_valid(raw, expected):
    assert parse_number(raw) == pytest.approx(expected)


@pytest.mark.parametrize("raw", ["", "-", "--", "N/A", "n/a", "NA", None, "null"])
def test_parse_number_na(raw):
    assert parse_number(raw) is None


def test_parse_number_invalid_raises():
    with pytest.raises(ParseError):
        parse_number("not-a-number")


@pytest.mark.parametrize(
    "raw,expected",
    [
        ("2026-07-01", dt.date(2026, 7, 1)),
        ("2026/07/01", dt.date(2026, 7, 1)),
        ("01.07.2026", dt.date(2026, 7, 1)),
        ("Jul 01, 2026", dt.date(2026, 7, 1)),
        ("July 01, 2026", dt.date(2026, 7, 1)),
        ("2026-07-01T10:30:00", dt.date(2026, 7, 1)),
    ],
)
def test_parse_date_valid(raw, expected):
    assert parse_date(raw) == expected


@pytest.mark.parametrize("raw", ["", None, "N/A"])
def test_parse_date_na(raw):
    assert parse_date(raw) is None


def test_parse_date_invalid_raises():
    with pytest.raises(ParseError):
        parse_date("not-a-date")


def test_is_preliminary():
    assert is_preliminary("Preliminary")
    assert is_preliminary("prelim")
    assert not is_preliminary("Final")
    assert not is_preliminary(None)


def test_is_revised():
    assert is_revised("Revised")
    assert is_revised("3.2*")
    assert not is_revised("3.2")
    assert not is_revised(None)
