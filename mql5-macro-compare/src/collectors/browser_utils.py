"""Shared Playwright helpers for collectors and the inspection script."""
from __future__ import annotations

import glob
import os


def find_chromium_executable() -> str | None:
    """Locate a pre-installed Chromium binary, tolerating a browsers-path
    revision mismatch between the installed `playwright` package and
    whatever Chromium build actually sits on disk. Returns None to let
    Playwright fall back to its own resolution if nothing is found.
    """
    browsers_path = os.environ.get("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
    for pattern in (
        f"{browsers_path}/chromium-*/chrome-linux/chrome",
        f"{browsers_path}/chromium_headless_shell-*/chrome-linux/*",
    ):
        matches = sorted(glob.glob(pattern))
        if matches:
            return matches[0]
    return None


DEFAULT_USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"
)
