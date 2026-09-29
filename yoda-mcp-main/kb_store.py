"""Knowledge-base storage adapter.

The senior's profile is one shared JSON document (Abel's interRAI baseline + Yoda's
appended preferences/bookings). `load_profile` reads it, `save_profile` writes it.

Backends (set `KB_BACKEND` in .env):
  - "neon"  → Neon Postgres, `profiles(senior_id text pk, data jsonb)` upsert  (shared with Abel)
  - "local" → a JSON file under data/profiles/  (default; bulletproof, offline)
"""

from __future__ import annotations

import json
import os
from pathlib import Path

try:
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).parent / ".env")  # make KB_BACKEND / DATABASE_URL available everywhere
except Exception:  # pragma: no cover - dotenv optional
    pass

KB_BACKEND = os.getenv("KB_BACKEND", "local").lower()
_DATA_DIR = Path(__file__).parent / "data" / "profiles"


def _skeleton(senior_id: str) -> dict:
    return {"senior_id": senior_id,
            "yoda_profile": {"booked_activities": [], "caregiver_alerts": []}}


def load_profile(senior_id: str = "mdm-tan") -> dict:
    """Read the senior's knowledge-base profile. Fresh skeleton if none exists."""
    if KB_BACKEND == "neon":
        return _neon_load(senior_id)
    path = _local_path(senior_id)
    if path.exists():
        return json.loads(path.read_text(encoding="utf-8"))
    return _skeleton(senior_id)


def save_profile(senior_id: str, profile: dict) -> dict:
    """Persist the full profile dict. Returns it."""
    if KB_BACKEND == "neon":
        return _neon_save(senior_id, profile)
    _DATA_DIR.mkdir(parents=True, exist_ok=True)
    _local_path(senior_id).write_text(
        json.dumps(profile, indent=2, ensure_ascii=False), encoding="utf-8")
    return profile


def deep_merge(base: dict, updates: dict) -> dict:
    """Recursively merge `updates` into `base` (nested dicts merge; scalars/lists replace)."""
    out = dict(base)
    for k, v in (updates or {}).items():
        if isinstance(v, dict) and isinstance(out.get(k), dict):
            out[k] = deep_merge(out[k], v)
        else:
            out[k] = v
    return out


# --- local backend ----------------------------------------------------------------------
def _local_path(senior_id: str) -> Path:
    return _DATA_DIR / f"{senior_id}.json"


# --- neon backend -----------------------------------------------------------------------
def _neon_conn():
    import psycopg
    url = os.environ.get("DATABASE_URL")
    if not url:
        raise RuntimeError("KB_BACKEND=neon but DATABASE_URL is not set (.env).")
    return psycopg.connect(url)


def _neon_load(senior_id: str) -> dict:
    with _neon_conn() as conn:
        row = conn.execute(
            "SELECT data FROM profiles WHERE senior_id = %s", (senior_id,)).fetchone()
    return row[0] if row else _skeleton(senior_id)  # jsonb -> dict


def _neon_save(senior_id: str, profile: dict) -> dict:
    from psycopg.types.json import Json
    with _neon_conn() as conn:
        conn.execute(
            "INSERT INTO profiles (senior_id, data, updated_at) VALUES (%s, %s, now()) "
            "ON CONFLICT (senior_id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()",
            (senior_id, Json(profile)))
        conn.commit()
    return profile
