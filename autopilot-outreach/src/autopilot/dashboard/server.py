"""Zero-dependency local dashboard (stdlib http.server).

Routes:
  /                  funnel overview: counts, revenue, lead table
  /lead/<id>         full lead detail + audit log + outreach artifacts
  /demo/<id>         serves the generated demo site index.html

Run:  python run.py dashboard   (defaults to http://localhost:8000)
"""
from __future__ import annotations

import html
import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

from ..config import settings
from ..models import Lead, Status
from ..store import LeadStore

_STATUS_COLORS = {
    "NEW": "#888", "QUALIFIED": "#1565c0", "REJECTED": "#b0b0b0",
    "DEMO_BUILT": "#6a1b9a", "CONTACTED": "#ef6c00", "INTERESTED": "#2e7d32",
    "CONVERTED": "#1b5e20", "LIVE": "#004d40", "DEAD": "#c62828",
}

_PAGE = """<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Autopilot Outreach — Dashboard</title>
<style>
 body{{font-family:-apple-system,Segoe UI,Roboto,sans-serif;margin:0;background:#f6f7f9;color:#1a1a1a}}
 .wrap{{max-width:1100px;margin:0 auto;padding:24px}}
 h1{{font-size:1.5rem}} a{{color:#1565c0;text-decoration:none}} a:hover{{text-decoration:underline}}
 .cards{{display:flex;gap:14px;flex-wrap:wrap;margin:18px 0}}
 .kpi{{background:#fff;border:1px solid #eee;border-radius:12px;padding:16px 20px;min-width:130px}}
 .kpi .n{{font-size:1.8rem;font-weight:800}} .kpi .l{{color:#666;font-size:.85rem}}
 table{{width:100%;border-collapse:collapse;background:#fff;border-radius:12px;overflow:hidden}}
 th,td{{text-align:left;padding:10px 12px;border-bottom:1px solid #f0f0f0;font-size:.92rem}}
 th{{background:#fafafa;font-size:.78rem;text-transform:uppercase;color:#888}}
 .pill{{color:#fff;padding:2px 10px;border-radius:20px;font-size:.75rem;font-weight:600}}
 .funnel{{display:flex;gap:6px;margin:10px 0 22px;flex-wrap:wrap}}
 .funnel div{{background:#fff;border:1px solid #eee;border-radius:8px;padding:8px 14px;font-size:.85rem}}
 pre{{background:#1a1a1a;color:#d4d4d4;padding:16px;border-radius:10px;overflow:auto;font-size:.82rem;line-height:1.5}}
 .back{{display:inline-block;margin-bottom:14px}}
 .frame{{width:100%;height:640px;border:1px solid #ddd;border-radius:10px}}
</style></head><body><div class="wrap">{body}</div></body></html>"""


def _pill(status: str) -> str:
    c = _STATUS_COLORS.get(status, "#888")
    return f'<span class="pill" style="background:{c}">{html.escape(status)}</span>'


def _overview(store: LeadStore) -> str:
    leads = store.all()
    counts = store.counts()
    revenue = store.revenue()
    order = ["NEW", "QUALIFIED", "DEMO_BUILT", "CONTACTED", "INTERESTED",
             "CONVERTED", "LIVE", "REJECTED", "DEAD"]

    kpis = (
        f'<div class="kpi"><div class="n">{len(leads)}</div><div class="l">Total leads</div></div>'
        f'<div class="kpi"><div class="n">{counts.get("DEMO_BUILT",0)+counts.get("CONTACTED",0)+counts.get("INTERESTED",0)+counts.get("CONVERTED",0)}</div><div class="l">Demos built</div></div>'
        f'<div class="kpi"><div class="n">{counts.get("INTERESTED",0)}</div><div class="l">Interested</div></div>'
        f'<div class="kpi"><div class="n">{counts.get("CONVERTED",0)}</div><div class="l">Converted</div></div>'
        f'<div class="kpi"><div class="n">${revenue:,}</div><div class="l">Revenue (mock)</div></div>'
    )
    funnel = "".join(
        f"<div>{s}: <b>{counts.get(s,0)}</b></div>" for s in order if counts.get(s)
    )
    rows = []
    for ld in leads:
        demo = (f'<a href="/demo/{ld.id}" target="_blank">view</a>'
                if ld.demo.path else "—")
        rows.append(
            f"<tr><td><a href='/lead/{ld.id}'>{html.escape(ld.id)}</a></td>"
            f"<td>{html.escape(ld.business.name)}</td>"
            f"<td>{html.escape(ld.business.category)}</td>"
            f"<td>{html.escape(ld.business.city)}</td>"
            f"<td>{ld.presence.score} · {html.escape(ld.presence.category)}</td>"
            f"<td>{_pill(ld.status)}</td><td>{demo}</td></tr>"
        )
    body = (
        f"<h1>🛰️ Autopilot Outreach — Dashboard</h1>"
        f'<div class="cards">{kpis}</div>'
        f'<div class="funnel">{funnel or "No leads yet — run <code>python run.py demo</code>"}</div>'
        f"<table><tr><th>ID</th><th>Business</th><th>Vertical</th><th>City</th>"
        f"<th>Presence</th><th>Status</th><th>Demo</th></tr>"
        f"{''.join(rows)}</table>"
    )
    return body


