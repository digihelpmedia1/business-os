import type { CompanySettings } from "@prisma/client";
import { formatMoney, amountInWords, D } from "@/lib/money";
import { fmtDate } from "@/lib/dates";
import { stateName } from "@/lib/gst";

export type PreviewItem = {
  description: string;
  details?: string | null;
  sacCode?: string | null;
  quantity: { toString(): string };
  unit?: string | null;
  unitPrice: { toString(): string };
  discountPercent: { toString(): string };
  taxRate: { toString(): string };
  taxableAmount: { toString(): string };
  taxAmount: { toString(): string };
};

export type PreviewDoc = {
  heading: string;
  number: string;
  meta: { label: string; value: string }[];
  billTo: { name: string; lines: (string | null | undefined)[] };
  items: PreviewItem[];
  gstApplicable: boolean;
  isInterState: boolean;
  totals: {
    subtotal: { toString(): string };
    discountTotal: { toString(): string };
    taxableAmount: { toString(): string };
    cgstAmount?: { toString(): string };
    sgstAmount?: { toString(): string };
    igstAmount?: { toString(): string };
    taxTotal: { toString(): string };
    roundOff: { toString(): string };
    total: { toString(): string };
    paid?: { toString(): string };
    balance?: { toString(): string };
  };
  sections: { title: string; body: string | null | undefined }[];
  showBank?: boolean;
  watermark?: string | null;
};

