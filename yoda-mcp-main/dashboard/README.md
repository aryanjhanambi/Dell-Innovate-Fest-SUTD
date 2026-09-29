# Caregiver dashboard

The caregiver side. A live view of one senior that shows what the necklace found, and holds the
approval gate the agent cannot cross on its own.

Two screens.

**Care.** Health alerts as they come in. Each one carries the relevant slice of her care record
(diagnoses, medications, recent falls, pain) next to what she just reported, so the caregiver reads
the incident in context instead of as a bare notification. Anything serious gets an AI-synthesized
**SBAR clinical handover** at `/report/[id]`, formatted to print and hand to a paramedic. Pending
activity requests also land here for approve or decline.

**Welfare.** Ping the necklace, and only if she does not answer does the camera unlock. The
necklace announces itself out loud before the lens opens. Every action is written to a session log.

The page polls Neon every 3 seconds, which is also how the no-response emergency surfaces: the
escalation is a SQL expression evaluated at query time, not a background worker.

## Run

```bash
npm install
cp .env.example .env.local     # DATABASE_URL, OPENAI_API_KEY, DEVICE_TOKEN
npm run dev                    # http://localhost:3000
```

Same Neon database the MCP server writes to. The two never talk to each other directly.

## Key files

```
app/care-dashboard.tsx           # live UI, SWR poll
app/components/alerts-panel.tsx  # health alerts + inline report summary
app/welfare/welfare-panel.tsx    # ping, then camera on no-response
app/report/[id]/                 # printable SBAR handover

app/api/profile/route.ts         # GET  profile + requests + incidents
app/api/requests/route.ts        # POST approve / decline
app/api/alerts/route.ts          # POST acknowledge / resolve
app/api/report/[id]/route.ts     # POST synthesize, or return the cached report
app/api/welfare/route.ts         # POST ping / camera_on / camera_off
app/api/device/poll/route.ts     # the necklace asks for pending commands
app/api/device/frame/route.ts    # the necklace pushes a JPEG frame

lib/db.ts                        # Neon queries
lib/openai.ts                    # SBAR synthesis, server-only
```

Device routes are authenticated with a shared `DEVICE_TOKEN`, so only the necklace can poll for
commands or upload frames.

Stack: Next.js (App Router), Tailwind v4, `@neondatabase/serverless`, SWR. See the
[root README](../README.md) for the full architecture.
