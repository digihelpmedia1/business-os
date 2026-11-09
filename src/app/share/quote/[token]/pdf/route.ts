import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { companyLogo } from "@/lib/storage";
import { renderDocPdf } from "@/lib/pdf/render";
import { quotePreview } from "@/server/services/doc-models";

export const runtime = "nodejs";

export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!/^[\w-]{20,64}$/.test(token)) return new NextResponse("Not found", { status: 404 });
  const q = await db.quote.findUnique({ where: { shareToken: token }, include: { items: { orderBy: { sortOrder: "asc" } }, client: true } });
  if (!q || q.deletedAt) return new NextResponse("Not found", { status: 404 });
  const [settings, logo] = await Promise.all([getSettings(), companyLogo()]);
  const pdf = await renderDocPdf(quotePreview(q), settings, logo);
  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${q.number.replace(/\//g, "-")}.pdf"`,
      "Cache-Control": "private, no-store",
      "X-Robots-Tag": "noindex",
    },
  });
}
