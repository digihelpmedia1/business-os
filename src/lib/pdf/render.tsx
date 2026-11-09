import "server-only";
import path from "node:path";
import { readFile } from "node:fs/promises";
import React from "react";
import { Document, Font, Image, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";
import type { CompanySettings } from "@prisma/client";
import { amountInWords, D, formatMoney } from "@/lib/money";
import type { PreviewDoc } from "@/components/billing/doc-preview";

let fontsRegistered = false;
function registerFonts() {
  if (fontsRegistered) return;
  const dir = path.join(process.cwd(), "src", "assets", "fonts");
  Font.register({
    family: "Noto Sans",
    fonts: [
      { src: path.join(dir, "NotoSans-Regular.ttf"), fontWeight: 400 },
      { src: path.join(dir, "NotoSans-SemiBold.ttf"), fontWeight: 600 },
    ],
  });
  Font.registerHyphenationCallback((word) => [word]);
  fontsRegistered = true;
}

const s = StyleSheet.create({
  page: { fontFamily: "Noto Sans", fontSize: 9, color: "#172033", paddingTop: 0, paddingBottom: 36, paddingHorizontal: 0 },
  band: { height: 5, flexDirection: "row" },
  body: { paddingHorizontal: 36, paddingTop: 24 },
  row: { flexDirection: "row" },
  between: { flexDirection: "row", justifyContent: "space-between" },
  muted: { color: "#667085" },
  small: { fontSize: 8 },
  h1: { fontSize: 18, fontWeight: 600 },
  label: { fontSize: 7, fontWeight: 600, color: "#667085", textTransform: "uppercase", letterSpacing: 0.6 },
  box: { backgroundColor: "#F5F7FA", borderRadius: 4, padding: 10, marginTop: 16 },
  th: { color: "#FFFFFF", fontWeight: 600, paddingVertical: 5, paddingHorizontal: 5 },
  td: { paddingVertical: 5, paddingHorizontal: 5 },
  tr: { flexDirection: "row", borderBottomWidth: 0.5, borderBottomColor: "#EAECF0" },
  right: { textAlign: "right" },
  section: { marginTop: 10 },
  footer: { position: "absolute", bottom: 16, left: 36, right: 36, flexDirection: "row", justifyContent: "space-between", fontSize: 7, color: "#98A2B3" },
});

function DocPdf({ doc, company, logo }: { doc: PreviewDoc; company: CompanySettings; logo: Buffer | null }) {
  const brand = company.primaryColor || "#005CFF";
  const accent = company.secondaryColor || "#F65000";
  const address = [company.addressLine1, company.addressLine2, [company.city, company.state, company.pincode].filter(Boolean).join(", "), company.country].filter(Boolean).join(", ");
  const hasDisc = doc.items.some((i) => Number(i.discountPercent.toString()) > 0);
  const cols = { n: 18, desc: 0, sac: 46, qty: 46, rate: 66, disc: hasDisc ? 36 : 0, gst: doc.gstApplicable ? 34 : 0, amt: 72 };
  const intro = doc.sections.find((x) => x.title === "Introduction" && x.body);
  return (
    <Document title={`${doc.heading} ${doc.number}`} author={company.companyName} creator="DHM Business OS">
      <Page size="A4" style={s.page} wrap>
        <View style={s.band} fixed>
          <View style={{ flex: 3, backgroundColor: brand }} />
          <View style={{ flex: 1, backgroundColor: accent }} />
        </View>
        <View style={s.body}>
          <View style={s.between}>
            <View style={{ maxWidth: 270 }}>
              {logo ? <Image src={logo} style={{ height: 34, objectFit: "contain", marginBottom: 6, alignSelf: "flex-start" }} /> : (
                <View style={{ width: 30, height: 30, borderRadius: 6, backgroundColor: brand, alignItems: "center", justifyContent: "center", marginBottom: 6 }}>
                  <Text style={{ color: "#fff", fontWeight: 600, fontSize: 10 }}>DH</Text>
                </View>
              )}
              <Text style={{ fontSize: 12, fontWeight: 600 }}>{company.legalName || company.companyName}</Text>
              {address ? <Text style={[s.muted, { marginTop: 2 }]}>{address}</Text> : null}
              <Text style={s.muted}>{[company.email, company.phone, company.website?.replace(/^https?:\/\//, "").replace(/\/$/, "")].filter(Boolean).join(" · ")}</Text>
              {company.gstRegistered && company.gstin ? <Text>GSTIN: {company.gstin}</Text> : null}
              {company.pan ? <Text>PAN: {company.pan}</Text> : null}
            </View>
            <View style={{ alignItems: "flex-end" }}>
              <Text style={[s.h1, { color: brand }]}>{doc.heading}</Text>
              <Text style={{ marginTop: 2, fontSize: 10 }}>{doc.number}</Text>
              <View style={{ marginTop: 6 }}>
                {doc.meta.map((m) => (
                  <Text key={m.label} style={s.right}>
                    <Text style={s.muted}>{m.label}: </Text>
                    {m.value}
                  </Text>
                ))}
              </View>
            </View>
          </View>

          <View style={s.box}>
            <Text style={s.label}>Bill to</Text>
            <Text style={{ fontWeight: 600, marginTop: 2, fontSize: 10 }}>{doc.billTo.name}</Text>
            {doc.billTo.lines.filter(Boolean).map((l, i) => (
              <Text key={i} style={{ color: "#475467" }}>{l}</Text>
            ))}
          </View>

          {intro ? <Text style={{ marginTop: 12, lineHeight: 1.5, color: "#344054" }}>{intro.body}</Text> : null}

          <View style={{ marginTop: 14 }}>
            <View style={[s.row, { backgroundColor: brand, borderRadius: 3 }]} fixed>
              <Text style={[s.th, { width: cols.n }]}>#</Text>
              <Text style={[s.th, { flex: 1 }]}>Description</Text>
              <Text style={[s.th, { width: cols.sac }]}>SAC</Text>
              <Text style={[s.th, s.right, { width: cols.qty }]}>Qty</Text>
              <Text style={[s.th, s.right, { width: cols.rate }]}>Rate</Text>
              {hasDisc ? <Text style={[s.th, s.right, { width: cols.disc }]}>Disc</Text> : null}
              {doc.gstApplicable ? <Text style={[s.th, s.right, { width: cols.gst }]}>GST</Text> : null}
              <Text style={[s.th, s.right, { width: cols.amt }]}>Amount</Text>
            </View>
            {doc.items.map((it, i) => (
              <View key={i} style={s.tr} wrap={false}>
                <Text style={[s.td, s.muted, { width: cols.n }]}>{i + 1}</Text>
                <View style={[s.td, { flex: 1 }]}>
                  <Text style={{ fontWeight: 600 }}>{it.description}</Text>
                  {it.details ? <Text style={[s.muted, s.small]}>{it.details}</Text> : null}
                </View>
                <Text style={[s.td, { width: cols.sac }]}>{it.sacCode || "—"}</Text>
                <Text style={[s.td, s.right, { width: cols.qty }]}>{Number(it.quantity.toString())} {it.unit ?? ""}</Text>
                <Text style={[s.td, s.right, { width: cols.rate }]}>{formatMoney(it.unitPrice)}</Text>
                {hasDisc ? <Text style={[s.td, s.right, { width: cols.disc }]}>{Number(it.discountPercent.toString())}%</Text> : null}
                {doc.gstApplicable ? <Text style={[s.td, s.right, { width: cols.gst }]}>{Number(it.taxRate.toString())}%</Text> : null}
                <Text style={[s.td, s.right, { width: cols.amt, fontWeight: 600 }]}>{formatMoney(it.taxableAmount)}</Text>
              </View>
            ))}
          </View>

          <View style={[s.between, { marginTop: 10 }]} wrap={false}>
            <View style={{ maxWidth: 260 }}>
              <Text style={s.label}>Amount in words</Text>
              <Text style={{ marginTop: 2, fontWeight: 600 }}>{amountInWords(doc.totals.total)}</Text>
            </View>
            <View style={{ width: 210 }}>
              <TotalRow label="Subtotal" value={formatMoney(doc.totals.subtotal)} />
              {D(doc.totals.discountTotal).gt(0) ? <TotalRow label="Discount" value={`− ${formatMoney(doc.totals.discountTotal)}`} /> : null}
              <TotalRow label="Taxable value" value={formatMoney(doc.totals.taxableAmount)} />
              {doc.gstApplicable ? (
                doc.isInterState ? (
                  <TotalRow label="IGST" value={formatMoney(doc.totals.igstAmount ?? doc.totals.taxTotal)} />
                ) : (
                  <>
                    <TotalRow label="CGST" value={formatMoney(doc.totals.cgstAmount ?? D(doc.totals.taxTotal).dividedBy(2))} />
                    <TotalRow label="SGST" value={formatMoney(doc.totals.sgstAmount ?? D(doc.totals.taxTotal).dividedBy(2))} />
                  </>
                )
              ) : null}
              {!D(doc.totals.roundOff).isZero() ? <TotalRow label="Round off" value={formatMoney(doc.totals.roundOff)} /> : null}
              <View style={[s.between, { backgroundColor: brand, borderRadius: 3, paddingVertical: 5, paddingHorizontal: 6, marginTop: 3 }]}>
                <Text style={{ color: "#fff", fontWeight: 600, fontSize: 10 }}>Total</Text>
                <Text style={{ color: "#fff", fontWeight: 600, fontSize: 10 }}>{formatMoney(doc.totals.total)}</Text>
              </View>
              {doc.totals.paid && D(doc.totals.paid).gt(0) ? (
                <>
                  <TotalRow label="Paid / settled" value={formatMoney(doc.totals.paid)} />
                  <TotalRow label="Balance due" value={formatMoney(doc.totals.balance ?? 0)} bold />
                </>
              ) : null}
            </View>
          </View>

          {doc.sections.filter((x) => x.body && x.title !== "Introduction").map((x) => (
            <View key={x.title} style={s.section} wrap>
              <Text style={[s.label, { color: brand }]}>{x.title}</Text>
              <Text style={{ marginTop: 2, lineHeight: 1.5, color: "#344054" }}>{x.body}</Text>
            </View>
          ))}

          <View style={[s.between, { marginTop: 22, borderTopWidth: 0.5, borderTopColor: "#EAECF0", paddingTop: 10 }]} wrap={false}>
            {doc.showBank && (company.bankAccountNumber || company.upiId) ? (
              <View>
                <Text style={s.label}>Payment details</Text>
                {company.bankName ? <Text style={{ marginTop: 2 }}>{company.bankName}{company.bankBranch ? `, ${company.bankBranch}` : ""}</Text> : null}
                {company.bankAccountName ? <Text>A/c name: {company.bankAccountName}</Text> : null}
                {company.bankAccountNumber ? <Text>A/c no: {company.bankAccountNumber}</Text> : null}
                {company.bankIfsc ? <Text>IFSC: {company.bankIfsc}</Text> : null}
                {company.upiId ? <Text>UPI: {company.upiId}</Text> : null}
              </View>
            ) : <View />}
            <View style={{ alignItems: "flex-end" }}>
              <Text style={s.muted}>For {company.legalName || company.companyName}</Text>
              <View style={{ height: 36 }} />
              <Text style={{ borderTopWidth: 0.5, borderTopColor: "#D0D5DD", paddingTop: 2, fontWeight: 600 }}>{company.signatoryName || "Authorised Signatory"}</Text>
              {company.signatoryDesignation ? <Text style={s.muted}>{company.signatoryDesignation}</Text> : null}
            </View>
          </View>
          {company.invoiceFooter ? <Text style={[s.muted, { marginTop: 14, textAlign: "center", fontSize: 7.5 }]}>{company.invoiceFooter}</Text> : null}
        </View>
        {doc.watermark ? (
          <Text fixed style={{ position: "absolute", top: 380, left: 120, fontSize: 64, color: "#172033", opacity: 0.06, transform: "rotate(-24deg)", fontWeight: 600 }}>
            {doc.watermark.toUpperCase()}
          </Text>
        ) : null}
        <View style={s.footer} fixed>
          <Text>{company.companyName} · {doc.heading} {doc.number}</Text>
          <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}

function TotalRow({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <View style={[s.between, { paddingVertical: 1.5, paddingHorizontal: 6 }]}>
      <Text style={bold ? { fontWeight: 600 } : s.muted}>{label}</Text>
      <Text style={bold ? { fontWeight: 600 } : undefined}>{value}</Text>
    </View>
  );
}

export async function renderDocPdf(doc: PreviewDoc, company: CompanySettings, logo: Buffer | null) {
  registerFonts();
  return renderToBuffer(<DocPdf doc={doc} company={company} logo={logo} />);
}

/** Small A5-ish receipt PDF. */
export async function renderReceiptPdf(r: {
  company: CompanySettings;
  logo: Buffer | null;
  receiptNumber: string;
  date: string;
  clientName: string;
  clientLines: (string | null)[];
  invoiceNumber: string;
  invoiceTotal: string;
  amount: string;
  tds: string;
  method: string;
  reference: string | null;
  balance: string;
  voided: boolean;
}) {
  registerFonts();
  const brand = r.company.primaryColor || "#005CFF";
  const el = (
    <Document title={`Receipt ${r.receiptNumber}`} author={r.company.companyName}>
      <Page size="A5" orientation="landscape" style={s.page}>
        <View style={s.band}><View style={{ flex: 3, backgroundColor: brand }} /><View style={{ flex: 1, backgroundColor: r.company.secondaryColor || "#F65000" }} /></View>
        <View style={s.body}>
          <View style={s.between}>
            <View>
              {r.logo ? <Image src={r.logo} style={{ height: 26, objectFit: "contain", marginBottom: 4, alignSelf: "flex-start" }} /> : null}
              <Text style={{ fontSize: 11, fontWeight: 600 }}>{r.company.legalName || r.company.companyName}</Text>
              {r.company.gstRegistered && r.company.gstin ? <Text style={s.muted}>GSTIN: {r.company.gstin}</Text> : null}
            </View>
            <View style={{ alignItems: "flex-end" }}>
              <Text style={[s.h1, { color: brand }]}>Payment Receipt</Text>
              <Text>{r.receiptNumber}</Text>
              <Text style={s.muted}>Date: {r.date}</Text>
            </View>
          </View>
          <View style={s.box}>
            <Text style={s.label}>Received from</Text>
            <Text style={{ fontWeight: 600, fontSize: 10 }}>{r.clientName}</Text>
            {r.clientLines.filter(Boolean).map((l, i) => <Text key={i} style={s.muted}>{l}</Text>)}
          </View>
          <View style={{ marginTop: 12 }}>
            <TotalRow label="Against invoice" value={`${r.invoiceNumber} (total ${r.invoiceTotal})`} />
            <TotalRow label="Payment method" value={r.method + (r.reference ? ` · Ref ${r.reference}` : "")} />
            <TotalRow label="Amount received" value={r.amount} bold />
            {r.tds !== formatMoney(0) ? <TotalRow label="TDS deducted" value={r.tds} /> : null}
            <TotalRow label="Balance on invoice after this payment" value={r.balance} />
            <Text style={{ marginTop: 8, fontWeight: 600 }}>{amountInWords(r.amount.replace(/[^\d.]/g, ""))}</Text>
          </View>
          <View style={{ alignItems: "flex-end", marginTop: 18 }}>
            <Text style={s.muted}>For {r.company.legalName || r.company.companyName}</Text>
            <View style={{ height: 26 }} />
            <Text style={{ fontWeight: 600 }}>{r.company.signatoryName || "Authorised Signatory"}</Text>
          </View>
        </View>
        {r.voided ? <Text style={{ position: "absolute", top: 150, left: 170, fontSize: 60, color: "#D92D20", opacity: 0.15, transform: "rotate(-20deg)" }}>VOID</Text> : null}
      </Page>
    </Document>
  );
  return renderToBuffer(el);
}
