import { NextResponse } from "next/server";
import { recordPoll } from "@/lib/db";

export const dynamic = "force-dynamic";

// GET /api/device/poll?senior=…&ip=…&token=…  — the NECKLACE calls this every ~2s.
// Records it's alive (+ its LAN IP), returns pending commands, clears the one-shot ping.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const token = req.headers.get("x-device-token") ?? url.searchParams.get("token");
  if (!process.env.DEVICE_TOKEN || token !== process.env.DEVICE_TOKEN) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const senior = url.searchParams.get("senior") ?? "mdm-tan";
  const ip = url.searchParams.get("ip");
  try {
    const cmd = await recordPoll(senior, ip);
    return NextResponse.json(cmd); // { ping, camera }
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
