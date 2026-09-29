import { NextResponse } from "next/server";
import { getProfile, listRequests, listHealthIncidents } from "@/lib/db";

// Always read fresh from Neon — the dashboard polls this for live updates.
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const [profile, requests, incidents] = await Promise.all([
      getProfile("mdm-tan"),
      listRequests("mdm-tan"),
      listHealthIncidents("mdm-tan"),
    ]);
    return NextResponse.json({ profile, requests, incidents, at: Date.now() });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
