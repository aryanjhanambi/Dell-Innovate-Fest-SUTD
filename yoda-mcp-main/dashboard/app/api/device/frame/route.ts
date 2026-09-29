import { NextResponse } from "next/server";
import { saveFrame } from "@/lib/db";

export const dynamic = "force-dynamic";

// POST /api/device/frame?senior=…&token=…  — the NECKLACE uploads a JPEG (raw bytes, image/jpeg).
export async function POST(req: Request) {
  const url = new URL(req.url);
  const token = req.headers.get("x-device-token") ?? url.searchParams.get("token");
  if (!process.env.DEVICE_TOKEN || token !== process.env.DEVICE_TOKEN) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const senior = url.searchParams.get("senior") ?? "mdm-tan";
  try {
    const buf = Buffer.from(await req.arrayBuffer());
    if (buf.length === 0) {
      return NextResponse.json({ error: "empty body" }, { status: 400 });
    }
    await saveFrame(senior, buf.toString("base64"));
    return NextResponse.json({ ok: true, bytes: buf.length });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
