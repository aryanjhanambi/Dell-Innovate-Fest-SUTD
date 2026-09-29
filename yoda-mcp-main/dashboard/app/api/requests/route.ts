import { NextResponse } from "next/server";
import { decideRequest } from "@/lib/db";

// Caregiver approves/declines a request: { id: number, decision: "approve" | "decline" }
export async function POST(req: Request) {
  try {
    const { id, decision } = await req.json();
    // Neon returns bigserial ids as strings, so coerce (accept number or numeric string).
    const idNum = typeof id === "number" ? id : Number(id);
    if (!Number.isFinite(idNum) || (decision !== "approve" && decision !== "decline")) {
      return NextResponse.json({ error: "id (number|numeric string) and decision (approve|decline) required" }, { status: 400 });
    }
    await decideRequest(idNum, decision);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
