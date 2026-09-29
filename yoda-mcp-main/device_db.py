"""Device relay state — the cloud bridge for welfare (ping + camera) without a LAN IP.

The necklace can't be reached from the cloud (NAT + private IP), so it **polls** this state
and **pushes** photos up. The caregiver dashboard sets ping/camera flags here; the device
reads them on its next poll and uploads a JPEG. One row per senior. Neon-backed.

The runtime read/writes happen in the Next.js dashboard (dashboard/lib/db.ts). This module
owns the schema (idempotent) + a couple of helpers for migration/tests.
"""

from __future__ import annotations

import os
from pathlib import Path

try:
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).parent / ".env")
except Exception:  # pragma: no cover
    pass


def _conn():
    import psycopg
    url = os.environ.get("DATABASE_URL")
    if not url:
        raise RuntimeError("DATABASE_URL not set (.env) — device relay needs Neon.")
    return psycopg.connect(url)


_DDL = [
    """
    CREATE TABLE IF NOT EXISTS device_state (
        senior_id        text PRIMARY KEY,
        ping_requested   boolean NOT NULL DEFAULT false,   -- caregiver wants a beep + announce
        camera_requested boolean NOT NULL DEFAULT false,   -- caregiver wants photos
        latest_frame     text,                             -- most recent JPEG, base64
        frame_at         timestamptz,
        device_ip        text,                             -- LAN IP the device self-reports (fallback)
        last_seen        timestamptz,                      -- last device poll (online indicator)
        updated_at       timestamptz NOT NULL DEFAULT now()
    )
    """,
]


def init_schema() -> None:
    """Create the device_state table if it doesn't exist (idempotent)."""
    with _conn() as conn:
        for stmt in _DDL:
            conn.execute(stmt)
        conn.commit()


def get_state(senior_id: str = "mdm-tan") -> dict:
    """Read the row (without the heavy frame) — for tests / debugging."""
    with _conn() as conn:
        row = conn.execute(
            "SELECT senior_id, ping_requested, camera_requested, frame_at, device_ip, last_seen "
            "FROM device_state WHERE senior_id=%s",
            (senior_id,),
        ).fetchone()
    if not row:
        return {}
    return {
        "senior_id": row[0],
        "ping_requested": row[1],
        "camera_requested": row[2],
        "frame_at": row[3].isoformat() if row[3] else None,
        "device_ip": row[4],
        "last_seen": row[5].isoformat() if row[5] else None,
    }


def set_command(senior_id: str, action: str) -> None:
    """Caregiver action: 'ping' | 'camera_on' | 'camera_off' (upsert)."""
    col, val = {
        "ping": ("ping_requested", True),
        "camera_on": ("camera_requested", True),
        "camera_off": ("camera_requested", False),
    }[action]
    with _conn() as conn:
        conn.execute(
            f"INSERT INTO device_state (senior_id, {col}, updated_at) VALUES (%s,%s,now()) "
            f"ON CONFLICT (senior_id) DO UPDATE SET {col}=EXCLUDED.{col}, updated_at=now()",
            (senior_id, val),
        )
        conn.commit()


def reset(senior_id: str = "mdm-tan") -> None:
    """Clear flags + frame (test cleanup)."""
    with _conn() as conn:
        conn.execute(
            "UPDATE device_state SET ping_requested=false, camera_requested=false, "
            "latest_frame=NULL, frame_at=NULL WHERE senior_id=%s",
            (senior_id,),
        )
        conn.commit()
