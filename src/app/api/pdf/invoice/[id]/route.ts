import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { getSettings } from "@/lib/settings";
import { companyLogo } from "@/lib/storage";
import { renderDocPdf } from "@/lib/pdf/render";
import { invoicePreview } from "@/server/services/doc-models";

export const runtime = "nodejs";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user || !can(user.access, "billing")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { id } = await params;
  const inv = await db.invoice.findUnique({ where: { id }, include: { items: { orderBy: { sortOrder: "asc" } }, client: true, relatedInvoice: true } });
  if (!inv || inv.deletedAt) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const [settings, logo] = await Promise.all([getSettings(), companyLogo()]);
  const pdf = await renderDocPdf(invoicePreview(inv, settings), settings, logo);
  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${(inv.number ?? "draft-invoice").replace(/\//g, "-")}.pdf"`,
      "Cache-Control": "private, no-store",
    },
  });
}
