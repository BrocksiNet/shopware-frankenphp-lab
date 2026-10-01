"""Regression checks for report failures, origin checks and session boundaries."""

import json
import os
import subprocess
import sys
import tempfile
import unittest
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread

from verify import CheckError, Page, Session


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def session(self):
        cookie = SimpleCookie(self.headers.get("Cookie", ""))
        key = (
            cookie["session"].value
            if "session" in cookie
            else f"test-cookie-{len(self.server.sessions)}"
        )
        return key, self.server.sessions.setdefault(
            key, {"cart": False, "login": False}
        )

    def do_POST(self):
        self.rfile.read(int(self.headers.get("Content-Length", "0")))
        key, state = self.session()
        location = "/checkout/cart"
        if self.path == "/checkout/line-item/add":
            state["cart"] = True
        elif self.path == "/checkout/line-item/delete/product":
            state["cart"] = False
        elif self.path == "/account/login":
            state["login"] = True
            location = "/account"
        self.send_response(302)
        self.send_header("Set-Cookie", f"session={key}; Path=/")
        self.send_header("Location", location)
        self.end_headers()

    def do_GET(self):
        if self.path == "/unavailable":
            self.send_response(503)
            self.end_headers()
            return
        if self.path == "/redirect":
            self.send_response(302)
            self.send_header("Location", "https://other.example/account")
            self.end_headers()
            return
        key, state = self.session()
        if self.path == "/account/logout":
            state["login"] = False
        effective = (
            {
                field: any(item[field] for item in self.server.sessions.values())
                for field in ("cart", "login")
            }
            if self.server.leak
            else state
        )
        self.send_response(200)
        self.send_header("Set-Cookie", f"session={key}; Path=/")
        self.end_headers()
        route = "frontend-home-page"
        if self.path.startswith("/search"):
            route = "frontend-search-page"
        elif self.path == "/account/login":
            route = "frontend-account-login-page"
        elif self.path == "/account":
            route = (
                "frontend-account-home-page"
                if effective["login"]
                else "frontend-account-login-page"
            )
        elif self.path == "/checkout/cart":
            route = "frontend-checkout-cart-page"
        asset = "https://stale.example/app.js" if self.server.stale else "/app.js"
        content = (
            '<form action="/checkout/line-item/add"><input name="lineItems[product][id]" value="product"></form>'
            if self.path == "/"
            else ""
        )
        if self.path == "/account/login":
            content = '<form action="/account/login"><input name="username"><input name="password"></form>'
        if self.path == "/checkout/cart" and effective["cart"]:
            content = '<form action="/checkout/line-item/delete/product"><button class="line-item-remove-button" data-product-id="product"></button></form>'
        body = f'<body class="is-active-route-{route}"><script src="{asset}"></script>{content}</body>'
        self.wfile.write(body.encode())


class VerifyTest(unittest.TestCase):
    def setUp(self):
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.server.stale = False
        self.server.leak = False
        self.server.sessions = {}
        self.thread = Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.base = f"http://127.0.0.1:{self.server.server_port}"
        self.tmp = tempfile.TemporaryDirectory()

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()
        self.tmp.cleanup()

    def test_asset_origin_and_explicit_cdn(self):
        page = Page(
            '<script src="//cdn.example/app.js"></script><link rel="stylesheet" href="/app.css">'
        )
        self.assertEqual(
            ["cdn.example"], page.unexpected_asset_origins("https://shop.example", [])
        )
        self.assertEqual(
            [],
            page.unexpected_asset_origins(
                "https://shop.example", ["https://cdn.example"]
            ),
        )
        page = Page('<script src="https://shop.example:443/app.js"></script>')
        self.assertEqual([], page.unexpected_asset_origins("https://shop.example", []))

    def test_cart_detection_ignores_recommendations(self):
        page = Page(
            '<a data-product-id="recommendation">Product</a><button class="line-item-remove-button" data-product-id="actual-item"></button>'
        )
        self.assertEqual({"actual-item"}, page.cart_ids)

    def test_http_200_without_storefront_content_is_not_a_pass(self):
        self.assertFalse(
            Page("<body>Application error</body>").has_route("frontend-home-page")
        )

    def test_cookies_are_isolated_between_sessions(self):
        a = Session(self.base, self.tmp.name, "a", 2)
        b = Session(self.base, self.tmp.name, "b", 2)
        a.request("/")
        self.assertIn("test-cookie", a.cookie_file.read_text())
        self.assertFalse(b.cookie_file.exists())

    def test_failed_transport_status_and_cross_origin_are_rejected(self):
        session = Session(self.base, self.tmp.name, "a", 2)
        for path in ("/unavailable", "/redirect", "https://other.example/login"):
            with self.subTest(path=path), self.assertRaises(CheckError):
                session.request(path)

    def run_cli(self, name, extra=()):
        output = Path(self.tmp.name) / name
        command = [
            sys.executable,
            str(Path(__file__).with_name("verify.py")),
            self.base,
            "--output",
            str(output),
        ]
        command.extend(extra)
        result = subprocess.run(
            command,
            capture_output=True,
            text=True,
            check=False,
            env={**os.environ, "SHOPWARE_VERIFY_TEST_PASSWORD": "fixture-password"},
        )
        return result, json.loads(output.read_text()), command

    def test_cli_success_reports_skips_and_does_not_overwrite(self):
        result, report, command = self.run_cli("pass.json")
        self.assertEqual(0, result.returncode, result.stderr)
        self.assertEqual({"pass": 6, "fail": 0, "skip": 2}, report["summary"])
        self.assertNotIn("test-cookie", json.dumps(report))
        second = subprocess.run(command, capture_output=True, text=True, check=False)
        self.assertEqual(2, second.returncode)

    def test_cli_stale_assets_exit_nonzero_and_write_failures(self):
        self.server.stale = True
        result, report, _ = self.run_cli("fail.json")
        self.assertEqual(1, result.returncode)
        self.assertEqual(3, report["summary"]["fail"])
        self.assertIn("stale.example", json.dumps(report))

    def test_cart_and_account_checks_detect_shared_session_state(self):
        options = [
            "--cart",
            "--login-email",
            "test@example.com",
            "--password-env",
            "SHOPWARE_VERIFY_TEST_PASSWORD",
            "--rounds",
            "2",
        ]
        good, report, _ = self.run_cli("isolated.json", options)
        self.assertEqual(0, good.returncode, good.stdout + good.stderr)
        self.assertEqual(0, report["summary"]["skip"])
        self.server.sessions.clear()
        self.server.leak = True
        bad, report, _ = self.run_cli("leaked.json", options)
        self.assertEqual(1, bad.returncode)
        failures = [
            check["name"]
            for check in report["targets"][0]["checks"]
            if check["status"] == "fail"
        ]
        self.assertIn("cart isolation round 1 session B", failures)
        self.assertIn("account isolation round 1 session B: content", failures)
        self.assertNotIn("fixture-password", json.dumps(report))


if __name__ == "__main__":
    unittest.main()
