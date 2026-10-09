#!/usr/bin/env python3
"""Read-only public production checks. Python standard library + curl only.

No credentials, deployment APIs, transactions, proxy overrides or TLS bypasses.
Every completed response is checkpointed before the next one is consumed.
"""

import argparse
import datetime as dt
import json
import math
import os
from pathlib import Path
import subprocess
import tempfile
import time
from html.parser import HTMLParser
from urllib.parse import parse_qs, urljoin, urlsplit

BASE = "https://www.alphatraders.co.il"
CONTROL = "https://vercel.com/"
HEALTH = "/api/health"
LISTINGS = "/api/alpha-exchange/listings"
MARKET = "/api/alpha-exchange/market-rate"
APIS = [HEALTH, LISTINGS, MARKET]
AUTH_GUARDS = ["/api/journal", "/api/news"]
PAGES = ["/", "/ar", "/en", "/ar/login", "/en/login",
         "/ar/usdt-exchange", "/en/usdt-exchange", "/ar/journal", "/en/journal"]
METRICS = ("http_code", "http_connect", "url_effective", "num_redirects",
           "num_connects", "conn_id", "http_version", "content_type",
           "time_namelookup", "time_connect", "time_appconnect",
           "time_pretransfer", "time_starttransfer", "time_total",
           "ssl_verify_result", "exitcode")
SAFE_HEADERS = {"date", "age", "cache-control", "content-type", "location",
                "server-timing", "x-health-route-ms", "x-vercel-cache",
                "x-vercel-id", "x-proxy-error"}
SETUP_SLOW = 3.0
APPLICATION_SLOW = 2.0  # Network-inclusive time after connection setup, not server CPU.
DATABASE_SLOW_MS = 1000


def utcnow():
    return dt.datetime.now(dt.timezone.utc)


def timestamp(value):
    parsed = dt.datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        raise ValueError("Timestamp lacks a timezone")
    return parsed


def finite(value, positive=False):
    return (isinstance(value, (int, float)) and not isinstance(value, bool)
            and math.isfinite(value) and (value > 0 if positive else value >= 0))


def reject_nonfinite(value):
    raise ValueError(f"Nonstandard JSON number: {value}")


class Page(HTMLParser):
    def __init__(self, body):
        super().__init__()
        self.attributes, self.title, self.scripts = {}, "", set()
        self.in_title = False
        self.feed(body)

    def handle_starttag(self, tag, attributes):
        attributes = dict(attributes)
        if tag == "html":
            self.attributes = attributes
        if tag == "title":
            self.in_title = True
        if tag == "script" and attributes.get("src"):
            url = urljoin(BASE, attributes["src"])
            parsed = urlsplit(url)
            if (parsed.netloc == urlsplit(BASE).netloc and parsed.scheme == "https"
                    and parsed.path.startswith("/_next/static/")
                    and parsed.path.endswith(".js")):
                self.scripts.add(url)  # Keep deployment query parameters.

    def handle_endtag(self, tag):
        if tag == "title":
            self.in_title = False

    def handle_data(self, data):
        if self.in_title:
            self.title += data


def header_blocks(raw):
    blocks = []
    for line in raw.splitlines():
        if line.startswith("HTTP/"):
            blocks.append({"status": int(line.split()[1]), "headers": {}})
        elif blocks and ":" in line:
            name, value = line.split(":", 1)
            if name.lower() in SAFE_HEADERS:
                blocks[-1]["headers"][name.lower()] = value.strip()
    return blocks


