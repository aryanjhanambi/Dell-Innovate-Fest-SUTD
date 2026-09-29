import OpenAI from "openai";
import type { HealthIncident, SeniorProfile, HealthReport } from "./db";

/* Feature 3.5 — server-side clinical synthesis.
   Fuses the acute episode (this triage) with her interRAI baseline into an SBAR handover.
   Runs ONLY on the server (uses OPENAI_API_KEY); never imported into a client component. */

const MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

// Strict JSON schema → the model must return exactly this shape (no parsing guesswork).
const REPORT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    caregiver_summary: {
      type: "object",
      additionalProperties: false,
      properties: {
        what_happened: { type: "string" },
        why_it_matters: { type: "string" },
        do_now: { type: "array", items: { type: "string" } },
      },
      required: ["what_happened", "why_it_matters", "do_now"],
    },
    sbar: {
      type: "object",
      additionalProperties: false,
      properties: {
        situation: { type: "string" },
        background: { type: "string" },
        assessment: { type: "string" },
        recommendation: { type: "string" },
      },
      required: ["situation", "background", "assessment", "recommendation"],
    },
    paramedic_handover: {
      type: "object",
      additionalProperties: false,
      properties: {
        presenting: { type: "string" },
        key_history: { type: "string" },
        medications: { type: "string" },
        allergies: { type: "string" },
        code_status: { type: "string" },
        mobility: { type: "string" },
        caregiver_contact: { type: "string" },
      },
      required: ["presenting", "key_history", "medications", "allergies", "code_status", "mobility", "caregiver_contact"],
    },
    red_flags: { type: "array", items: { type: "string" } },
    confidence_note: { type: "string" },
  },
  required: ["caregiver_summary", "sbar", "paramedic_handover", "red_flags", "confidence_note"],
} as const;

const SYSTEM_PROMPT = `You are a clinical documentation assistant for a community eldercare service in Singapore (Care Corner / ICCP). You turn a senior's interRAI Check-Up record PLUS a just-now health check (triage) into a concise handover for two readers: (a) her family caregiver, and (b) paramedics or a doctor.

Hard rules:
- Use ONLY the data provided. NEVER invent vitals, medications, allergies, diagnoses, or history. If something is not in the data, write "Not on file."
- You do NOT diagnose and you do NOT prescribe. You summarize, surface clinically important patterns ("red flags"), and suggest sensible next steps. A human clinician makes the decisions.
- Be specific and concrete: reference her ACTUAL conditions, medications, fall history, and the CURRENT symptoms from the triage.

Section guidance:
- caregiver_summary: plain, warm, non-technical, for her adult daughter. do_now = 2-4 short, concrete actions (e.g. "Call her now", "If she vomits or can't stay awake, call 995").
- sbar: clinical shorthand is fine (Situation = the acute episode now; Background = relevant chronic history; Assessment = your synthesis of what's concerning, non-diagnostic; Recommendation = suggested next steps).
- paramedic_handover: terse, factual fields a responder needs on arrival.
- red_flags: clinically important combinations given THIS episode + her history (e.g. "Severe headache in a patient with hypertension and diabetes"). Use [] if genuinely none.
- confidence_note: one line on limitations (e.g. "Based on self-reported triage; no vitals measured; she lives alone").`;

/** Generate (or regenerate) the clinical report for an incident. Server-only. */
export async function generateHealthReport(
  incident: HealthIncident,
  profile: SeniorProfile | null,
): Promise<{ report: HealthReport; model: string }> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not set — add it to dashboard/.env.local to generate reports.");
  }
  const client = new OpenAI({ apiKey });

  const userContent = [
    "CURRENT HEALTH CHECK (acute episode, just now):",
    JSON.stringify(
      {
        complaint: incident.complaint,
        primary_symptom: incident.primary_symptom,
        location: incident.location,
        severity_1_10: incident.severity_1_10,
        dizziness: incident.dizziness,
        chest_pain: incident.chest_pain,
        notes: incident.notes,
        triage_level: incident.triage_level,
        escalation: incident.effective_status, // 'serious' | 'emergency' (no response) | ...
        started_at: incident.started_at,
      },
      null,
      2,
    ),
    "",
    "INTERRAI CHECK-UP RECORD (chronic baseline):",
    JSON.stringify(profile ?? {}, null, 2),
    "",
    "Produce the handover as JSON matching the schema.",
  ].join("\n");

  const completion = await client.chat.completions.create({
    model: MODEL,
    temperature: 0.2,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userContent },
    ],
    response_format: {
      type: "json_schema",
      json_schema: { name: "health_report", strict: true, schema: REPORT_SCHEMA },
    },
  });

  const text = completion.choices[0]?.message?.content;
  if (!text) throw new Error("OpenAI returned an empty report.");
  return { report: JSON.parse(text) as HealthReport, model: MODEL };
}
