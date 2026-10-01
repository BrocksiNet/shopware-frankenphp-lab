#!/usr/bin/env python3
"""Bounded Shopware storefront smoke checks using Python 3 and curl."""

import argparse
import json
import os
import subprocess
import tempfile
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urlencode, urljoin, urlsplit


class CheckError(Exception):
    """A request or required storefront element could not be verified."""


def origin(url):
    parsed = urlsplit(url)
    if parsed.scheme not in ("http", "https") or not parsed.hostname:
        raise ValueError("Expected an absolute HTTP(S) URL")
    if parsed.username or parsed.password:
        raise ValueError("URL credentials are not supported")
    return (
        parsed.scheme,
        parsed.hostname.lower(),
        parsed.port or (443 if parsed.scheme == "https" else 80),
    )


class Page(HTMLParser):
    def __init__(self, html):
        super().__init__()
        self.body_classes = set()
        self.forms = []
        self.form = None
        self.assets = []
        self.cart_ids = set()
        self.feed(html)

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == "body":
            self.body_classes = set(attrs.get("class", "").split())
        if tag == "form":
            self.form = {"action": attrs.get("action", ""), "fields": {}}
            self.forms.append(self.form)
        if (
            tag == "input"
            and self.form is not None
            and attrs.get("name")
            and (attrs.get("type") not in ("checkbox", "radio") or "checked" in attrs)
        ):
            self.form["fields"][attrs["name"]] = attrs.get("value", "")
        if tag == "script" and attrs.get("src"):
            self.assets.append(attrs["src"])
        if (
            tag == "link"
            and "stylesheet" in attrs.get("rel", "").split()
            and attrs.get("href")
        ):
            self.assets.append(attrs["href"])
        if "line-item-remove-button" in attrs.get("class", "").split() and attrs.get(
            "data-product-id"
        ):
            self.cart_ids.add(attrs["data-product-id"])

    def handle_endtag(self, tag):
        if tag == "form":
            self.form = None

    def has_route(self, route):
        return "is-active-route-" + route in self.body_classes

    def find_form(self, path, required_field=None):
        for form in self.forms:
            if urlsplit(form["action"]).path.endswith(path) and (
                required_field is None or required_field in form["fields"]
            ):
                return form
        raise CheckError("Required storefront form missing")

    def unexpected_asset_origins(self, url, allowed):
        expected = {origin(url), *(origin(item) for item in allowed)}
        return sorted(
            {
                urlsplit(urljoin(url, asset)).netloc
                for asset in self.assets
                if origin(urljoin(url, asset)) not in expected
            }
        )


class Session:
    def __init__(self, base, directory, name, timeout):
        self.base = base
        self.cookie_file = Path(directory) / (name + ".cookies")
        self.directory = directory
        self.timeout = timeout

    def request(self, path, data=None):
        url = urljoin(self.base + "/", path)
        for _ in range(6):
            if origin(url) != origin(self.base):
                raise CheckError("Cross-origin form action or redirect refused")
            with tempfile.TemporaryDirectory(dir=self.directory) as tmp:
                body = Path(tmp) / "body"
                headers = Path(tmp) / "headers"
                command = [
                    "curl",
                    "--silent",
                    "--show-error",
                    "--max-time",
                    str(self.timeout),
                    "--http1.1",
                    "--cookie",
                    str(self.cookie_file),
                    "--cookie-jar",
                    str(self.cookie_file),
                    "--output",
                    str(body),
                    "--dump-header",
                    str(headers),
                    "--write-out",
                    "%{http_code}",
                ]
                # Credentials travel on stdin, not process arguments or reports.
                if data is not None:
                    command += ["--data-binary", "@-"]
                try:
                    result = subprocess.run(
                        command + [url],
                        input=urlencode(data) if data is not None else None,
                        capture_output=True,
                        text=True,
                        timeout=self.timeout + 5,
                        check=False,
                    )
                except (OSError, subprocess.TimeoutExpired) as error:
                    raise CheckError("curl unavailable or request timed out") from error
                if result.returncode:
                    raise CheckError(
                        f"HTTP transport failed (curl exit {result.returncode})"
                    )
                status = int(result.stdout)
                fields = {}
                for line in headers.read_text().splitlines():
                    if ":" in line:
                        key, value = line.split(":", 1)
                        fields[key.lower()] = value.strip()
                if status in (301, 302, 303, 307, 308) and "location" in fields:
                    url = urljoin(url, fields["location"])
                    if status in (301, 302, 303):
                        data = None
                    continue
                if status != 200:
                    raise CheckError(f"Expected HTTP 200, received {status}")
                return Page(body.read_text(errors="replace")), fields, url
        raise CheckError("Too many redirects")


