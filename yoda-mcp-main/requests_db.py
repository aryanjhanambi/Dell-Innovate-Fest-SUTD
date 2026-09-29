"""Activity requests — the human-in-the-loop workflow.

Yoda creates a PENDING request; the senior's caregiver approves or declines it on the
dashboard. Yoda never books directly. Neon-backed (the `requests` table).
"""

from __future__ import annotations

import os
from pathlib import Path

try:
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).parent / ".env")
except Exception:  # pragma: no cover - dotenv optional
    pass


def _conn():
    import psycopg
    url = os.environ.get("DATABASE_URL")
    if not url:
        raise RuntimeError("DATABASE_URL not set (.env) — activity requests need Neon.")
    return psycopg.connect(url)


def create_request(senior_id: str, event: dict) -> int:
    """Insert a PENDING request and return its id."""
    from psycopg.types.json import Json
    with _conn() as conn:
        row = conn.execute(
            "INSERT INTO requests (senior_id, event) VALUES (%s, %s) RETURNING id",
            (senior_id, Json(event)),
        ).fetchone()
        conn.commit()
    return int(row[0])


def list_requests(senior_id: str, status: str | None = None) -> list[dict]:
    """List a senior's requests, newest first (optionally filtered by status)."""
    q = "SELECT id, event, status, reference, created_at FROM requests WHERE senior_id = %s"
    args: list = [senior_id]
    if status:
        q += " AND status = %s"
        args.append(status)
    q += " ORDER BY created_at DESC"
    with _conn() as conn:
        rows = conn.execute(q, tuple(args)).fetchall()
    return [
        {
            "id": r[0],
            "event": r[1],
            "status": r[2],
            "reference": r[3],
            "created_at": r[4].isoformat() if r[4] else None,
        }
        for r in rows
    ]


def decide_request(request_id: int, decision: str, reference: str | None = None,
                   decided_by: str = "caregiver") -> dict:
    """Approve or decline a request. (The dashboard normally does this; here for testing.)"""
    status = "approved" if decision == "approve" else "declined"
    with _conn() as conn:
        row = conn.execute(
            "UPDATE requests SET status=%s, reference=%s, decided_at=now(), decided_by=%s "
            "WHERE id=%s RETURNING id, event, status, reference",
            (status, reference, decided_by, request_id),
        ).fetchone()
        conn.commit()
    return (
        {"id": row[0], "event": row[1], "status": row[2], "reference": row[3]}
        if row else {}
    )
