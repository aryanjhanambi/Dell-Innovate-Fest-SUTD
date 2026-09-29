import { NextResponse } from "next/server";
import { getIncident, getProfile, saveReport } from "@/lib/db";
import { generateHealthReport } from "@/lib/openai";

export const dynamic = "force-dynamic";

// POST /api/report/:id  — synthesize (or return cached) the clinical report for an incident.
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const idNum = Number(id);
    if (!Number.isFinite(idNum)) {
      return NextResponse.json({ error: "invalid incident id" }, { status: 400 });
    }

    const incident = await getIncident(idNum);
    if (!incident) {
      return NextResponse.json({ error: "incident not found" }, { status: 404 });
    }
    // Idempotent: already generated → return the cached report, no second LLM call.
    if (incident.report) {
      return NextResponse.json({ report: incident.report, cached: true });
    }

    const profile = await getProfile(incident.senior_id ?? "mdm-tan");
    const { report, model } = await generateHealthReport(incident, profile);
    await saveReport(idNum, report, model);
    return NextResponse.json({ report, cached: false });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
