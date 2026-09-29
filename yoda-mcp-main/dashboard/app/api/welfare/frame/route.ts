import { NextResponse } from "next/server";
import { getWelfareFrame } from "@/lib/db";

export const dynamic = "force-dynamic";

// GET /api/welfare/frame?senior=…  — the DASHBOARD reads the latest relayed photo + online status.
export async function GET(req: Request) {
  const senior = new URL(req.url).searchParams.get("senior") ?? "mdm-tan";
  try {
    return NextResponse.json(await getWelfareFrame(senior));
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
