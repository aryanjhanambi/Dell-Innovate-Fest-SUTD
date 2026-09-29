"use client";

import { useState } from "react";
import type { HealthReport } from "@/lib/db";

/* Print + copy-to-clipboard for the handover. The copy text is plain SBAR a caregiver can
   paste into a WhatsApp/SMS to a doctor, or a responder can read off a phone. */

function plainText(report: HealthReport, patient: string, triage: string, when: string): string {
  const h = report.paramedic_handover;
  return [
    `JARVIS HEALTH HANDOVER — ${patient}`,
    `Triage: ${triage.toUpperCase()}   ·   ${when}`,
    ``,
    `SITUATION: ${report.sbar.situation}`,
    `BACKGROUND: ${report.sbar.background}`,
    `ASSESSMENT: ${report.sbar.assessment}`,
    `RECOMMENDATION: ${report.sbar.recommendation}`,
    ``,
    `— PARAMEDIC HANDOVER —`,
    `Presenting: ${h.presenting}`,
    `History: ${h.key_history}`,
    `Medications: ${h.medications}`,
    `Allergies: ${h.allergies}`,
    `Code status / ACP: ${h.code_status}`,
    `Mobility: ${h.mobility}`,
    `Caregiver: ${h.caregiver_contact}`,
    ``,
    report.red_flags.length ? `RED FLAGS:\n${report.red_flags.map((f) => `- ${f}`).join("\n")}` : `RED FLAGS: none noted`,
    ``,
    report.confidence_note,
    `Not a diagnosis — decision support only.`,
  ].join("\n");
}

export default function ReportActions({
  report,
  patient,
  triage,
  when,
}: {
  report: HealthReport;
  patient: string;
  triage: string;
  when: string;
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(plainText(report, patient, triage, when));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard may be blocked; ignore */
    }
  }

  return (
    <div className="no-print flex items-center gap-2.5">
      <button
        onClick={copy}
        className="rounded-full border border-line bg-card px-4 py-2 text-[13.5px] font-medium text-muted transition-colors hover:bg-paper"
      >
        {copied ? "Copied ✓" : "Copy for doctor"}
      </button>
      <button
        onClick={() => window.print()}
        className="inline-flex items-center gap-1.5 rounded-full bg-ink px-5 py-2 text-[13.5px] font-semibold text-white transition-transform hover:scale-[1.02]"
      >
        Print / Save PDF
      </button>
    </div>
  );
}
