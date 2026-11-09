import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { readStoredFile } from "@/lib/storage";

export const runtime = "nodejs";

// The company logo is the only file served without a session (it appears on shared documents).
export async function GET() {
  const settings = await db.companySettings.findUnique({ where: { id: 1 } });
  if (!settings?.logoFileId) return new NextResponse(null, { status: 404 });
  const file = await readStoredFile(settings.logoFileId);
  if (!file || !file.mimeType.startsWith("image/")) return new NextResponse(null, { status: 404 });
  return new NextResponse(new Uint8Array(file.buffer), {
    headers: {
      "Content-Type": file.mimeType,
      "Cache-Control": "public, max-age=300",
      "X-Content-Type-Options": "nosniff",
      ...(file.mimeType === "image/svg+xml" ? { "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'" } : {}),
    },
  });
}
