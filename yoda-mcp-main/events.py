"""
Community-activity catalogue + matcher for Yoda's social-engagement pillar.

22 demo events, every date AFTER the 23 Jun 2026 finals so matches read as real.
`match_events()` scores events against a senior's preferences — which come from the
baseline `yoda_profile.fitness_preferences` (so Yoda matches from what it already
knows) plus any answers gathered during the conversation.
"""

from __future__ import annotations

# Canonical goal vocabulary — fold synonyms so the baseline's words line up with tags.
_GOAL_ALIASES = {
    "stability": "balance",
    "strength": "muscle_strength",
    "muscle": "muscle_strength",
    "muscle_strength_and_strength": "muscle_strength",
    "weight": "lose_weight",
    "weight_loss": "lose_weight",
    "endurance_and_stamina": "endurance",
}

# 8 community locations match the PRD's onboarding location list.
EVENTS: list[dict] = [
    {"name": "Gentle Balance & Stability Class", "location": "Heartbeat@Bedok",
     "date": "Wednesday, 24 June 2026", "iso_date": "2026-06-24", "time": "10:00am",
     "tags": ["balance", "new_friendly", "weekday"]},
    {"name": "Fall Prevention & Balance Workshop", "location": "Serangoon Central",
     "date": "Thursday, 25 June 2026", "iso_date": "2026-06-25", "time": "11:00am",
     "tags": ["balance", "new_friendly", "weekday"]},
    {"name": "Strength & Muscle Training", "location": "Jurong Spring",
     "date": "Friday, 26 June 2026", "iso_date": "2026-06-26", "time": "9:00am",
     "tags": ["muscle_strength", "weekday"]},
    {"name": "Weekend Endurance Walk", "location": "Ci Yuan",
     "date": "Saturday, 27 June 2026", "iso_date": "2026-06-27", "time": "8:00am",
     "tags": ["endurance", "weekend"]},
    {"name": "Weekend Weight Loss Bootcamp", "location": "Radin Mas",
     "date": "Sunday, 28 June 2026", "iso_date": "2026-06-28", "time": "7:30am",
     "tags": ["lose_weight", "weekend"]},
    {"name": "Senior Volunteer Buddy Programme", "location": "Kampung Admiralty",
     "date": "Monday, 29 June 2026", "iso_date": "2026-06-29", "time": "2:00pm",
     "tags": ["volunteering", "social", "weekday"]},
    {"name": "Chair Yoga for Beginners", "location": "Heartbeat@Bedok",
     "date": "Tuesday, 30 June 2026", "iso_date": "2026-06-30", "time": "10:30am",
     "tags": ["balance", "new_friendly", "weekday"]},
    {"name": "Tai Chi in the Park", "location": "Bukit Batok West",
     "date": "Wednesday, 1 July 2026", "iso_date": "2026-07-01", "time": "8:00am",
     "tags": ["balance", "endurance", "weekday"]},
    {"name": "Resistance Band Strength Class", "location": "Jurong Central Plaza",
     "date": "Thursday, 2 July 2026", "iso_date": "2026-07-02", "time": "9:30am",
     "tags": ["muscle_strength", "new_friendly", "weekday"]},
    {"name": "Brisk Walking Club", "location": "Serangoon Central",
     "date": "Friday, 3 July 2026", "iso_date": "2026-07-03", "time": "7:30am",
     "tags": ["endurance", "weekday"]},
    {"name": "Community Gardening & Greens", "location": "Kampung Admiralty",
     "date": "Saturday, 4 July 2026", "iso_date": "2026-07-04", "time": "9:00am",
     "tags": ["fun", "social", "volunteering", "weekend"]},
    {"name": "Karaoke & Social Morning", "location": "Ci Yuan",
     "date": "Sunday, 5 July 2026", "iso_date": "2026-07-05", "time": "10:00am",
     "tags": ["fun", "social", "weekend"]},
    {"name": "Balance & Mobility Class", "location": "Jurong Spring",
     "date": "Monday, 6 July 2026", "iso_date": "2026-07-06", "time": "10:00am",
     "tags": ["balance", "new_friendly", "weekday"]},
    {"name": "Low-Impact Aerobics", "location": "Radin Mas",
     "date": "Tuesday, 7 July 2026", "iso_date": "2026-07-07", "time": "9:00am",
     "tags": ["lose_weight", "endurance", "weekday"]},
    {"name": "Strength for Seniors", "location": "Heartbeat@Bedok",
     "date": "Wednesday, 8 July 2026", "iso_date": "2026-07-08", "time": "9:00am",
     "tags": ["muscle_strength", "weekday"]},
    {"name": "Mahjong & Friends Social", "location": "Bukit Batok West",
     "date": "Thursday, 9 July 2026", "iso_date": "2026-07-09", "time": "2:00pm",
     "tags": ["fun", "social", "weekday"]},
    {"name": "Volunteer Befriender Training", "location": "Ci Yuan",
     "date": "Friday, 10 July 2026", "iso_date": "2026-07-10", "time": "2:00pm",
     "tags": ["volunteering", "social", "weekday"]},
    {"name": "Weekend Nature Walk & Endurance", "location": "Bukit Batok West",
     "date": "Saturday, 11 July 2026", "iso_date": "2026-07-11", "time": "7:30am",
     "tags": ["endurance", "weekend"]},
    {"name": "Active Ageing Dance Class", "location": "Kampung Admiralty",
     "date": "Sunday, 12 July 2026", "iso_date": "2026-07-12", "time": "10:00am",
     "tags": ["fun", "endurance", "weekend"]},
    {"name": "Beginner Pilates for Balance", "location": "Serangoon Central",
     "date": "Monday, 13 July 2026", "iso_date": "2026-07-13", "time": "10:30am",
     "tags": ["balance", "new_friendly", "weekday"]},
    {"name": "Weight Management Workshop", "location": "Jurong Central Plaza",
     "date": "Wednesday, 15 July 2026", "iso_date": "2026-07-15", "time": "11:00am",
     "tags": ["lose_weight", "weekday"]},
    {"name": "Steady Steps Balance Clinic", "location": "Heartbeat@Bedok",
     "date": "Thursday, 16 July 2026", "iso_date": "2026-07-16", "time": "10:00am",
     "tags": ["balance", "new_friendly", "weekday"]},
]


