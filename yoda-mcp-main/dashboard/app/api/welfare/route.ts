import { NextResponse } from "next/server";
import { setWelfareCommand } from "@/lib/db";

export const dynamic = "force-dynamic";

// POST /api/welfare  { senior?, action: "ping" | "camera_on" | "camera_off" }
// The CAREGIVER sets a command; the necklace picks it up on its next poll.
export async function POST(req: Request) {
  try {
    const { senior = "mdm-tan", action } = await req.json();
    if (action !== "ping" && action !== "camera_on" && action !== "camera_off") {
      return NextResponse.json({ error: "action must be ping | camera_on | camera_off" }, { status: 400 });
    }
    await setWelfareCommand(senior, action);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
