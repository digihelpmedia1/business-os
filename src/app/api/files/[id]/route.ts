import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { readStoredFile } from "@/lib/storage";
import { audit } from "@/lib/audit";

export const runtime = "nodejs";

/** Authenticated download of a stored file. Access follows the module the file belongs to. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const docs = await db.document.findMany({ where: { fileId: id, deletedAt: null }, select: { id: true, title: true, category: true, employeeId: true } });
  const settings = await db.companySettings.findUnique({ where: { id: 1 } });
  const isBrandAsset = settings?.logoFileId === id || settings?.signatureFileId === id;
  let allowed = isBrandAsset;
  if (!allowed && docs.length) {
    allowed = docs.some((d) =>
      d.category === "EMPLOYEE" ? can(user.access, "team") && can(user.access, "vault") : can(user.access, "vault"),
    );
  }
  if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const file = await readStoredFile(id);
  if (!file) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const download = new URL(req.url).searchParams.get("download") === "1";
  if (docs[0]) {
    await audit({ userId: user.id, action: "DOWNLOAD", entityType: "Document", entityId: docs[0].id, summary: `Opened “${docs[0].title}”` });
  }
  const inlineSafe = ["application/pdf", "image/png", "image/jpeg", "image/webp", "image/gif", "text/plain"].includes(file.mimeType);
  return new NextResponse(new Uint8Array(file.buffer), {
    headers: {
      "Content-Type": file.mimeType,
      "Content-Disposition": `${download || !inlineSafe ? "attachment" : "inline"}; filename="${encodeURIComponent(file.fileName)}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox",
    },
  });
}
