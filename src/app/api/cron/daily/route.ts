import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { runScheduledJobs } from "@/lib/jobs";

export const runtime = "nodejs";
export const maxDuration = 60;

// Called once a day by Vercel Cron (see vercel.json) — generates recurring invoices,
// expires stale quotations and refreshes reminders. Protected by CRON_SECRET.
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const header = req.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  if (!secret || header.length !== expected.length || !timingSafeEqual(Buffer.from(header), Buffer.from(expected))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const result = await runScheduledJobs();
  return NextResponse.json({ ok: true, ...result, ranAt: new Date().toISOString() });
}
