"""Short activity-onboarding questions, in PRD order.

Yoda should SKIP any question whose answer is already in the senior's profile
(`get_senior_profile`) — that's the "no 20-question form" promise. For Madam Tan, most
of these are already on file, so the conversation is really just a confirmation.
"""

QUESTIONS: list[dict] = [
    {"key": "looking_for", "question": "What are you looking for today?",
     "options": ["care help", "improve independence", "fitness classes", "fun activities"]},
    {"key": "new_to_fitness", "question": "Are you new to fitness classes?",
     "options": ["yes", "no"], "ask_if": {"looking_for": "fitness classes"}},
    {"key": "preferred_day", "question": "When do you prefer to attend?",
     "options": ["weekdays", "weekends"]},
    {"key": "goals", "question": "What would you like to work on?",
     "options": ["muscle strength", "endurance", "balance", "lose weight"]},
    {"key": "recent_injury", "question": "Any injury or surgery in the last 6 months?",
     "options": ["yes", "no"]},
    {"key": "preferred_location", "question": "Which location is convenient for you?",
     "options": ["Bukit Batok West", "Ci Yuan", "Heartbeat@Bedok", "Jurong Central Plaza",
                 "Kampung Admiralty", "Jurong Spring", "Serangoon Central", "Radin Mas"]},
    {"key": "open_to_volunteering", "question": "Are you open to volunteering or other activities?",
     "options": ["yes", "no"]},
]
