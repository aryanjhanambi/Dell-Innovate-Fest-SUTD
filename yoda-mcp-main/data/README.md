# Demo data

`profiles/mdm-tan.json` is **synthetic**. "Madam Tan" is a fictional person invented
for the demo. Nothing here is real patient data.

The shape follows interRAI-style assessment sections (cognition, mood, functional
status, health conditions, medications) because that is the format Singapore
community-care providers actually assess with, so the agent is built against a
realistic record rather than a toy `{name, age}` object.

It is used two ways:

- `KB_BACKEND=local` reads these files directly, which lets the whole system run
  with no database.
- `KB_BACKEND=neon` reads the same shape from Postgres, and this file is the seed.
