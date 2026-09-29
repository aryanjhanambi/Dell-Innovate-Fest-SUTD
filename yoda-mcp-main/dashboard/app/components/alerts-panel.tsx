import Link from "next/link";
import type { HealthIncident, SeniorProfile } from "@/lib/db";

/* Feature 3 — health alerts surfaced at the top of the caregiver dashboard.
   When Jarvis triages a health complaint (or the senior goes silent), the incident
   shows here, colour-graded by severity, with the relevant interRAI record inline
   so the caregiver can decide. Caregiver-facing only; the senior never sees this. */

type Decide = (id: number, action: "acknowledge" | "resolve") => void;

const RANK: Record<HealthIncident["effective_status"], number> = {
  emergency: 0,
  serious: 1,
  mild: 2,
  checking: 3,
  acknowledged: 4,
};

// per effective_status: label + Tailwind tone classes
const STYLE = {
  emergency: { label: "Emergency", border: "border-danger/60", chip: "bg-danger text-white", icon: "text-danger", ring: "emergency-pulse" },
  serious:   { label: "Urgent",    border: "border-coral/50",  chip: "bg-coral text-white",  icon: "text-coral",  ring: "" },
  mild:      { label: "Mild",      border: "border-amber/45",  chip: "bg-amber-soft text-amber", icon: "text-amber", ring: "" },
  checking:  { label: "Checking in…", border: "border-line", chip: "bg-paper text-muted", icon: "text-faint", ring: "" },
  acknowledged: { label: "Acknowledged", border: "border-line", chip: "bg-paper text-faint", icon: "text-faint", ring: "" },
} as const;

function ago(startedAt: string | undefined, now: number): string {
  if (!startedAt) return "";
  const s = Math.max(0, Math.round((now - new Date(startedAt).getTime()) / 1000));
  if (s < 5) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  return `${m}m ${s % 60}s ago`;
}

/** Pull the interRAI bits that matter when a health alert fires. */
function careContext(p: SeniorProfile | null) {
  const e = p?.section_e_health_conditions;
  const fall = e?.falls?.last_30_days;
  const hasFall = !!fall && !/no fall/i.test(fall);
  const pain = e?.pain_symptoms;
  const diagnoses = Object.entries(p?.section_f_disease_diagnoses ?? {})
    // values are "Present, treated or monitored" vs "Not present" — keep only the actually-present ones
    .filter(([, v]) => String(v).trim().toLowerCase().startsWith("present"))
    .map(([k]) => k.replace(/_/g, " "));
  const flags = p?.yoda_profile?.risk_flags ?? [];
  return { fall, hasFall, pain, diagnoses, flags };
}

