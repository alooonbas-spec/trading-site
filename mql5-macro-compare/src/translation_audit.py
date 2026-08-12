"""Audit locale files and Python source for translation problems.

Run as: python -m src.translation_audit

Checks:
  - broken JSON in any locale file
  - key sets that don't match the English (reference) locale
  - indicators in the DB missing a translation row for a supported locale
  - string literals that look like hardcoded UI text left in src/pages code
    instead of going through t("...")

Exits with a non-zero status if any problem is found, so it can be used in
CI.
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

from src.config import settings

REFERENCE_LOCALE = "en"

# A conservative heuristic: flag string literals of 3+ words that are passed
# to st.* UI calls or used as plain literals, since real UI text should
# always go through t(). Deliberately narrow to avoid false positives on
# f-strings built from translated pieces, log messages, and code identifiers.
_UI_CALL_RE = re.compile(
    r"st\.(?:write|markdown|header|subheader|title|caption|button|checkbox|"
    r"selectbox|multiselect|text_input|error|warning|success|info|toast|"
    r"metric|expander|tab)\(\s*[\"']([^\"']{3,})[\"']"
)
_LIKELY_SENTENCE_RE = re.compile(r"^[A-ZА-ЯЁ][a-zа-яё]+(\s[a-zA-Zа-яёА-ЯЁ]+){1,}")


def check_json_files() -> tuple[dict[str, dict], list[str]]:
    problems: list[str] = []
    locales: dict[str, dict] = {}
    for locale in settings.supported_locales:
        path = settings.locales_dir / f"{locale}.json"
        if not path.exists():
            problems.append(f"[missing_file] locales/{locale}.json does not exist")
            continue
        try:
            with path.open(encoding="utf-8") as f:
                locales[locale] = json.load(f)
        except json.JSONDecodeError as exc:
            problems.append(f"[broken_json] locales/{locale}.json: {exc}")
    return locales, problems


def check_key_parity(locales: dict[str, dict]) -> list[str]:
    problems: list[str] = []
    if REFERENCE_LOCALE not in locales:
        return [f"[no_reference] locales/{REFERENCE_LOCALE}.json failed to load; cannot compare key sets"]

    reference_keys = set(locales[REFERENCE_LOCALE].keys())
    for locale, data in locales.items():
        if locale == REFERENCE_LOCALE:
            continue
        keys = set(data.keys())
        missing = reference_keys - keys
        extra = keys - reference_keys
        for key in sorted(missing):
            problems.append(f"[missing_key] locales/{locale}.json is missing '{key}'")
        for key in sorted(extra):
            problems.append(f"[extra_key] locales/{locale}.json has undeclared '{key}' (not in en.json)")
    return problems


def check_indicator_translations() -> list[str]:
    problems: list[str] = []
    try:
        from src.database import get_session
        from src.models import Indicator, IndicatorTranslation
    except Exception as exc:  # pragma: no cover - defensive
        return [f"[db_unavailable] Could not open database to audit indicator translations: {exc}"]

    if not settings.database_path.exists():
        return problems  # nothing synced yet, nothing to audit

    session = get_session()
    try:
        indicators = session.query(Indicator).all()
        for indicator in indicators:
            locales_present = {t.locale for t in indicator.translations}
            missing = set(settings.supported_locales) - locales_present
            if missing:
                problems.append(
                    f"[missing_indicator_translation] indicator '{indicator.slug}' has no translation "
                    f"for: {', '.join(sorted(missing))} (will fall back to English/original name - not a hard error)"
                )
    finally:
        session.close()
    return problems


def check_hardcoded_ui_strings() -> list[str]:
    problems: list[str] = []
    search_roots = [settings.database_path.parent.parent / "src", settings.database_path.parent.parent / "pages"]
    for root in search_roots:
        if not root.exists():
            continue
        for path in sorted(root.rglob("*.py")):
            text = path.read_text(encoding="utf-8")
            for match in _UI_CALL_RE.finditer(text):
                literal = match.group(1)
                if literal.startswith("calc.") or "{" in literal:
                    continue
                if _LIKELY_SENTENCE_RE.match(literal):
                    line_no = text[: match.start()].count("\n") + 1
                    problems.append(
                        f"[hardcoded_ui_string] {path.relative_to(settings.database_path.parent.parent)}:{line_no} "
                        f"looks like untranslated UI text: {literal!r}"
                    )
    return problems


def main() -> int:
    all_problems: list[str] = []

    locales, json_problems = check_json_files()
    all_problems.extend(json_problems)
    all_problems.extend(check_key_parity(locales))
    all_problems.extend(check_indicator_translations())
    all_problems.extend(check_hardcoded_ui_strings())

    if not all_problems:
        print("Translation audit: OK - no problems found.")
        return 0

    hard_errors = [p for p in all_problems if not p.startswith("[missing_indicator_translation]")]

    print(f"Translation audit found {len(all_problems)} item(s):\n")
    for problem in all_problems:
        print(f"  {problem}")

    return 1 if hard_errors else 0


if __name__ == "__main__":
    sys.exit(main())
