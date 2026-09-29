"""
ICCP service layer (the "provider_adapter" seam).

Each function is the SINGLE place where a community-care action happens.
Right now every function returns a realistic MOCK confirmation, because no
Singapore provider (Care Corner / AIC / ICCP / Meals-on-Wheels / transport /
home-care) exposes a public booking API — confirmed by research.

When a real API ever comes online, swap the body of ONE function for an
`httpx.post(...)` call. The tool layer (yoda_iccp.py) never changes.
This is the literal "API-first, ready to plug in as integrations come online"
promise from the Yoda pitch.
"""

import random
import string

# Flip to False the day a real provider API exists; swap the bodies below.
MOCK_MODE = True


def _ref(prefix: str) -> str:
    return f"{prefix}-" + "".join(random.choices(string.digits, k=4))


def book_meal(date: str, meal_type: str = "lunch") -> dict:
    ref = _ref("MEAL")
    # REAL (future): httpx.post(MEALS_API, json={...}).json()
    return {
        "status": "confirmed",
        "service": "Meals on Wheels",
        "reference": ref,
        "date": date,
        "meal_type": meal_type,
        "live_location": "shared from necklace — no address needed",
        "message": (
            f"Your {meal_type} delivery is booked for {date}. "
            f"Reference {ref}. A volunteer will call to confirm."
        ),
    }
