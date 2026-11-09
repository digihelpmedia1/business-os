import { notFound } from "next/navigation";
import { Download } from "lucide-react";
import { db } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { DocPreview } from "@/components/billing/doc-preview";
import { quotePreview } from "@/server/services/doc-models";
import { PrintButton } from "@/components/ui/client-buttons";
import { LinkButton } from "@/components/ui/button";

export const metadata = { title: "Document", robots: { index: false, follow: false } };

export default async function SharedQuote({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!/^[\w-]{20,64}$/.test(token)) notFound();
  const q = await db.quote.findUnique({ where: { shareToken: token }, include: { items: { orderBy: { sortOrder: "asc" } }, client: true } });
  if (!q || q.deletedAt) notFound();
  const settings = await getSettings();
  return (
    <div className="min-h-screen bg-bg px-4 py-8">
      <div className="no-print mx-auto mb-4 flex max-w-[900px] items-center justify-between gap-3">
        <p className="text-sm text-muted">{settings.companyName} shared this document with you.</p>
        <div className="flex gap-2">
          <PrintButton />
          <LinkButton href={`/share/quote/${token}/pdf`} target="_blank"><Download /> Download PDF</LinkButton>
        </div>
      </div>
      <DocPreview doc={{ ...quotePreview(q), watermark: q.status === "DRAFT" ? "Draft" : null }} company={settings} logoUrl={settings.logoFileId ? "/api/public/logo" : null} />
    </div>
  );
}