def verify_target(base, args, directory):
    result = {"base_url": base, "checks": []}
    sessions = [
        Session(base, directory, "a", args.timeout),
        Session(base, directory, "b", args.timeout),
    ]

    def record(name, passed, detail=None):
        check = {"name": name, "status": "pass" if passed else "fail"}
        if detail:
            check["detail"] = detail
        result["checks"].append(check)

    def page_check(session, path, route, label):
        page, headers, url = session.request(path)
        record(label + ": content", page.has_route(route))
        wrong = page.unexpected_asset_origins(url, args.allow_asset_origin)
        record(
            label + ": script/stylesheet origins",
            bool(page.assets) and not wrong,
            "Unexpected origins: " + ", ".join(wrong) if wrong else None,
        )
        if "x-probe-leaked-path" in headers:
            record(label + ": probe state", headers["x-probe-leaked-path"] == "-")
        return page

    for path, route in [
        ("/", "frontend-home-page"),
        ("/account/login", "frontend-account-login-page"),
        ("/search?" + urlencode({"search": args.search_term}), "frontend-search-page"),
    ]:
        try:
            page_check(sessions[0], path, route, path.split("?")[0])
        except (CheckError, ValueError) as error:
            record(path.split("?")[0], False, str(error))

    if args.cart:
        product = None
        try:
            home, _, _ = sessions[0].request("/")
            form = home.find_form("/checkout/line-item/add")
            product = next(
                (
                    value
                    for key, value in form["fields"].items()
                    if key.endswith("[id]")
                ),
                None,
            )
            if not product:
                raise CheckError("No simple add-to-cart product found on homepage")
            sessions[0].request(form["action"], form["fields"])
            for round_number in range(args.rounds):
                # Alternate which session goes first to expose order dependence.
                for index in [0, 1] if round_number % 2 == 0 else [1, 0]:
                    page = page_check(
                        sessions[index],
                        "/checkout/cart",
                        "frontend-checkout-cart-page",
                        "cart round {} session {}".format(
                            round_number + 1, "AB"[index]
                        ),
                    )
                    record(
                        "cart isolation round {} session {}".format(
                            round_number + 1, "AB"[index]
                        ),
                        (product in page.cart_ids) if index == 0 else not page.cart_ids,
                    )
        except (CheckError, ValueError) as error:
            record("cart isolation", False, str(error))
        finally:
            if product:
                try:
                    page, _, _ = sessions[0].request("/checkout/cart")
                    for form in page.forms:
                        if urlsplit(form["action"]).path.endswith(
                            "/checkout/line-item/delete/" + product
                        ):
                            sessions[0].request(form["action"], form["fields"])
                            break
                    page, _, _ = sessions[0].request("/checkout/cart")
                    record("remove test cart item", product not in page.cart_ids)
                except CheckError as error:
                    record("remove test cart item", False, str(error))
    else:
        result["checks"].append(
            {"name": "cart isolation", "status": "skip", "detail": "Enable with --cart"}
        )

    if args.login_email:
        try:
            page, _, _ = sessions[0].request("/account/login")
            form = page.find_form("/account/login", "username")
            data = dict(
                form["fields"],
                username=args.login_email,
                password=os.environ[args.password_env],
            )
            sessions[0].request(form["action"], data)
            for round_number in range(args.rounds):
                for index in [0, 1] if round_number % 2 == 0 else [1, 0]:
                    route = (
                        "frontend-account-home-page"
                        if index == 0
                        else "frontend-account-login-page"
                    )
                    page_check(
                        sessions[index],
                        "/account",
                        route,
                        "account isolation round {} session {}".format(
                            round_number + 1, "AB"[index]
                        ),
                    )
        except (CheckError, ValueError) as error:
            record("account isolation", False, str(error))
        finally:
            try:
                sessions[0].request("/account/logout")
                page, _, _ = sessions[0].request("/account")
                record(
                    "logout returns to login",
                    page.has_route("frontend-account-login-page"),
                )
            except CheckError as error:
                record("logout", False, str(error))
    else:
        result["checks"].append(
            {
                "name": "account isolation",
                "status": "skip",
                "detail": "No login credentials supplied",
            }
        )
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "urls", nargs="+", help="Storefront origins to check, in request order"
    )
    parser.add_argument(
        "--output",
        type=Path,
        required=True,
        help="New JSON report path; existing files are never overwritten",
    )
    parser.add_argument("--rounds", type=int, default=5)
    parser.add_argument("--timeout", type=int, default=20)
    parser.add_argument("--search-term", default="guitar")
    parser.add_argument(
        "--cart",
        action="store_true",
        help="Add/remove a homepage product using temporary guest sessions",
    )
    parser.add_argument(
        "--login-email", help="Existing test customer; no account is created"
    )
    parser.add_argument("--password-env", default="SHOPWARE_VERIFY_PASSWORD")
    parser.add_argument(
        "--allow-asset-origin",
        action="append",
        default=[],
        help="Explicitly allowed CDN origin; repeatable",
    )
    args = parser.parse_args()
    if args.rounds < 1 or args.timeout < 1:
        parser.error("rounds and timeout must be positive")
    if args.login_email and not os.environ.get(args.password_env):
        parser.error("The specified password environment variable is empty")
    try:
        for url in args.urls + args.allow_asset_origin:
            origin(url)
            if (
                urlsplit(url).path not in ("", "/")
                or urlsplit(url).query
                or urlsplit(url).fragment
            ):
                raise ValueError(
                    "Use storefront origins without paths, queries or fragments"
                )
        args.output.parent.mkdir(parents=True, exist_ok=True)
        report_file = args.output.open("x")
    except (ValueError, OSError) as error:
        parser.error(str(error))
    report = {
        "started_at": datetime.now(timezone.utc).isoformat(),
        "scope": "storefront smoke checks",
        "configuration": {
            "rounds": args.rounds,
            "timeout_seconds": args.timeout,
            "cart_enabled": args.cart,
            "login_enabled": bool(args.login_email),
            "search_term": args.search_term,
            "allowed_asset_origins": args.allow_asset_origin,
        },
        "not_tested": [
            "browser JS execution, font loading and CORS",
            "orders/payments/registration",
            "Admin and Store API",
            "worker reset wiring",
            "memory soak and recovery after failures",
        ],
        "targets": [],
    }
    with report_file:
        for base in args.urls:
            with tempfile.TemporaryDirectory(prefix="shopware-verify-") as directory:
                report["targets"].append(
                    verify_target(base.rstrip("/"), args, directory)
                )
        checks = [check for target in report["targets"] for check in target["checks"]]
        report["summary"] = {
            status: sum(check["status"] == status for check in checks)
            for status in ("pass", "fail", "skip")
        }
        report["finished_at"] = datetime.now(timezone.utc).isoformat()
        json.dump(report, report_file, indent=2)
        report_file.write("\n")
    for target in report["targets"]:
        for check in target["checks"]:
            if check["status"] == "fail":
                print(
                    "FAIL", target["base_url"], check["name"], check.get("detail", "")
                )
    print(json.dumps(report["summary"]), "Report:", args.output)
    return 1 if report["summary"]["fail"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