export function DocPreview({ doc, company, logoUrl }: { doc: PreviewDoc; company: CompanySettings; logoUrl?: string | null }) {
  const brand = company.primaryColor || "#005CFF";
  const accent = company.secondaryColor || "#F65000";
  const address = [company.addressLine1, company.addressLine2, [company.city, company.state, company.pincode].filter(Boolean).join(", "), company.country]
    .filter(Boolean)
    .join(", ");
  return (
    <div className="print-page relative mx-auto max-w-[900px] overflow-hidden rounded-xl border border-line bg-white text-[#172033] shadow-[var(--shadow)]">
      {doc.watermark ? (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <span className="rotate-[-24deg] text-7xl font-bold uppercase tracking-widest text-[#172033]/[0.06]">{doc.watermark}</span>
        </div>
      ) : null}
      <div className="h-1.5" style={{ background: `linear-gradient(90deg, ${brand} 0 75%, ${accent} 75% 100%)` }} />
      <div className="p-6 sm:p-10">
        <div className="flex flex-col justify-between gap-6 sm:flex-row">
          <div className="max-w-sm">
            {logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={logoUrl} alt={company.companyName} className="mb-3 h-12 w-auto object-contain" />
            ) : (
              <div className="mb-3 flex items-center gap-2">
                <span className="flex h-10 w-10 items-center justify-center rounded-lg text-sm font-bold text-white" style={{ background: brand }}>DH</span>
              </div>
            )}
            <p className="text-lg font-semibold">{company.legalName || company.companyName}</p>
            {address ? <p className="mt-1 text-[13px] leading-relaxed text-[#667085]">{address}</p> : null}
            <p className="mt-1 text-[13px] text-[#667085]">{[company.email, company.phone, company.website?.replace(/^https?:\/\//, "").replace(/\/$/, "")].filter(Boolean).join(" · ")}</p>
            {company.gstRegistered && company.gstin ? <p className="mt-1 text-[13px]"><span className="text-[#667085]">GSTIN:</span> <span className="font-mono">{company.gstin}</span></p> : null}
            {company.pan ? <p className="text-[13px]"><span className="text-[#667085]">PAN:</span> <span className="font-mono">{company.pan}</span></p> : null}
          </div>
          <div className="sm:text-right">
            <p className="text-2xl font-semibold tracking-tight" style={{ color: brand }}>{doc.heading}</p>
            <p className="mt-1 font-mono text-sm">{doc.number}</p>
            <dl className="mt-3 space-y-0.5 text-[13px]">
              {doc.meta.map((m) => (
                <div key={m.label} className="flex gap-2 sm:justify-end">
                  <dt className="text-[#667085]">{m.label}:</dt>
                  <dd className="font-medium">{m.value}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>

        <div className="mt-8 rounded-lg bg-[#F5F7FA] p-4">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-[#667085]">Bill to</p>
          <p className="mt-1 font-semibold">{doc.billTo.name}</p>
          {doc.billTo.lines.filter(Boolean).map((l, i) => (
            <p key={i} className="text-[13px] text-[#475467]">{l}</p>
          ))}
        </div>

        {doc.sections.filter((s) => s.body && ["Introduction"].includes(s.title)).map((s) => (
          <p key={s.title} className="mt-6 whitespace-pre-wrap text-sm leading-relaxed text-[#344054]">{s.body}</p>
        ))}

        <div className="mt-6 overflow-x-auto">
          <table className="w-full min-w-[600px] text-[13px]">
            <thead>
              <tr className="text-left text-white" style={{ background: brand }}>
                <th className="rounded-l-md px-3 py-2 font-medium">#</th>
                <th className="px-3 py-2 font-medium">Description</th>
                <th className="px-3 py-2 font-medium">SAC</th>
                <th className="px-3 py-2 text-right font-medium">Qty</th>
                <th className="px-3 py-2 text-right font-medium">Rate</th>
                {doc.items.some((i) => Number(i.discountPercent.toString()) > 0) ? <th className="px-3 py-2 text-right font-medium">Disc.</th> : null}
                {doc.gstApplicable ? <th className="px-3 py-2 text-right font-medium">GST</th> : null}
                <th className="rounded-r-md px-3 py-2 text-right font-medium">Amount</th>
              </tr>
            </thead>
            <tbody>
              {doc.items.map((it, i) => (
                <tr key={i} className="border-b border-[#EAECF0] align-top">
                  <td className="px-3 py-2.5 text-[#667085]">{i + 1}</td>
                  <td className="px-3 py-2.5">
                    <p className="font-medium">{it.description}</p>
                    {it.details ? <p className="mt-0.5 whitespace-pre-wrap text-xs text-[#667085]">{it.details}</p> : null}
                  </td>
                  <td className="px-3 py-2.5 font-mono text-xs">{it.sacCode || "—"}</td>
                  <td className="tabular px-3 py-2.5 text-right">{Number(it.quantity.toString())} {it.unit ?? ""}</td>
                  <td className="tabular px-3 py-2.5 text-right">{formatMoney(it.unitPrice)}</td>
                  {doc.items.some((x) => Number(x.discountPercent.toString()) > 0) ? <td className="tabular px-3 py-2.5 text-right">{Number(it.discountPercent.toString())}%</td> : null}
                  {doc.gstApplicable ? <td className="tabular px-3 py-2.5 text-right">{Number(it.taxRate.toString())}%</td> : null}
                  <td className="tabular px-3 py-2.5 text-right font-medium">{formatMoney(it.taxableAmount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-4 flex flex-col-reverse justify-between gap-6 sm:flex-row">
          <div className="max-w-sm text-[13px]">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-[#667085]">Amount in words</p>
            <p className="mt-1 font-medium">{amountInWords(doc.totals.total)}</p>
          </div>
          <dl className="w-full max-w-xs space-y-1 text-[13px]">
            <TRow label="Subtotal" value={formatMoney(doc.totals.subtotal)} />
            {D(doc.totals.discountTotal).gt(0) ? <TRow label="Discount" value={`− ${formatMoney(doc.totals.discountTotal)}`} /> : null}
            <TRow label="Taxable value" value={formatMoney(doc.totals.taxableAmount)} />
            {doc.gstApplicable ? (
              doc.isInterState ? (
                <TRow label="IGST" value={formatMoney(doc.totals.igstAmount ?? doc.totals.taxTotal)} />
              ) : (
                <>
                  <TRow label="CGST" value={formatMoney(doc.totals.cgstAmount ?? D(doc.totals.taxTotal).dividedBy(2))} />
                  <TRow label="SGST" value={formatMoney(doc.totals.sgstAmount ?? D(doc.totals.taxTotal).dividedBy(2))} />
                </>
              )
            ) : null}
            {!D(doc.totals.roundOff).isZero() ? <TRow label="Round off" value={formatMoney(doc.totals.roundOff)} /> : null}
            <div className="flex justify-between rounded-md px-2 py-2 text-base font-semibold text-white" style={{ background: brand }}>
              <dt>Total</dt>
              <dd className="tabular">{formatMoney(doc.totals.total)}</dd>
            </div>
            {doc.totals.paid && D(doc.totals.paid).gt(0) ? (
              <>
                <TRow label="Paid / settled" value={formatMoney(doc.totals.paid)} />
                <TRow label="Balance due" value={formatMoney(doc.totals.balance ?? 0)} strong />
              </>
            ) : null}
          </dl>
        </div>

        <div className="mt-8 space-y-5">
          {doc.sections.filter((s) => s.body && s.title !== "Introduction").map((s) => (
            <div key={s.title}>
              <p className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: brand }}>{s.title}</p>
              <p className="mt-1 whitespace-pre-wrap text-[13px] leading-relaxed text-[#344054]">{s.body}</p>
            </div>
          ))}
        </div>

        <div className="mt-10 flex flex-col justify-between gap-6 border-t border-[#EAECF0] pt-6 sm:flex-row">
          {doc.showBank && (company.bankAccountNumber || company.upiId) ? (
            <div className="text-[13px]">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-[#667085]">Payment details</p>
              {company.bankName ? <p className="mt-1">{company.bankName}{company.bankBranch ? `, ${company.bankBranch}` : ""}</p> : null}
              {company.bankAccountName ? <p>A/c name: {company.bankAccountName}</p> : null}
              {company.bankAccountNumber ? <p>A/c no: <span className="font-mono">{company.bankAccountNumber}</span></p> : null}
              {company.bankIfsc ? <p>IFSC: <span className="font-mono">{company.bankIfsc}</span></p> : null}
              {company.upiId ? <p>UPI: <span className="font-mono">{company.upiId}</span></p> : null}
            </div>
          ) : <div />}
          <div className="text-center text-[13px] sm:text-right">
            <p className="text-[#667085]">For {company.legalName || company.companyName}</p>
            <div className="my-2 h-14" />
            <p className="border-t border-[#D0D5DD] pt-1 font-medium">{company.signatoryName || "Authorised Signatory"}</p>
            {company.signatoryDesignation ? <p className="text-xs text-[#667085]">{company.signatoryDesignation}</p> : null}
          </div>
        </div>
        {company.invoiceFooter ? <p className="mt-6 text-center text-xs text-[#667085]">{company.invoiceFooter}</p> : null}
      </div>
    </div>
  );
}

function TRow({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={`flex justify-between px-2 ${strong ? "font-semibold" : ""}`}>
      <dt className="text-[#667085]">{label}</dt>
      <dd className="tabular">{value}</dd>
    </div>
  );
}

export function placeOfSupplyLabel(code?: string | null) {
  if (!code) return "—";
  return `${code} — ${stateName(code) ?? ""}`;
}

export { fmtDate };