export default function AlertsPanel({
  incidents,
  profile,
  now,
  busy,
  onDecide,
}: {
  incidents: HealthIncident[];
  profile: SeniorProfile | null;
  now: number;
  busy: Set<number>;
  onDecide: Decide;
}) {
  const active = [...incidents].sort((a, b) => RANK[a.effective_status] - RANK[b.effective_status]);
  if (active.length === 0) return null;

  const ctx = careContext(profile);
  const topIsCritical = active[0].effective_status === "emergency" || active[0].effective_status === "serious";

  return (
    <section className="rise mt-6">
      <div className="mb-3 flex items-end justify-between">
        <h2 className="font-display text-[22px] font-semibold tracking-tight text-ink">Health</h2>
        <span
          className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-semibold ${
            topIsCritical ? "bg-danger-soft text-danger" : "bg-paper text-muted"
          }`}
        >
          {active.length} active
        </span>
      </div>

      <ul className="space-y-3">
        {active.map((inc) => {
          const st = STYLE[inc.effective_status];
          const emergency = inc.effective_status === "emergency";
          const symptomBits = [
            inc.location,
            inc.severity_1_10 ? `${inc.severity_1_10}/10` : null,
            inc.chest_pain ? "chest pain" : null,
            inc.dizziness ? "dizzy" : null,
          ].filter(Boolean);

          return (
            <li
              key={inc.id}
              className={`rounded-[var(--radius-card)] border ${st.border} bg-card p-5 shadow-[0_6px_22px_rgba(120,90,40,0.07)] ${st.ring}`}
            >
              {/* headline */}
              <div className="flex items-start gap-4">
                <div className={`grid h-11 w-11 shrink-0 place-items-center rounded-[12px] bg-paper ${st.icon}`}>
                  {emergency ? <Siren /> : <Heart />}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide ${st.chip}`}>
                      {st.label}
                    </span>
                    {inc.effective_status === "checking" && (
                      <span className="check-dot text-[11px] font-semibold text-faint">Jarvis is checking on her…</span>
                    )}
                    <span className="text-[12px] text-faint">{ago(inc.started_at, now)}</span>
                  </div>
                  <p className="mt-1.5 font-display text-[18px] font-semibold leading-tight text-ink">
                    {emergency
                      ? "No response — Madam Tan stopped answering"
                      : inc.primary_symptom || inc.complaint || "Health concern"}
                  </p>
                  {emergency ? (
                    <p className="mt-0.5 text-[13.5px] text-danger">
                      Jarvis began a health check after “{inc.complaint}” and she went quiet. Check on her now.
                    </p>
                  ) : (
                    symptomBits.length > 0 && (
                      <p className="mt-0.5 truncate text-[13.5px] text-muted">{symptomBits.join("  ·  ")}</p>
                    )
                  )}
                </div>
              </div>

              {/* her care record — the interRAI context the caregiver needs to decide */}
              {(topIsCritical || emergency) && (
                <div className="mt-4 rounded-[14px] border border-line bg-paper/60 p-3.5">
                  <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-faint">From her care record</p>
                  <div className="flex flex-wrap gap-1.5">
                    {ctx.hasFall && <Chip tone="danger">Fall: {ctx.fall} (30d)</Chip>}
                    {ctx.pain?.intensity && (
                      <Chip>Pain: {ctx.pain.intensity}{ctx.pain.location ? ` · ${ctx.pain.location}` : ""}</Chip>
                    )}
                    {ctx.diagnoses.map((d) => (
                      <Chip key={d}>{d}</Chip>
                    ))}
                    {ctx.flags.slice(0, 2).map((f) => (
                      <Chip key={f} tone="warn">{f}</Chip>
                    ))}
                  </div>
                </div>
              )}

              {/* AI clinical report (serious/emergency only) */}
              {(inc.effective_status === "serious" || inc.effective_status === "emergency") && (
                <ReportBlock inc={inc} />
              )}

              {/* caregiver actions */}
              <div className="mt-4 flex items-center justify-end gap-2.5">
                <button
                  onClick={() => onDecide(inc.id, "acknowledge")}
                  disabled={busy.has(inc.id) || inc.status === "acknowledged"}
                  className="rounded-full px-4 py-2 text-[13.5px] font-medium text-muted transition-colors hover:bg-paper disabled:opacity-40"
                >
                  {inc.status === "acknowledged" ? "Acknowledged" : "Acknowledge"}
                </button>
                <button
                  onClick={() => onDecide(inc.id, "resolve")}
                  disabled={busy.has(inc.id)}
                  className={`inline-flex items-center gap-1.5 rounded-full px-5 py-2 text-[13.5px] font-semibold text-white shadow-[0_2px_10px_rgba(120,90,40,0.18)] transition-transform hover:scale-[1.02] disabled:opacity-60 ${
                    emergency || inc.effective_status === "serious" ? "bg-danger" : "bg-green"
                  }`}
                >
                  {busy.has(inc.id) ? "Saving…" : "Mark resolved"}
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/* ---------- pieces ---------- */

function ReportBlock({ inc }: { inc: HealthIncident }) {
  const r = inc.report;
  if (!r) {
    return (
      <div className="mt-4 flex items-center gap-2.5 rounded-[14px] border border-line bg-paper/60 px-3.5 py-3 text-[13px] text-muted">
        <Spinner />
        <span>Synthesizing clinical report from her care record…</span>
      </div>
    );
  }
  return (
    <div className="mt-4 rounded-[14px] border border-accent/25 bg-accent-soft/30 p-3.5">
      <div className="mb-2 flex items-center justify-between gap-3">
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-accent">AI clinical report</p>
        <Link href={`/report/${inc.id}`} className="shrink-0 text-[12.5px] font-semibold text-accent hover:underline">
          Open full report ↗
        </Link>
      </div>
      <p className="text-[14px] leading-relaxed text-ink">{r.caregiver_summary.what_happened}</p>
      {r.caregiver_summary.do_now?.length > 0 && (
        <ul className="mt-2 space-y-1">
          {r.caregiver_summary.do_now.slice(0, 3).map((a, i) => (
            <li key={i} className="flex gap-2 text-[13px] text-muted">
              <span className="text-accent">☐</span>
              <span>{a}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Spinner() {
  return (
    <svg className="h-4 w-4 shrink-0 animate-spin text-accent" viewBox="0 0 24 24" fill="none">
      <circle className="opacity-20" cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

function Chip({ children, tone = "plain" }: { children: React.ReactNode; tone?: "plain" | "danger" | "warn" }) {
  const cls =
    tone === "danger"
      ? "border-danger/30 bg-danger-soft text-danger"
      : tone === "warn"
      ? "border-amber/30 bg-amber-soft text-amber"
      : "border-line bg-card text-muted";
  return <span className={`rounded-full border px-2.5 py-1 text-[12px] font-medium ${cls}`}>{children}</span>;
}

function Heart() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <path d="M19 14c1.5-1.5 3-3.3 3-5.5A4.5 4.5 0 0 0 12 6 4.5 4.5 0 0 0 2 8.5c0 2.2 1.5 4 3 5.5l7 7Z" />
    </svg>
  );
}

function Siren() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <path d="M7 18v-6a5 5 0 0 1 10 0v6" />
      <path d="M5 21h14" />
      <path d="M12 2v2" /><path d="M4.9 6.3 6.3 7.7" /><path d="M19.1 6.3 17.7 7.7" />
    </svg>
  );
}
