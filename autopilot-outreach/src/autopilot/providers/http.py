"""Minimal stdlib HTTP client used by the live providers.

Why not `requests`? So live mode stays as zero-install as mock mode. urllib
honors HTTPS_PROXY from the environment automatically; we also pick up a custom
CA bundle (APOP_CA_BUNDLE / SSL_CERT_FILE, or the agent-proxy bundle if present)
so TLS keeps verifying behind corporate/agent proxies — never disable it.

Every live provider takes an injectable client, so tests exercise the real
request-building + response-parsing code against a fake transport.
"""
from __future__ import annotations

import json
import os
import ssl
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path


def _ca_bundle() -> str | None:
    for candidate in (os.environ.get("APOP_CA_BUNDLE"),
                      os.environ.get("SSL_CERT_FILE"),
                      "/root/.ccr/ca-bundle.crt"):
        if candidate and Path(candidate).exists():
            return candidate
    return None


class HttpClient:
    def __init__(self, timeout: float = 25.0) -> None:
        self.timeout = timeout
        self._ctx = ssl.create_default_context(cafile=_ca_bundle())

    def request(self, method: str, url: str, headers: dict | None = None,
                json_body: dict | None = None,
                form_body: dict | None = None) -> tuple[int, str]:
        """Perform a request; return (status_code, body_text). HTTP errors are
        returned (not raised) so providers can surface API error messages."""
        headers = dict(headers or {})
        data: bytes | None = None
        if json_body is not None:
            data = json.dumps(json_body).encode("utf-8")
            headers.setdefault("Content-Type", "application/json")
        elif form_body is not None:
            data = urllib.parse.urlencode(form_body).encode("utf-8")
            headers.setdefault("Content-Type", "application/x-www-form-urlencoded")

        req = urllib.request.Request(url, data=data, headers=headers, method=method)
        try:
            with urllib.request.urlopen(req, timeout=self.timeout,
                                        context=self._ctx) as resp:
                return resp.status, resp.read().decode("utf-8", "replace")
        except urllib.error.HTTPError as e:
            return e.code, e.read().decode("utf-8", "replace")