def _lead_detail(store: LeadStore, lead_id: str) -> str:
    ld = store.get(lead_id)
    if not ld:
        return "<a class='back' href='/'>&larr; back</a><p>Lead not found.</p>"
    outreach = ""
    for a in ld.outreach:
        art = ""
        try:
            from pathlib import Path
            txt = Path(a.artifact).read_text(encoding="utf-8")
            art = f"<pre>{html.escape(txt)}</pre>"
        except Exception:
            pass
        outreach += f"<p><b>{a.channel}</b> — {a.disposition} ({a.at}){art}</p>"

    demo_link = (f"<p><a href='/demo/{ld.id}' target='_blank'>▶ Open generated demo site</a></p>"
                 if ld.demo.path else "")
    log = "\n".join(ld.log)
    body = (
        f"<a class='back' href='/'>&larr; back</a>"
        f"<h1>{html.escape(ld.business.name)} {_pill(ld.status)}</h1>"
        f"<p>{html.escape(ld.business.address)}, {html.escape(ld.business.city)}, "
        f"{html.escape(ld.business.state)} · {html.escape(ld.business.phone)}</p>"
        f"<p>Owner: {html.escape(ld.contacts.owner_name)} · "
        f"Rating: {ld.business.rating}★ ({ld.business.review_count})</p>"
        f"<p>Presence: <b>{ld.presence.category}</b> (score {ld.presence.score}) — "
        f"{html.escape(', '.join(ld.presence.issues))}</p>"
        f"{demo_link}"
        f"<h3>Audit log</h3><pre>{html.escape(log)}</pre>"
        f"<h3>Outreach</h3>{outreach or '<p>None yet.</p>'}"
    )
    return body


class Handler(BaseHTTPRequestHandler):
    store = None  # set on the server instance

    def _send(self, code: int, body: str, ctype="text/html; charset=utf-8"):
        data = body.encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):  # noqa: N802
        path = urlparse(self.path).path
        store = type(self).store
        if path == "/" or path == "":
            self._send(200, _PAGE.format(body=_overview(store)))
        elif path.startswith("/lead/"):
            self._send(200, _PAGE.format(body=_lead_detail(store, path.split("/")[-1])))
        elif path.startswith("/demo/"):
            ld = store.get(path.split("/")[-1])
            if ld and ld.demo.path:
                try:
                    from pathlib import Path
                    self._send(200, Path(ld.demo.path).read_text(encoding="utf-8"))
                    return
                except Exception:
                    pass
            self._send(404, _PAGE.format(body="<p>Demo not found.</p>"))
        elif path == "/api/summary":
            self._send(200, json.dumps({
                "counts": store.counts(), "revenue": store.revenue(),
            }), ctype="application/json")
        else:
            self._send(404, _PAGE.format(body="<a href='/'>&larr; home</a><p>Not found.</p>"))

    def log_message(self, *args):  # silence default noisy logging
        pass


def serve(host: str = "0.0.0.0", port: int = 8000) -> None:
    Handler.store = LeadStore()
    httpd = ThreadingHTTPServer((host, port), Handler)
    print(f"Dashboard: http://localhost:{port}  (Ctrl-C to stop)")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")
