import Link from "next/link";
import { getIncident, getProfile } from "@/lib/db";
import ReportActions from "./report-actions";

export const dynamic = "force-dynamic";

function fmt(iso?: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("en-SG", { dateStyle: "medium", timeStyle: "short" });
  } catch {
    return iso;
  }
}

const TRIAGE_STYLE: Record<string, string> = {
  emergency: "bg-danger text-white",
  serious: "bg-coral text-white",
  mild: "bg-amber-soft text-amber",
};

export default async function ReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const incident = await getIncident(Number(id));

  if (!incident) {
    return <Notice>Incident not found.</Notice>;
  }
  if (!incident.report) {
    return (
      <Notice>
        No report generated for this incident yet.
        <Link href="/" className="mt-3 block text-[14px] text-accent underline">← Back to dashboard</Link>
      </Notice>
    );
  }

  const profile = await getProfile(incident.senior_id ?? "mdm-tan");
  const ident = profile?.section_a_identification;
  const caregiver = profile?.section_p_caregiver?.primary_caregiver;
  const r = incident.report;
  const triage = incident.triage_level ?? (incident.status === "in_progress" ? "emergency" : incident.status);
  const patient = `${ident?.preferred_name ?? "Madam Tan"}${ident?.age ? `, ${ident.age}` : ""}${
    ident?.gender ? ` ${ident.gender[0]}` : ""
  }`;
  const when = fmt(incident.started_at);
  const h = r.paramedic_handover;

  return (
    <main className="mx-auto w-full max-w-[820px] px-6 py-10 sm:px-8">
      {/* top controls (hidden on print) */}
      <div className="no-print mb-5 flex items-center justify-between">
        <Link href="/" className="text-[14px] text-muted hover:text-ink">← Dashboard</Link>
        <ReportActions report={r} patient={patient} triage={triage} when={when} />
      </div>

      <article className="print-sheet rounded-[var(--radius-card)] border border-line bg-card p-8 shadow-[0_8px_30px_rgba(120,90,40,0.07)] sm:p-10">
        {/* document header */}
        <header className="flex items-start justify-between border-b border-line pb-5">
          <div>
            <div className="flex items-baseline gap-2">
              <span className="font-display text-[22px] font-semibold italic tracking-tight text-ink">Jarvis</span>
              <span className="text-[12px] font-medium uppercase tracking-[0.18em] text-faint">Clinical handover</span>
            </div>
            <h1 className="mt-2 font-display text-[26px] font-semibold leading-none text-ink">{patient}</h1>
            <p className="mt-1.5 text-[13.5px] text-muted">
              {[ident?.living_arrangement, ident?.location].filter(Boolean).join("  ·  ")}
            </p>
          </div>
          <div className="text-right">
            <span className={`rounded-full px-3 py-1 text-[12px] font-bold uppercase tracking-wide ${TRIAGE_STYLE[triage] ?? "bg-paper text-muted"}`}>
              {triage === "emergency" ? "Emergency · no response" : triage}
            </span>
            <p className="mt-2 text-[12px] text-faint">Onset {when}</p>
            <p className="text-[12px] text-faint">Report {fmt(incident.report_generated_at)}</p>
          </div>
        </header>

        {/* 1. caregiver summary */}
        <Section title="For the caregiver">
          <p className="text-[15px] leading-relaxed text-ink">{r.caregiver_summary.what_happened}</p>
          <p className="mt-2 text-[14px] leading-relaxed text-muted">{r.caregiver_summary.why_it_matters}</p>
          <div className="mt-4 rounded-[14px] border border-accent/25 bg-accent-soft/40 p-4">
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-accent">Do now</p>
            <ul className="space-y-1.5">
              {r.caregiver_summary.do_now.map((a, i) => (
                <li key={i} className="flex gap-2 text-[14px] text-ink">
                  <span className="text-accent">☐</span>
                  <span>{a}</span>
                </li>
              ))}
            </ul>
          </div>
        </Section>

        {/* 2. red flags (if any) */}
        {r.red_flags.length > 0 && (
          <Section title="Red flags">
            <ul className="space-y-1.5">
              {r.red_flags.map((f, i) => (
                <li key={i} className="flex gap-2 text-[14px] font-medium text-danger">
                  <span>▲</span>
                  <span>{f}</span>
                </li>
              ))}
            </ul>
          </Section>
        )}

        {/* 3. SBAR */}
        <Section title="Clinical summary (SBAR)">
          <dl className="space-y-3">
            <Sbar k="Situation" v={r.sbar.situation} />
            <Sbar k="Background" v={r.sbar.background} />
            <Sbar k="Assessment" v={r.sbar.assessment} />
            <Sbar k="Recommendation" v={r.sbar.recommendation} />
          </dl>
        </Section>

        {/* 4. paramedic handover */}
        <Section title="Paramedic / doctor handover">
          <div className="grid grid-cols-1 gap-x-8 gap-y-3 sm:grid-cols-2">
            <Field k="Presenting" v={h.presenting} />
            <Field k="Key history" v={h.key_history} />
            <Field k="Medications" v={h.medications} />
            <Field k="Allergies" v={h.allergies} />
            <Field k="Code status / ACP" v={h.code_status} />
            <Field k="Mobility" v={h.mobility} />
            <Field k="Caregiver" v={h.caregiver_contact || (caregiver?.name ? `${caregiver.name}` : "Not on file")} />
          </div>
        </Section>

        {/* footer / disclaimer */}
        <footer className="mt-7 border-t border-line pt-4">
          <p className="text-[12.5px] italic text-faint">{r.confidence_note}</p>
          <p className="mt-1 text-[12.5px] text-faint">
            Generated by Jarvis from Madam Tan&apos;s interRAI record + this health check.
            <strong className="text-muted"> Not a diagnosis — decision support only; a clinician decides.</strong>
          </p>
        </footer>
      </article>
    </main>
  );
}

/* ---------- pieces ---------- */

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-6">
      <h2 className="mb-2.5 font-display text-[17px] font-semibold tracking-tight text-ink">{title}</h2>
      {children}
    </section>
  );
}

function Sbar({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex gap-3">
      <dt className="w-[110px] shrink-0 text-[12px] font-semibold uppercase tracking-[0.1em] text-faint">{k}</dt>
      <dd className="flex-1 text-[14px] leading-relaxed text-ink">{v}</dd>
    </div>
  );
}

function Field({ k, v }: { k: string; v: string }) {
  return (
    <div className="border-b border-line/70 pb-2">
      <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-faint">{k}</p>
      <p className="mt-0.5 text-[14px] text-ink">{v}</p>
    </div>
  );
}

function Notice({ children }: { children: React.ReactNode }) {
  return (
    <main className="grid min-h-dvh place-items-center px-6">
      <div className="text-center font-display text-[18px] italic text-muted">{children}</div>
    </main>
  );
}
