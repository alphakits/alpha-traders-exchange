"""Offline failure-injection tests; never call the production website."""

import copy
import datetime as dt
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from production_health import (APIS, BASE, CONTROL, HEALTH, LISTINGS, MARKET,
                               PAGES, Monitor, Page, assess, validate)

NOW = dt.datetime(2026, 10, 7, 17, 0, tzinfo=dt.timezone.utc)


def sample(path=HEALTH, **overrides):
    result = {"path": path, "phase": "keepalive", "method": "GET",
              "requestUtc": NOW.isoformat(), "headers": [], "coverageError": None,
              "issues": [], "connectionReused": True, "responseAfterSetupSeconds": 0.3,
              "metrics": {"http_code": 200, "http_connect": 200, "exitcode": 0,
                          "content_type": "application/json", "time_total": 0.3,
                          "time_appconnect": 0, "url_effective": BASE + path}}
    result.update(overrides)
    return result


def health(**overrides):
    value = {"status": "ok", "checks": {"database": "ok"},
             "responseTimeMs": 4, "timestamp": NOW.isoformat()}
    value.update(overrides)
    return json.dumps(value)


def healthy_report():
    return {"complete": True, "runnerErrors": [],
            "observations": [sample(p) for p in APIS + PAGES + APIS]}


class ContractTests(unittest.TestCase):
    def test_health_timestamp_boundaries_and_skew(self):
        for offset, stale in [(-181, True), (-180, False), (60, False), (61, True)]:
            with self.subTest(offset=offset):
                errors = validate(sample(), health(timestamp=(NOW + dt.timedelta(seconds=offset)).isoformat()))
                self.assertEqual("stale_or_future_data" in errors, stale)

    def test_invalid_timestamps_and_json_do_not_pass(self):
        for body in ["not JSON", "[]", health(timestamp="2026-10-07T17:00:00"),
                     health(responseTimeMs=float("nan")), health(timestamp="not a date")]:
            self.assertIn("malformed_response_contract", validate(sample(), body))

    def test_database_duration_is_distinct_from_request_duration(self):
        observation = sample()
        observation["metrics"]["time_total"] = 12
        self.assertEqual(validate(observation, health()), [])
        self.assertEqual(observation["databaseProbeMs"], 4)
        self.assertIn("slow_database_probe", validate(sample(), health(responseTimeMs=1000)))

    def test_overflowing_json_number_does_not_break_evidence_serialization(self):
        observation = sample()
        body = health().replace('"responseTimeMs": 4', '"responseTimeMs": 1e999')
        self.assertIn("invalid_database_duration", validate(observation, body))
        json.dumps(observation, allow_nan=False)

    def test_health_requires_both_ok_fields(self):
        self.assertIn("unhealthy_database", validate(sample(), health(status="degraded")))
        self.assertIn("unhealthy_database", validate(sample(), health(checks={"database": "error"})))

    def test_actual_http_403_is_a_component_error(self):
        observation = sample()
        observation["metrics"]["http_code"] = 403
        self.assertEqual(validate(observation, "Forbidden"), ["http_error"])
        self.assertIsNone(observation["coverageError"])

    def test_proxy_403_is_not_a_website_403(self):
        observation = sample(headers=[{"status": 403, "headers": {"x-proxy-error": "blocked-by-allowlist"}}])
        observation["metrics"].update(http_code=0, http_connect=403, exitcode=56)
        self.assertEqual(validate(observation, ""), [])
        self.assertEqual(observation["coverageError"], "proxy_connection_rejected")

    def test_dns_tls_timeout_before_response_is_unverified(self):
        for error in (6, 28, 60):
            observation = sample()
            observation["metrics"].update(http_code=0, http_connect=0, exitcode=error)
            self.assertEqual(validate(observation, ""), [])
            self.assertEqual(observation["coverageError"], "no_production_response")

    def test_listings_requires_an_array(self):
        self.assertEqual(validate(sample(LISTINGS), '{"listings":[]}'), [])
        self.assertIn("missing_listings_array", validate(sample(LISTINGS), '{"listings":{}}'))

    def test_market_contract_including_every_pair(self):
        market = {"rate": 3.1, "market": {"status": "live", "stale": False,
                  "unavailablePairs": [], "updatedAt": NOW.isoformat(),
                  "pairs": {p: {"price": 3} for p in ("btcUsdt", "ethUsdt", "usdtIls")}}}
        self.assertEqual(validate(sample(MARKET), json.dumps(market)), [])
        for key, value in [("status", "degraded"), ("stale", True), ("unavailablePairs", ["btcUsdt"])]:
            broken = copy.deepcopy(market)
            broken["market"][key] = value
            self.assertIn("market_degraded", validate(sample(MARKET), json.dumps(broken)))
        for pair in market["market"]["pairs"]:
            for price in (0, -1, True, "3", float("inf")):
                broken = copy.deepcopy(market)
                broken["market"]["pairs"][pair]["price"] = price
                self.assertTrue(validate(sample(MARKET), json.dumps(broken)))

    def test_locales_and_exchange_return_paths(self):
        for locale, direction in [("ar", "rtl"), ("en", "ltr")]:
            path = f"/{locale}/usdt-exchange"
            observation = sample(path)
            observation["metrics"]["url_effective"] = BASE + f"/{locale}/login?redirectTo=%2F{locale}%2Fusdt-exchange"
            body = f'<html lang="{locale}" dir="{direction}"><title>Alpha Traders</title></html>'
            self.assertEqual(validate(observation, body), [])
            observation["metrics"]["url_effective"] = BASE + f"/{locale}/login"
            self.assertIn("exchange_return_path_lost", validate(observation, body))

    def test_fatal_html_and_missing_assets_fail(self):
        errors = validate(sample("/en"), '<html lang="ar" dir="rtl"><title>Error</title>Internal Server Error</html>')
        self.assertTrue({"incorrect_locale", "invalid_page_title", "fatal_html", "missing_script_references"} <= set(errors))

    def test_assets_are_observed_deduplicated_and_query_preserved(self):
        body = '<script src="/_next/static/a.js?dpl=x&amp;v=1"></script>' * 2
        body += '<script src="https://other.test/_next/static/a.js"></script><script src="/course/video.js"></script>'
        self.assertEqual(Page(body).scripts, {BASE + "/_next/static/a.js?dpl=x&v=1"})


