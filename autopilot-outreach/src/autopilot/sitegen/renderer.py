"""Site generator. Turns a Lead + copy dict into a real, self-contained,
responsive HTML demo site written to data/demos/<lead_id>/index.html.

Zero dependencies: the template is inlined and themed per vertical. This is the
artifact the outreach pitch links to ("I already built you a site — look").
"""
from __future__ import annotations

import html
from datetime import datetime, timezone
from pathlib import Path

from ..config import settings
from ..models import Demo, Lead

# Per-vertical accent theming so each demo feels tailored, not generic.
_THEMES = {
    "landscaping": {"accent": "#2e7d32", "accent2": "#66bb6a", "emoji": "🌿"},
    "auto_repair": {"accent": "#c62828", "accent2": "#ef5350", "emoji": "🔧"},
    "plumbing": {"accent": "#1565c0", "accent2": "#42a5f5", "emoji": "🚿"},
    "_default": {"accent": "#5e35b1", "accent2": "#9575cd", "emoji": "⭐"},
}


def _e(s: str) -> str:
    return html.escape(str(s), quote=True)


def _service_cards(copy: dict, accent: str) -> str:
    cards = []
    for s in copy.get("services", []):
        cards.append(
            f'<div class="card">'
            f'<div class="dot" style="background:{accent}"></div>'
            f'<h3>{_e(s["name"])}</h3><p>{_e(s["blurb"])}</p></div>'
        )
    return "\n".join(cards)


def render_html(lead: Lead, copy: dict) -> str:
    b = lead.business
    theme = _THEMES.get(b.category, _THEMES["_default"])
    accent, accent2, emoji = theme["accent"], theme["accent2"], theme["emoji"]
    phone_href = "tel:" + "".join(ch for ch in b.phone if ch.isdigit())
    year = datetime.now(timezone.utc).year

    return f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{_e(b.name)} — {_e(b.city)}, {_e(b.state)}</title>
