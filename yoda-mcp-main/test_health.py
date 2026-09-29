"""Feature 3 — health triage + escalation tests.

The pure triage rules run anywhere. The DB-backed flow (begin/complete/list/decide,
incl. the no-response emergency watchdog) runs only when DATABASE_URL is set, and uses
a throwaway senior_id it cleans up afterwards.
"""

import os
import pytest

import health_db

HAS_DB = bool(os.environ.get("DATABASE_URL"))
TEST_SENIOR = "test-health-pytest"


# ---- pure triage rules (no DB) ----

def test_triage_mild_when_low_and_no_flags():
    assert health_db.triage(severity_1_10=3, dizziness=False, chest_pain=False) == "mild"
    assert health_db.triage(severity_1_10=None, dizziness=False, chest_pain=False) == "mild"


def test_triage_serious_on_each_red_flag():
    assert health_db.triage(8, False, False) == "serious"          # severe pain
    assert health_db.triage(2, True, False) == "serious"           # dizziness
    assert health_db.triage(2, False, True) == "serious"           # chest pain
    assert health_db.triage(2, False, False, recent_fall=True) == "serious"  # recent fall


# ---- DB flow (Neon) ----

@pytest.fixture
def clean_db():
    if not HAS_DB:
        pytest.skip("DATABASE_URL not set — skipping Neon integration test")
    health_db.init_schema()
    yield
    with health_db._conn() as conn:
        conn.execute("DELETE FROM health_incidents WHERE senior_id = %s", (TEST_SENIOR,))
        conn.commit()


def _active(seid):
    return health_db.list_active(seid)


def test_mild_incident_flow(clean_db):
    iid = health_db.begin(TEST_SENIOR, "slight headache")
    res = health_db.complete(TEST_SENIOR, iid, "headache", "head", 3, False, False, "")
    assert res["triage_level"] == "mild"
    row = next(r for r in _active(TEST_SENIOR) if r["id"] == iid)
    assert row["effective_status"] == "mild"
    assert row["status"] == "triaged"


def test_serious_incident_on_chest_pain(clean_db):
    iid = health_db.begin(TEST_SENIOR, "chest feels tight")
    res = health_db.complete(TEST_SENIOR, iid, "chest tightness", "chest", 5, False, True, "")
    assert res["triage_level"] == "serious"
    row = next(r for r in _active(TEST_SENIOR) if r["id"] == iid)
    assert row["effective_status"] == "serious"


def test_no_response_escalates_to_emergency(clean_db, monkeypatch):
    # Open an incident and never complete it; with a 0s window the watchdog escalates immediately.
    monkeypatch.setattr(health_db, "EMERGENCY_TIMEOUT_S", 0)
    iid = health_db.begin(TEST_SENIOR, "feels awful")
    row = next(r for r in _active(TEST_SENIOR) if r["id"] == iid)
    assert row["effective_status"] == "emergency"
    assert row["status"] == "in_progress"  # lifecycle unchanged; escalation is derived


def test_resolve_drops_incident_from_active(clean_db):
    iid = health_db.begin(TEST_SENIOR, "dizzy spell")
    health_db.complete(TEST_SENIOR, iid, "dizziness", "head", 4, True, False, "")
    health_db.decide(iid, "resolve")
    assert all(r["id"] != iid for r in _active(TEST_SENIOR))