class IncidentTests(unittest.TestCase):
    def test_healthy_run_without_changes_is_silent(self):
        result = assess(healthy_report())
        self.assertEqual(result["status"], "healthy")
        self.assertFalse(result["notification"]["required"])

    def test_repeated_market_failure_is_component_degradation(self):
        report = healthy_report()
        for observation in report["observations"]:
            if observation["path"] == MARKET:
                observation["issues"] = ["market_degraded"]
        result = assess(report)
        self.assertEqual(result["status"], "component_degraded")
        self.assertEqual(len(result["activeIncidents"]), 1)
        self.assertFalse(assess(report, result)["notification"]["required"])
        self.assertTrue(assess(healthy_report(), result)["notification"]["resolved"])

    def test_healthy_retry_does_not_hide_repeated_application_latency(self):
        report = healthy_report()
        for observation in report["observations"]:
            if observation["path"] == HEALTH:
                observation["responseAfterSetupSeconds"] = 3
        result = assess(report)
        self.assertEqual(result["status"], "component_degraded")
        self.assertTrue(any(i["code"] == "repeated_response_latency" for i in result["activeIncidents"].values()))

    def test_bad_response_followed_by_healthy_fast_response_recovers(self):
        report = healthy_report()
        report["observations"][0]["issues"] = ["http_error"]
        self.assertEqual(assess(report)["status"], "healthy")

    def test_incomplete_run_cannot_resolve_old_incident(self):
        previous = {"activeIncidents": {"component:market:stale": {"kind": "component", "component": MARKET, "code": "stale"}}}
        result = assess({"complete": False, "observations": [], "runnerErrors": []}, previous)
        self.assertIn("component:market:stale", result["activeIncidents"])
        self.assertEqual(result["notification"]["resolved"], [])

    def test_shared_setup_delay_does_not_become_production_outage(self):
        report = healthy_report()
        for path in [HEALTH, LISTINGS, CONTROL]:
            observation = sample(path, phase="control" if path == CONTROL else "fresh", connectionReused=False)
            observation["metrics"].update(time_total=8.3, time_appconnect=8)
            report["observations"].append(observation)
        result = assess(report)
        self.assertEqual(result["status"], "verification_limited")
        self.assertEqual([i["code"] for i in result["activeIncidents"].values()], ["shared_connection_startup_delay"])

    def test_healthy_control_exposes_repeated_site_setup_delay(self):
        report = healthy_report()
        for path in (HEALTH, LISTINGS):
            observation = sample(path, phase="fresh", connectionReused=False)
            observation["metrics"].update(time_appconnect=8)
            report["observations"].append(observation)
        report["observations"].append(sample(CONTROL, phase="control"))
        result = assess(report)
        self.assertTrue(any(i["code"] == "site_connection_startup_delay" for i in result["activeIncidents"].values()))

    def test_no_connection_reuse_is_an_explicit_gap(self):
        report = healthy_report()
        for observation in report["observations"]:
            observation["connectionReused"] = False
        self.assertIn(f"keepalive:{HEALTH}", assess(report)["coverageGaps"])

    def test_observations_survive_before_final_assessment(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "report.json"
            monitor = Monitor(path)
            monitor.record(sample())
            saved = json.loads(path.read_text())
            self.assertFalse(saved["complete"])
            self.assertEqual(len(saved["observations"]), 1)

    def test_policy_denial_stops_expansion_and_checkpoints(self):
        with tempfile.TemporaryDirectory() as folder:
            output = Path(folder) / "report.json"
            class FakeCurl:
                def __init__(self, args, **kwargs):
                    Path(args[args.index("--dump-header") + 1]).write_text(
                        "HTTP/1.1 403 Forbidden\nx-proxy-error: blocked-by-allowlist\n")
                    self.stdout = io.StringIO(json.dumps({"http_code": 0, "http_connect": 403,
                                                        "exitcode": 56, "time_total": .1}) + "\n")
                def poll(self):
                    return 0
                def wait(self, **kwargs):
                    return 0
            with patch("production_health.subprocess.Popen", FakeCurl):
                result = Monitor(output).run()
            self.assertEqual(len(result["observations"]), 1)
            self.assertFalse(result["complete"])
            self.assertEqual(result["status"], "verification_limited")
            self.assertIsNone(result["observations"][0]["connectionReused"])
            self.assertFalse(any(i["kind"] == "component" for i in result["activeIncidents"].values()))

    def test_new_failure_gets_retries_after_earlier_healthy_samples(self):
        with tempfile.TemporaryDirectory() as folder:
            class SyntheticMonitor(Monitor):
                def batch(self, paths, phase, method="GET"):
                    results = []
                    for path in paths:
                        observation = sample(path, phase=phase, method=method)
                        seen = sum(o["path"] == HEALTH for o in self.report["observations"])
                        # Health succeeds during setup, then fails twice and recovers.
                        if path == HEALTH and seen in (2, 3):
                            observation["issues"] = ["http_error"]
                        self.record(observation)
                        results.append(observation)
                    return results
            result = SyntheticMonitor(Path(folder) / "report.json").run()
            health_samples = [o for o in result["observations"] if o["path"] == HEALTH]
            self.assertEqual(len(health_samples), 5)
            self.assertEqual(result["status"], "healthy")


if __name__ == "__main__":
    unittest.main()