def validate(observation, body):
    """Return component errors separately from inability to reach production."""
    m, path = observation["metrics"], observation["path"]
    headers = observation["headers"]
    connect_status = m.get("http_connect", 0)
    if any("x-proxy-error" in b["headers"] for b in headers) or connect_status not in (0, 200):
        observation["coverageError"] = "proxy_connection_rejected"
        return []
    if not m.get("http_code"):
        observation["coverageError"] = "no_production_response"
        return []
    if path in AUTH_GUARDS:
        if m.get("exitcode", 0):
            observation["coverageError"] = "incomplete_response"
            return []
        issues = []
        if m["http_code"] != 401:
            issues.append("signed_out_guard_failed")
        if "json" not in (m.get("content_type") or "").lower():
            issues.append("wrong_content_type")
        cache = (headers[-1]["headers"].get("cache-control", "") if headers else "")
        directives = {part.strip().lower() for part in cache.split(",")}
        if not {"private", "no-store"} <= directives:
            issues.append("private_api_cache_policy_missing")
        try:
            data = json.loads(body, parse_constant=reject_nonfinite)
            if not isinstance(data, dict) or not isinstance(data.get("error"), str):
                issues.append("malformed_response_contract")
        except (ValueError, TypeError):
            issues.append("malformed_response_contract")
        destination = urlsplit(m.get("url_effective", ""))
        if destination.path != path or destination.netloc != urlsplit(BASE).netloc or destination.scheme != "https":
            issues.append("unexpected_auth_redirect")
        return sorted(set(issues))
    if observation["phase"] == "asset" and observation["method"] == "HEAD" and m["http_code"] in (405, 501):
        return []  # Availability will be checked with a bounded GET.
    if m["http_code"] not in ([200, 206] if observation["phase"] == "asset" else [200]):
        return ["http_error"]
    if m.get("exitcode", 0):
        observation["coverageError"] = "incomplete_response"
        return []
    if path == CONTROL:
        return []
    issues = []

    def age(value):
        seconds = (timestamp(observation["requestUtc"]) - timestamp(value)).total_seconds()
        observation["dataAgeSeconds"] = round(seconds, 3)
        if not -60 <= seconds <= 180:
            issues.append("stale_or_future_data")

    try:
        if path in APIS:
            if "json" not in (m.get("content_type") or "").lower():
                issues.append("wrong_content_type")
            data = json.loads(body, parse_constant=reject_nonfinite)
            if not isinstance(data, dict):
                raise ValueError("Expected an object")
            if path == HEALTH:
                if data.get("status") != "ok" or data.get("checks", {}).get("database") != "ok":
                    issues.append("unhealthy_database")
                age(data["timestamp"])
                duration = data.get("responseTimeMs")
                observation["databaseProbeMs"] = duration if finite(duration) else None
                if not finite(duration):
                    issues.append("invalid_database_duration")
                elif duration >= DATABASE_SLOW_MS:
                    issues.append("slow_database_probe")
            elif path == LISTINGS:
                if not isinstance(data.get("listings"), list):
                    issues.append("missing_listings_array")
                else:
                    observation["listingsCount"] = len(data["listings"])
            else:
                market = data["market"]
                if not finite(data.get("rate"), positive=True):
                    issues.append("invalid_market_rate")
                if market.get("status") != "live" or market.get("stale") is not False or market.get("unavailablePairs") != []:
                    issues.append("market_degraded")
                age(market["updatedAt"])
                for pair in ("btcUsdt", "ethUsdt", "usdtIls"):
                    if not finite(market["pairs"][pair]["price"], positive=True):
                        issues.append("invalid_market_price")
        elif observation["phase"] == "asset":
            if "javascript" not in (m.get("content_type") or "").lower():
                issues.append("invalid_javascript_content_type")
        else:
            page = Page(body)
            locale = "ar" if path.startswith("/ar") else "en"
            observation["page"] = {"lang": page.attributes.get("lang"),
                                   "dir": page.attributes.get("dir"), "title": page.title}
            if page.attributes.get("lang") != locale or page.attributes.get("dir") != ("rtl" if locale == "ar" else "ltr"):
                issues.append("incorrect_locale")
            if "Alpha Traders" not in page.title:
                issues.append("invalid_page_title")
            if any(text in body for text in ("Application error: a server-side exception",
                                            "Application error: a client-side exception", "Internal Server Error")):
                issues.append("fatal_html")
            destination = urlsplit(m.get("url_effective", ""))
            if destination.netloc != urlsplit(BASE).netloc:
                issues.append("unexpected_redirect_origin")
            if path.endswith("/usdt-exchange"):
                if destination.path == f"/{locale}/login":
                    if parse_qs(destination.query).get("redirectTo") != [path]:
                        issues.append("exchange_return_path_lost")
                elif destination.path != path:
                    issues.append("unexpected_exchange_redirect")
            if path.endswith("/journal"):
                if destination.path != f"/{locale}/login":
                    issues.append("journal_sign_in_redirect_missing")
                elif parse_qs(destination.query).get("redirectTo") != [path]:
                    issues.append("journal_return_path_lost")
            if path in PAGES[:5]:
                observation["assets"] = sorted(page.scripts)
                if not page.scripts:
                    issues.append("missing_script_references")
    except (ValueError, KeyError, TypeError, AttributeError, OverflowError):
        issues.append("malformed_response_contract")
    return sorted(set(issues))


