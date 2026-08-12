"""Diagnostic script: investigate the real structure of a single MQL5
economic-calendar indicator page before any scraping selectors are written.

It opens one indicator page with a real browser (Playwright/Chromium),
waits for the page to settle, opens the "History" tab, looks for a
"Report"/CSV control, and records every network request/response seen
along the way. Nothing here is used to guess selectors ahead of time —
this script's *output* (saved under data/raw/inspect/<timestamp>/) is what
selector_registry.py should be built from.

Usage:
    python scripts/inspect_mql5.py [indicator_url]

If no URL is given, a well-known indicator page is used as a default probe
target. The script never fails the process on network/browser errors: it
records the failure into inspection_report.json so the run is diagnostic
even when the site is unreachable from the current network.
"""
from __future__ import annotations

import asyncio
import json
import sys
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from src.collectors.browser_utils import find_chromium_executable  # noqa: E402

DEFAULT_PROBE_URL = "https://www.mql5.com/en/economic-calendar/united-states/nonfarm-payrolls"
BASE_URL = "https://www.mql5.com"
OUTPUT_ROOT = Path(__file__).resolve().parent.parent / "data" / "raw" / "inspect"


@dataclass
class NetworkEvent:
    kind: str  # "request" | "response"
    url: str
    method: str | None = None
    status: int | None = None
    resource_type: str | None = None
    content_type: str | None = None
    timestamp: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


async def inspect(url: str, out_dir: Path) -> dict:
    from playwright.async_api import async_playwright

    report: dict = {
        "url": url,
        "started_at": datetime.now(timezone.utc).isoformat(),
        "success": False,
        "error": None,
        "links": [],
        "buttons": [],
        "tabs": [],
        "history_tab_found": False,
        "history_tab_opened": False,
        "report_control_found": False,
        "csv_download_url": None,
        "data_source_guess": None,
        "network_events": [],
    }

    network_events: list[NetworkEvent] = []

    async with async_playwright() as pw:
        executable_path = find_chromium_executable()
        browser = await pw.chromium.launch(headless=True, executable_path=executable_path)
        context = await browser.new_context(
            user_agent=(
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"
            )
        )
        page = await context.new_page()

        def on_request(req):
            network_events.append(
                NetworkEvent(kind="request", url=req.url, method=req.method, resource_type=req.resource_type)
            )

        def on_response(resp):
            try:
                ctype = resp.headers.get("content-type")
            except Exception:
                ctype = None
            network_events.append(NetworkEvent(kind="response", url=resp.url, status=resp.status, content_type=ctype))

        page.on("request", on_request)
        page.on("response", on_response)

        try:
            await page.goto(url, wait_until="networkidle", timeout=45000)
            await page.wait_for_timeout(1500)

            html = await page.content()
            (out_dir / "page.html").write_text(html, encoding="utf-8")
            await page.screenshot(path=str(out_dir / "screenshot.png"), full_page=True)

            links = await page.eval_on_selector_all(
                "a", "els => els.map(e => ({href: e.href, text: e.textContent.trim().slice(0,120)}))"
            )
            report["links"] = links[:500]

            buttons = await page.eval_on_selector_all(
                "button, [role=button]",
                "els => els.map(e => ({text: e.textContent.trim().slice(0,120), class: e.className, id: e.id}))",
            )
            report["buttons"] = buttons[:200]

            tabs = await page.eval_on_selector_all(
                "[role=tab], .tabs a, .tabs__item, [class*=tab]",
                "els => els.map(e => ({text: e.textContent.trim().slice(0,80), class: e.className}))",
            )
            report["tabs"] = tabs[:200]

            history_link = None
            for l in links:
                if l["text"] and l["text"].strip().lower() == "history":
                    history_link = l
                    break
            report["history_tab_found"] = history_link is not None

            if history_link is not None:
                try:
                    await page.click(f"a[href='{history_link['href']}']", timeout=5000)
                except Exception:
                    try:
                        await page.get_by_text("History", exact=True).first.click(timeout=5000)
                    except Exception as exc:
                        report["error"] = f"could not click History tab: {exc}"
                if report["error"] is None:
                    await page.wait_for_timeout(2000)
                    report["history_tab_opened"] = True
                    history_html = await page.content()
                    (out_dir / "history_page.html").write_text(history_html, encoding="utf-8")
                    await page.screenshot(path=str(out_dir / "history_screenshot.png"), full_page=True)

                    report_candidates = await page.eval_on_selector_all(
                        "a, button",
                        "els => els.map(e => ({text: e.textContent.trim(), href: e.href || null, class: e.className}))",
                    )
                    report_ctrl = [
                        c
                        for c in report_candidates
                        if c["text"] and ("report" in c["text"].lower() or "csv" in c["text"].lower())
                    ]
                    report["report_control_found"] = len(report_ctrl) > 0
                    report["report_candidates"] = report_ctrl[:50]

                    csv_events = [
                        e
                        for e in network_events
                        if e.kind == "response"
                        and (
                            (e.content_type and "csv" in e.content_type.lower())
                            or e.url.lower().endswith(".csv")
                        )
                    ]
                    if csv_events:
                        report["csv_download_url"] = csv_events[0].url
                        report["data_source_guess"] = "csv_endpoint"

                    if report["data_source_guess"] is None:
                        json_events = [
                            e
                            for e in network_events
                            if e.kind == "response"
                            and e.content_type
                            and "json" in e.content_type.lower()
                            and "economic-calendar" in e.url
                        ]
                        if json_events:
                            report["data_source_guess"] = "xhr_json"
                            report["xhr_json_sample_url"] = json_events[0].url

                    if report["data_source_guess"] is None:
                        tables = await page.eval_on_selector_all(
                            "table", "els => els.length"
                        )
                        if tables:
                            report["data_source_guess"] = "html_dom_table"

            report["success"] = True
        except Exception as exc:  # network blocked, timeout, DNS, etc.
            report["error"] = f"{type(exc).__name__}: {exc}"
        finally:
            await context.close()
            await browser.close()

    report["network_events"] = [e.__dict__ for e in network_events][:1000]
    report["finished_at"] = datetime.now(timezone.utc).isoformat()
    return report


def main() -> None:
    url = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_PROBE_URL
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    out_dir = OUTPUT_ROOT / stamp
    out_dir.mkdir(parents=True, exist_ok=True)

    report = asyncio.run(inspect(url, out_dir))

    (out_dir / "inspection_report.json").write_text(
        json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8"
    )

    print(f"Inspection output written to: {out_dir}")
    if report["success"]:
        print(f"data_source_guess = {report.get('data_source_guess')}")
        print(f"history_tab_found = {report['history_tab_found']}")
        print(f"history_tab_opened = {report['history_tab_opened']}")
        print(f"report_control_found = {report['report_control_found']}")
    else:
        print(f"Inspection FAILED: {report['error']}")
        print("This is expected if mql5.com is unreachable from this network/sandbox.")
        print("Re-run this script from an environment with normal internet access,")
        print("then update docs/MQL5_DATA_SOURCE.md and src/collectors/selector_registry.py")
        print("with the confirmed findings before relying on live selectors.")


if __name__ == "__main__":
    main()