<meta name="description" content="{_e(copy.get('subhead',''))}">
<style>
  :root {{ --accent:{accent}; --accent2:{accent2}; }}
  * {{ box-sizing:border-box; margin:0; padding:0; }}
  body {{ font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;
          color:#1a1a1a; line-height:1.6; }}
  .wrap {{ max-width:1080px; margin:0 auto; padding:0 20px; }}
  header {{ position:sticky; top:0; background:#fff; border-bottom:1px solid #eee;
            z-index:10; }}
  nav {{ display:flex; align-items:center; justify-content:space-between;
         padding:14px 0; }}
  .brand {{ font-weight:800; font-size:1.15rem; }}
  .brand span {{ color:var(--accent); }}
  .btn {{ display:inline-block; background:var(--accent); color:#fff;
          padding:12px 22px; border-radius:8px; text-decoration:none;
          font-weight:600; transition:.15s; }}
  .btn:hover {{ filter:brightness(1.08); transform:translateY(-1px); }}
  .hero {{ background:linear-gradient(135deg,var(--accent),var(--accent2));
           color:#fff; padding:88px 0; }}
  .hero h1 {{ font-size:2.6rem; line-height:1.15; margin-bottom:16px;
              max-width:16ch; }}
  .hero p {{ font-size:1.2rem; opacity:.95; margin-bottom:28px; max-width:46ch; }}
  .hero .btn {{ background:#fff; color:var(--accent); }}
  section {{ padding:64px 0; }}
  h2 {{ font-size:1.9rem; margin-bottom:28px; }}
  .grid {{ display:grid; grid-template-columns:repeat(auto-fit,minmax(240px,1fr));
           gap:20px; }}
  .card {{ border:1px solid #eee; border-radius:12px; padding:22px;
           box-shadow:0 2px 10px rgba(0,0,0,.03); }}
  .card .dot {{ width:40px; height:40px; border-radius:10px; margin-bottom:14px; }}
  .card h3 {{ margin-bottom:8px; font-size:1.1rem; }}
  .card p {{ color:#555; font-size:.96rem; }}
  .about {{ background:#fafafa; }}
  .about .grid {{ grid-template-columns:1.4fr 1fr; align-items:center; }}
  .stat {{ font-size:2.4rem; font-weight:800; color:var(--accent); }}
  .review {{ font-style:italic; color:#333; font-size:1.15rem;
             border-left:4px solid var(--accent); padding-left:18px; }}
  .cta {{ background:linear-gradient(135deg,var(--accent),var(--accent2));
          color:#fff; text-align:center; }}
  .cta h2 {{ color:#fff; }}
  form {{ display:grid; gap:12px; max-width:440px; margin:20px auto 0; }}
  input,textarea {{ padding:12px; border-radius:8px; border:none; font-size:1rem; }}
  footer {{ background:#1a1a1a; color:#bbb; padding:34px 0; font-size:.9rem; }}
  footer a {{ color:#fff; }}
  .banner {{ background:#fffbe6; color:#7a5c00; text-align:center;
             padding:8px; font-size:.85rem; border-bottom:1px solid #f0e2a8; }}
  @media(max-width:720px) {{
    .hero h1 {{ font-size:2rem; }} .about .grid {{ grid-template-columns:1fr; }}
  }}
</style>
</head>
<body>
<div class="banner">✨ Demo preview built for {_e(b.name)} · not yet published</div>
<header><div class="wrap"><nav>
  <div class="brand">{emoji} {_e(b.name.split(chr(39))[0])}<span>.</span></div>
  <a class="btn" href="{phone_href}">Call {_e(b.phone)}</a>
</nav></div></header>

<div class="hero"><div class="wrap">
  <h1>{_e(copy.get('headline',''))}</h1>
  <p>{_e(copy.get('subhead',''))}</p>
  <a class="btn" href="#quote">{_e(copy.get('cta','Get a Free Quote'))}</a>
</div></div>

<section><div class="wrap">
  <h2>Our Services</h2>
  <div class="grid">{_service_cards(copy, accent)}</div>
</div></section>

<section class="about"><div class="wrap"><div class="grid">
  <div>
    <h2>About Us</h2>
    <p>{_e(copy.get('about',''))}</p>
    <p class="review" style="margin-top:20px">{_e(copy.get('review',''))}</p>
  </div>
  <div style="text-align:center">
    <div class="stat">{_e(b.rating)}★</div>
    <div>{_e(b.review_count)} customer reviews</div>
    <div style="margin-top:16px;color:#666">{_e(b.hours)}</div>
    <div style="color:#666">{_e(b.address)}, {_e(b.city)}, {_e(b.state)}</div>
  </div>
</div></div></section>

<section class="cta" id="quote"><div class="wrap">
  <h2>Request a Free Quote</h2>
  <p>Fast response — usually within one business day.</p>
  <form onsubmit="alert('Demo form — in production this emails the owner.');return false">
    <input placeholder="Your name" required>
    <input placeholder="Phone or email" required>
    <textarea placeholder="How can we help?" rows="3"></textarea>
    <button class="btn" type="submit" style="background:#fff;color:var(--accent)">
      Send Request</button>
  </form>
</div></section>

<footer><div class="wrap">
  {_e(b.name)} · {_e(b.address)}, {_e(b.city)}, {_e(b.state)} · {_e(b.phone)}<br>
  &copy; {year} {_e(b.name)}. Site by Autopilot Web.
</div></footer>
</body>
</html>
"""


def build_site(lead: Lead, copy: dict) -> Demo:
    """Render + write the demo site; return a populated Demo record."""
    settings.ensure_dirs()
    out_dir = settings.demos_dir / lead.id
    out_dir.mkdir(parents=True, exist_ok=True)
    index = out_dir / "index.html"
    index.write_text(render_html(lead, copy), encoding="utf-8")

    return Demo(
        preview_url=f"{settings.preview_host}/demo/{lead.id}",
        template_id=f"{lead.business.category}_v1",
        built_at=datetime.now(timezone.utc).isoformat(timespec="seconds"),
        path=str(index),
    )
