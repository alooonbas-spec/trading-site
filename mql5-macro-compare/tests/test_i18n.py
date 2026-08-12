import json

import pytest

from src import i18n
from src.config import settings


def test_all_locale_files_are_valid_json():
    for locale in settings.supported_locales:
        path = settings.locales_dir / f"{locale}.json"
        assert path.exists(), f"missing locale file for {locale}"
        with path.open(encoding="utf-8") as f:
            data = json.load(f)
        assert isinstance(data, dict)
        assert len(data) > 50


def test_all_locales_have_same_keys_as_english():
    with (settings.locales_dir / "en.json").open(encoding="utf-8") as f:
        en_keys = set(json.load(f).keys())
    for locale in settings.supported_locales:
        if locale == "en":
            continue
        with (settings.locales_dir / f"{locale}.json").open(encoding="utf-8") as f:
            keys = set(json.load(f).keys())
        assert keys == en_keys, f"{locale}.json key set differs from en.json"


def test_t_returns_translation():
    i18n.clear_cache()
    assert i18n.t("app.title", locale="ru") == "MQL5 Macro Compare"
    assert i18n.t("nav.comparison", locale="ru") == "Сравнение"
    assert i18n.t("nav.comparison", locale="en") == "Comparison"


def test_t_falls_back_to_english_then_key():
    i18n.clear_cache()
    assert i18n.t("nonexistent.key.xyz", locale="ru") == "nonexistent.key.xyz"


def test_normalize_locale_unsupported_falls_back():
    assert i18n.normalize_locale("xx-YY") == "en"
    assert i18n.normalize_locale(None) == "en"
    assert i18n.normalize_locale("zh") == "zh-CN"
    assert i18n.normalize_locale("en-US") == "en"


def test_detect_browser_locale():
    assert i18n.detect_browser_locale("ru-RU,ru;q=0.9,en;q=0.8") == "ru"
    assert i18n.detect_browser_locale("xx-XX") == "en"
    assert i18n.detect_browser_locale(None) == "en"


def test_is_rtl():
    assert i18n.is_rtl("ar") is True
    assert i18n.is_rtl("en") is False
    assert i18n.is_rtl("ru") is False


def test_indicator_display_name_fallback_chain():
    assert i18n.indicator_display_name("ru", {"ru": "Занятость"}, "Employment", "Employment MQL5") == "Занятость"
    assert i18n.indicator_display_name("de", {"ru": "Занятость"}, "Employment", "Employment MQL5") == "Employment"
    assert i18n.indicator_display_name("de", {}, None, "Employment MQL5") == "Employment MQL5"
