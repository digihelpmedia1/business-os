import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await db.$queryRaw`SELECT 1`;
    return NextResponse.json({ ok: true, database: "up", time: new Date().toISOString() });
  } catch {
    return NextResponse.json({ ok: false, database: "down" }, { status: 503 });
  }
}
