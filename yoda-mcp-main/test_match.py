"""Tests for event matching + KB deep-merge."""

import json
from pathlib import Path

import events
import kb_store

_PROFILE = Path(__file__).parent / "data" / "profiles" / "mdm-tan.json"


def _mdm_tan_prefs() -> dict:
    p = json.loads(_PROFILE.read_text(encoding="utf-8"))
    return p["yoda_profile"]["fitness_preferences"]


def test_at_least_20_events_all_after_finals():
    assert len(events.EVENTS) >= 20
    assert all(e["iso_date"] > "2026-06-23" for e in events.EVENTS)


def test_mdm_tan_matches_balance_class_near_bedok():
    matches = events.match_events(_mdm_tan_prefs())
    assert matches, "expected at least one match"
    top = matches[0]
    assert "balance" in top["tags"]
    assert top["location"] == "Heartbeat@Bedok"
    # soonest balance class at Bedok after the finals
    assert top["name"] == "Gentle Balance & Stability Class"


def test_volunteering_boost_when_explicitly_sought():
    matches = events.match_events({"looking_for": "volunteering"})
    assert matches
    assert "volunteering" in matches[0]["tags"]


def test_irrelevant_goal_returns_no_match():
    assert events.match_events({"goals": ["underwater_basket_weaving"]}) == []


def test_ties_break_to_soonest_date():
    matches = events.match_events(_mdm_tan_prefs(), limit=3)
    dates = [m["iso_date"] for m in matches]
    assert dates == sorted(dates)  # within an equal-score tier, soonest first


def test_deep_merge_is_recursive_and_nondestructive():
    base = {"fitness_preferences": {"preferred_day": "Weekday", "goals": ["balance"]}}
    upd = {"fitness_preferences": {"preferred_day": "Weekend", "preferred_location": "Ci Yuan"}}
    out = kb_store.deep_merge(base, upd)
    assert out["fitness_preferences"]["preferred_day"] == "Weekend"
    assert out["fitness_preferences"]["preferred_location"] == "Ci Yuan"
    assert out["fitness_preferences"]["goals"] == ["balance"]  # untouched
