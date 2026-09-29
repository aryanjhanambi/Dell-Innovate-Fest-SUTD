import { NextResponse } from "next/server";
import { decideIncident } from "@/lib/db";

// Caregiver acts on a health alert: { id: number, action: "acknowledge" | "resolve" }
export async function POST(req: Request) {
  try {
    const { id, action } = await req.json();
    const idNum = typeof id === "number" ? id : Number(id);
    if (!Number.isFinite(idNum) || (action !== "acknowledge" && action !== "resolve")) {
      return NextResponse.json(
        { error: "id (number|numeric string) and action (acknowledge|resolve) required" },
        { status: 400 },
      );
    }
    await decideIncident(idNum, action);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