def _normalize_prefs(prefs: dict) -> dict:
    """Fold the baseline's fitness_preferences (+ any onboarding answers) into a
    consistent, lowercase shape the scorer can use."""
    goals = set()
    for g in (prefs.get("goals") or []):
        g = str(g).strip().lower().replace(" ", "_")
        goals.add(_GOAL_ALIASES.get(g, g))
    return {
        "goals": goals,
        "preferred_day": str(prefs.get("preferred_day") or "").strip().lower(),  # weekday/weekend/""
        "new_to_fitness": bool(prefs.get("new_to_fitness", prefs.get("new_to_fitness_classes", False))),
        "preferred_location": str(prefs.get("preferred_location") or "").strip().lower(),
        "looking_for": str(prefs.get("looking_for") or "").strip().lower(),
        "open_to_volunteering": bool(prefs.get("open_to_volunteering", False)),
    }


def _score(event: dict, p: dict) -> int:
    tags = set(event["tags"])
    score = 2 * len(p["goals"] & tags)                      # +2 per matched goal
    if p["preferred_day"] and p["preferred_day"] in tags:   # +1 right day
        score += 1
    if p["new_to_fitness"] and "new_friendly" in tags:      # +1 beginner-friendly
        score += 1
    if p["preferred_location"] and p["preferred_location"] == event["location"].lower():
        score += 1                                          # +1 same area
    if p["looking_for"] == "volunteering" and "volunteering" in tags:
        score += 3                                          # explicitly seeking volunteering
    elif p["open_to_volunteering"] and "volunteering" in tags:
        score += 1
    return score


def match_events(preferences: dict, limit: int = 2) -> list[dict]:
    """Return the top 1–2 events for a senior's preferences.

    Scoring: +2 per matching goal tag, +1 preferred-day, +1 beginner-friendly when
    new to fitness, +1 same location, volunteering boost when sought. Ties break to
    the soonest date.
    """
    p = _normalize_prefs(preferences or {})
    scored = [(_score(ev, p), ev["iso_date"], ev) for ev in EVENTS]
    scored = [t for t in scored if t[0] > 0]
    scored.sort(key=lambda t: (-t[0], t[1]))  # score desc, then soonest date
    return [ev for _, _, ev in scored[:limit]]
