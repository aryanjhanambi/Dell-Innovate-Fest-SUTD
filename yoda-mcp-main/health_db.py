"""Health incidents — Yoda's triage & escalation workflow (Feature 3).

Yoda opens an incident the MOMENT a senior reports feeling unwell (`begin`), then
finalizes it after a short triage (`complete`, which assigns mild/serious via clinical
red-flags). If the triage never completes — she went silent — the incident stays
`in_progress`, and a **query-time watchdog** in `list_active` escalates it to an
`emergency` once it's older than EMERGENCY_TIMEOUT_S. No cron, no background worker:
the dashboard's existing 3s poll renders the escalation. Neon-backed (`health_incidents`).
"""

from __future__ import annotations

import os
from pathlib import Path

try:
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).parent / ".env")
except Exception:  # pragma: no cover - dotenv optional
    pass

# How long an un-completed (in_progress) incident may sit before the watchdog treats
# the silence as an emergency. Tunable via env so the demo can pace it.
EMERGENCY_TIMEOUT_S = int(os.environ.get("EMERGENCY_TIMEOUT_S", "25"))


def _conn():
    import psycopg
    url = os.environ.get("DATABASE_URL")
    if not url:
        raise RuntimeError("DATABASE_URL not set (.env) — health incidents need Neon.")
    return psycopg.connect(url)


_DDL = [
    """
    CREATE TABLE IF NOT EXISTS health_incidents (
        id              bigserial PRIMARY KEY,
        senior_id       text NOT NULL,
        complaint       text,
        primary_symptom text,
        location        text,
        severity_1_10   int,
        dizziness       boolean DEFAULT false,
        chest_pain      boolean DEFAULT false,
        triage_level    text,                                  -- mild | serious (null while in_progress)
        status          text NOT NULL DEFAULT 'in_progress',   -- in_progress | triaged | acknowledged | resolved
        notes           text,
        started_at      timestamptz NOT NULL DEFAULT now(),
        triaged_at      timestamptz,
        decided_at      timestamptz
    )
    """,
    "CREATE INDEX IF NOT EXISTS health_incidents_senior_idx ON health_incidents (senior_id, status)",
    # Feature 3.5 — cached AI clinical report (synthesized dashboard-side from incident + interRAI)
    "ALTER TABLE health_incidents ADD COLUMN IF NOT EXISTS report jsonb",
    "ALTER TABLE health_incidents ADD COLUMN IF NOT EXISTS report_model text",
    "ALTER TABLE health_incidents ADD COLUMN IF NOT EXISTS report_generated_at timestamptz",
]


def init_schema() -> None:
    """Create the health_incidents table if it doesn't exist (idempotent)."""
    with _conn() as conn:
        for stmt in _DDL:
            conn.execute(stmt)
        conn.commit()


def triage(severity_1_10: int | None, dizziness: bool, chest_pain: bool,
           recent_fall: bool = False) -> str:
    """Rule-based triage. Red-flags → 'serious', otherwise 'mild'.

    Deliberately simple and explainable: chest pain, dizziness, severe pain (>=7),
    or a recent fall escalate. This is triage, not diagnosis — the caregiver decides.
    """
    sev = severity_1_10 or 0
    if sev >= 7 or chest_pain or dizziness or recent_fall:
        return "serious"
    return "mild"


def begin(senior_id: str, complaint: str) -> int:
    """Open an in_progress incident and return its id (call the instant distress is mentioned)."""
    with _conn() as conn:
        row = conn.execute(
            "INSERT INTO health_incidents (senior_id, complaint) VALUES (%s, %s) RETURNING id",
            (senior_id, complaint),
        ).fetchone()
        conn.commit()
    return int(row[0])


def complete(senior_id: str, incident_id: int | None, primary_symptom: str,
             location: str, severity_1_10: int | None, dizziness: bool,
             chest_pain: bool, notes: str, recent_fall: bool = False) -> dict:
    """Finalize a triage. Updates the open incident if `incident_id` is given and exists;
    otherwise inserts a finished one (create-or-update — so a triage is never lost)."""
    level = triage(severity_1_10, dizziness, chest_pain, recent_fall)
    with _conn() as conn:
        row = None
        if incident_id:
            row = conn.execute(
                "UPDATE health_incidents SET primary_symptom=%s, location=%s, severity_1_10=%s, "
                "dizziness=%s, chest_pain=%s, notes=%s, triage_level=%s, status='triaged', "
                "triaged_at=now() WHERE id=%s AND status='in_progress' RETURNING id",
                (primary_symptom, location, severity_1_10, dizziness, chest_pain, notes, level, incident_id),
            ).fetchone()
        if row is None:
            row = conn.execute(
                "INSERT INTO health_incidents (senior_id, primary_symptom, location, severity_1_10, "
                "dizziness, chest_pain, notes, triage_level, status, triaged_at) "
                "VALUES (%s,%s,%s,%s,%s,%s,%s,%s,'triaged',now()) RETURNING id",
                (senior_id, primary_symptom, location, severity_1_10, dizziness, chest_pain, notes, level),
            ).fetchone()
        conn.commit()
    return {"incident_id": int(row[0]), "triage_level": level}


# Effective status the UI shows, derived from lifecycle + the silence watchdog.
_EFFECTIVE_STATUS = """
    CASE
        WHEN status = 'in_progress' AND now() - started_at > make_interval(secs => %s) THEN 'emergency'
        WHEN status = 'in_progress' THEN 'checking'
        WHEN status = 'triaged' AND triage_level = 'serious' THEN 'serious'
        WHEN status = 'triaged' AND triage_level = 'mild'    THEN 'mild'
        ELSE status
    END
"""


def list_active(senior_id: str) -> list[dict]:
    """Active incidents (not resolved), newest first, with the computed effective_status
    (checking | mild | serious | emergency | acknowledged). The emergency escalation is
    derived here from now() vs started_at — that IS the no-response watchdog."""
    q = (
        "SELECT id, senior_id, complaint, primary_symptom, location, severity_1_10, dizziness, "
        "chest_pain, triage_level, status, notes, started_at, triaged_at, "
        f"({_EFFECTIVE_STATUS}) AS effective_status, "
        "EXTRACT(EPOCH FROM (now() - started_at))::int AS age_s "
        "FROM health_incidents WHERE senior_id = %s AND status <> 'resolved' "
        "ORDER BY started_at DESC"
    )
    with _conn() as conn:
        rows = conn.execute(q, (EMERGENCY_TIMEOUT_S, senior_id)).fetchall()
    return [
        {
            "id": r[0],
            "senior_id": r[1],
            "complaint": r[2],
            "primary_symptom": r[3],
            "location": r[4],
            "severity_1_10": r[5],
            "dizziness": r[6],
            "chest_pain": r[7],
            "triage_level": r[8],
            "status": r[9],
            "notes": r[10],
            "started_at": r[11].isoformat() if r[11] else None,
            "triaged_at": r[12].isoformat() if r[12] else None,
            "effective_status": r[13],
            "age_s": r[14],
        }
        for r in rows
    ]


def decide(incident_id: int, action: str) -> dict:
    """Caregiver action on an alert: 'acknowledge' (seen, still open) or 'resolve' (closed)."""
    status = "resolved" if action == "resolve" else "acknowledged"
    with _conn() as conn:
        row = conn.execute(
            "UPDATE health_incidents SET status=%s, decided_at=now() WHERE id=%s RETURNING id, status",
            (status, incident_id),
        ).fetchone()
        conn.commit()
    return {"id": row[0], "status": row[1]} if row else {}
