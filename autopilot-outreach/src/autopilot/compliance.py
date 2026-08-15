"""Compliance gates. These run BEFORE any outreach spend.

This is deliberately a first-class module, not an afterthought: automated
calling touches TCPA / DNC / state bot-disclosure / calling-hours law. In mock
mode we simulate a DNC list and a clock; in live mode these functions are where
you wire the National DNC scrub, your internal suppression list, and STIR/SHAKEN
number reputation.

See docs/DESIGN.md §7 for the full legal picture.
"""
from __future__ import annotations

from .config import settings
from .models import Lead

# A tiny simulated Do-Not-Call suppression set (last-4 of phone) for mock runs.
# Any lead whose phone ends in one of these is treated as on the DNC registry.
_MOCK_DNC_SUFFIXES = {"0000", "1313", "9999"}


def check_dnc(lead: Lead) -> bool:
    """Return True if the lead is on the (simulated) DNC list."""
    phone = (lead.business.phone or "").replace("-", "").replace(" ", "")
    on_dnc = phone[-4:] in _MOCK_DNC_SUFFIXES if len(phone) >= 4 else False
    lead.compliance.dnc_checked = True
    lead.compliance.on_dnc = on_dnc
    return on_dnc


def within_call_hours(local_hour: int) -> bool:
    """Federal rule of thumb: 8am–9pm local. Configurable per campaign."""
    return settings.call_hours_start <= local_hour < settings.call_hours_end


AI_DISCLOSURE_LINE = (
    "Hi, quick heads up — this is an automated AI assistant calling on behalf "
    "of {company}. Do you have twenty seconds?"
)


def outreach_allowed(lead: Lead, local_hour: int, channel: str) -> tuple[bool, str]:
    """Single gate every outreach attempt must pass. Returns (allowed, reason)."""
    if check_dnc(lead):
        return False, "on_dnc"
    if channel in {"voice", "sms"} and not within_call_hours(local_hour):
        lead.compliance.within_call_hours = False
        return False, "outside_call_hours"
    return True, "ok"