def atomic_json(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    with temporary.open("w") as stream:
        json.dump(value, stream, indent=2, allow_nan=False)
        stream.flush()
        os.fsync(stream.fileno())
    temporary.replace(path)


class Monitor:
    def __init__(self, output, previous=None, max_observation_gap_seconds=None):
        self.output = Path(output)
        self.previous = previous or {}
        self.deadline = time.monotonic() + 220
        self.stopped = False
        self.report = {"schemaVersion": 1, "startedUtc": utcnow().isoformat(),
                       "complete": False, "observations": [], "runnerErrors": []}
        if max_observation_gap_seconds is not None:
            if not finite(max_observation_gap_seconds, positive=True):
                raise ValueError("Observation gap limit must be a positive finite number")
            self.report["maxObservationGapSeconds"] = max_observation_gap_seconds
        atomic_json(self.output, self.report)

    def record(self, observation):
        self.report["observations"].append(observation)
        atomic_json(self.output, self.report)

    def batch(self, paths, phase, method="GET"):
        """One curl process retains its connection cache across --next transfers."""
        if self.stopped or not paths:
            return []
        results = []
        with tempfile.TemporaryDirectory(prefix="alpha-health-") as directory:
            root, args = Path(directory), ["curl", "--silent", "--show-error"]
            for i, path in enumerate(paths):
                if i:
                    args.append("--next")
                args += ["--silent", "--show-error", "--no-buffer", "--location", "--max-redirs", "5",
                         "--proto", "=https", "--proto-redir", "=https", "--max-time", "30",
                         "--max-filesize", "4194304", "--dump-header", str(root / f"{i}.headers"),
                         "--output", str(root / f"{i}.body"), "--write-out", "%{json}\n"]
                if method == "HEAD":
                    args.append("--head")
                elif phase == "asset":
                    args += ["--range", "0-1023"]
                args.append(path if path.startswith("https://") else BASE + path)
            with (root / "stderr").open("w+") as errors:
                process = subprocess.Popen(args, stdout=subprocess.PIPE, stderr=errors, text=True)
                try:
                    for i, line in enumerate(process.stdout):
                        completed = utcnow()
                        raw = json.loads(line)
                        metrics = {name: raw.get(name) for name in METRICS if name in raw}
                        total = metrics.get("time_total", 0)
                        started = completed - dt.timedelta(seconds=total)
                        headers = header_blocks((root / f"{i}.headers").read_text())
                        body_file = root / f"{i}.body"
                        body = body_file.read_text(errors="replace") if body_file.exists() else ""
                        reused = (False if metrics.get("num_connects", 0) > 0 else
                                  True if metrics.get("http_code", 0) > 0 and metrics.get("http_connect", 0) in (0, 200) else None)
                        observation = {"path": paths[i], "phase": phase, "method": method,
                                       "requestUtc": started.isoformat(), "requestUtcEstimated": True,
                                       "completedUtc": completed.isoformat(), "metrics": metrics,
                                       "headers": headers, "connectionReused": reused,
                                       "error": raw.get("errormsg"), "coverageError": None}
                        # These include network/proxy transit after setup, not just application execution.
                        observation["responseAfterSetupSeconds"] = max(0, total - metrics.get("time_pretransfer", 0))
                        observation["issues"] = validate(observation, body)
                        self.record(observation)
                        results.append(observation)
                        if observation["coverageError"] == "proxy_connection_rejected" or time.monotonic() > self.deadline:
                            self.stopped = True
                            break
                finally:
                    if process.poll() is None:
                        process.terminate()
                    process.wait(timeout=5)
                if len(results) != len(paths) and not self.stopped:
                    self.report["runnerErrors"].append("curl_batch_incomplete")
        return results

    def run(self):
        try:
            # Establish public access before expanding scope.
            self.batch([HEALTH], "fresh")
            self.batch([LISTINGS], "fresh")
            # Every URL causes a new response; only the underlying connection is reusable.
            # Warm the connection with the homepage so both health samples can reuse it.
            self.batch([PAGES[0]] + APIS + APIS + PAGES[1:] + AUTH_GUARDS, "keepalive")
            observations = self.report["observations"]
            # Confirm a newly failing/slow observation with up to two more requests,
            # even when earlier connection-comparison samples were healthy.
            for path in APIS + PAGES + AUTH_GUARDS:
                samples = [o for o in observations if o["path"] == path]
                for _ in range(2):
                    if not samples or not (samples[-1]["issues"] or samples[-1]["coverageError"]
                                           or samples[-1]["responseAfterSetupSeconds"] >= APPLICATION_SLOW):
                        break
                    samples += self.batch([path], "retry")
            assets = sorted({url for o in observations for url in o.get("assets", [])})
            if len(assets) > 100:
                self.report["runnerErrors"].append("asset_count_exceeds_bounded_check")
            for result in self.batch(assets[:100], "asset", "HEAD"):
                if result["metrics"].get("http_code") in (405, 501):
                    self.batch([result["path"]], "asset")
            for path in assets[:100]:
                samples = [o for o in observations if o["path"] == path]
                for _ in range(max(0, 3 - len(samples))):
                    if not samples or not (samples[-1]["issues"] or samples[-1]["coverageError"]):
                        break
                    samples += self.batch([path], "asset", samples[-1]["method"])
            fresh = [o for o in observations if o["phase"] == "fresh"]
            if any(o["metrics"].get("time_total", 0) >= SETUP_SLOW or o["coverageError"] for o in fresh):
                self.batch([CONTROL], "control")
        except (OSError, ValueError, subprocess.SubprocessError) as error:
            self.report["runnerErrors"].append(type(error).__name__)
        self.report["finishedUtc"] = utcnow().isoformat()
        self.report["complete"] = not self.stopped and not self.report["runnerErrors"]
        self.report.update(assess(self.report, self.previous))
        atomic_json(self.output, self.report)
        return self.report


def assess(report, previous=None):
    observations = report["observations"]
    incidents, gaps = {}, []

    def incident(kind, component, code):
        key = f"{kind}:{component}:{code}"
        incidents[key] = {"kind": kind, "component": component, "code": code}

    expected = APIS + PAGES + AUTH_GUARDS + sorted({url for o in observations for url in o.get("assets", [])})
    for path in expected:
        samples = [o for o in observations if o["path"] == path]
        reached = [o for o in samples if not o["coverageError"]]
        if not samples or samples[-1]["coverageError"]:
            gaps.append(path)
        if reached and reached[-1]["issues"]:
            for issue in reached[-1]["issues"]:
                if sum(issue in o["issues"] for o in reached[-3:]) >= 2:
                    incident("component", path, issue)
                else:
                    incident("unconfirmed", path, issue)
        reused = [o for o in samples if o["connectionReused"] and not o["coverageError"]]
        if path in APIS:
            if not reused:
                gaps.append(f"keepalive:{path}")
            elif len(reused) >= 2 and all(o["responseAfterSetupSeconds"] >= APPLICATION_SLOW for o in reused[-2:]):
                incident("component", path, "repeated_response_latency")
    fresh = [o for o in observations if o["phase"] == "fresh"]
    slow_setup = [o for o in fresh if o["metrics"].get("time_appconnect", 0) >= SETUP_SLOW]
    controls = [o for o in observations if o["phase"] == "control"]
    if slow_setup:
        if controls and not controls[-1]["issues"] and not controls[-1]["coverageError"]:
            code = "shared_connection_startup_delay" if controls[-1]["metrics"].get("time_appconnect", 0) >= SETUP_SLOW else "site_connection_startup_delay"
            if len(slow_setup) >= 2 or code == "shared_connection_startup_delay":
                incident("monitoring" if code.startswith("shared") else "connection", "network", code)
        else:
            incident("monitoring", "network", "connection_comparison_inconclusive")
    if gaps or report.get("runnerErrors") or not report.get("complete"):
        incident("monitoring", "coverage", "production_partially_unverified")
    if report.get("maxObservationGapSeconds") is not None:
        # A fresh successful probe cannot erase time during which no observation
        # ran. This detects gaps once the runner resumes; it is not a substitute
        # for an independent dead-man monitor watching a stopped scheduler.
        try:
            previous_finished = timestamp((previous or {})["finishedUtc"])
            gap_seconds = (timestamp(report["startedUtc"]) - previous_finished).total_seconds()
            report["observationGapSeconds"] = round(gap_seconds, 3)
            if gap_seconds < -60:
                raise ValueError("Previous observation is in the future")
            if gap_seconds > report["maxObservationGapSeconds"]:
                incident("monitoring", "scheduler", "observation_gap_exceeded")
        except (KeyError, ValueError, TypeError, AttributeError):
            incident("monitoring", "scheduler", "previous_observation_unavailable")
    previous_incidents = (previous or {}).get("activeIncidents", {})
    # A lost connection must never resolve an earlier confirmed production incident.
    if gaps or not report.get("complete"):
        for key, value in previous_incidents.items():
            incidents.setdefault(key, value)
    new = sorted(set(incidents) - set(previous_incidents))
    resolved = sorted(set(previous_incidents) - set(incidents))
    return {"coverageGaps": sorted(set(gaps)), "activeIncidents": incidents,
            "notification": {"required": bool(new or resolved), "new": new, "resolved": resolved},
            "status": "component_degraded" if any(i["kind"] == "component" for i in incidents.values())
                      else "verification_limited" if incidents else "healthy"}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", required=True)
    parser.add_argument("--previous")
    parser.add_argument("--max-observation-gap-seconds", type=float)
    arguments = parser.parse_args()
    previous = json.loads(Path(arguments.previous).read_text()) if arguments.previous else None
    report = Monitor(arguments.output, previous, arguments.max_observation_gap_seconds).run()
    print(json.dumps({key: report[key] for key in ("status", "coverageGaps", "activeIncidents", "notification")}))
    return 0 if report["status"] == "healthy" else 1 if report["status"] == "component_degraded" else 2


if __name__ == "__main__":
    raise SystemExit(main())
