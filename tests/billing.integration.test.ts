// End-to-end financial flow against a real PostgreSQL database.
// Run: TEST_DATABASE_URL=postgresql://… npx vitest run tests/billing.integration.test.ts
// The database is wiped by this test — never point it at production.
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const hasDb = !!process.env.TEST_DATABASE_URL;

describe.skipIf(!hasDb)("billing & finance flow (integration)", async () => {
  const { db } = await import("@/lib/db");
  const billing = await import("@/server/services/billing");
  const reports = await import("@/lib/finance/reports");
  const { recalcVendorBill, accountBalances } = await import("@/lib/finance/ledger");
  const { toDateOnly } = await import("@/lib/dates");

  let userId: string;
  let clientId: string;
  let otherStateClientId: string;
  let accountId: string;
  const range = { from: toDateOnly("2026-10-01"), to: toDateOnly("2026-10-31") };

  const item = (price: string, rate = "18") => ({ serviceId: null, description: "Meta Ads Management", details: null, sacCode: "998361", unit: "Month", quantity: "1", unitPrice: price, discountPercent: "0", taxRate: rate });
  const base = { projectId: null, relatedInvoiceId: null, issueDate: "2026-10-05", dueDate: "2026-10-20", placeOfSupply: null, periodLabel: null, reverseCharge: false, paymentTerms: null, notes: null, terms: null, reason: null };

  beforeAll(async () => {
    const tables = await db.$queryRaw<{ tablename: string }[]>`SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
    await db.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(", ")} RESTART IDENTITY CASCADE`);
    const role = await db.role.create({ data: { name: "Admin", isSystem: true } });
    userId = (await db.user.create({ data: { name: "T", email: "t@test.local", passwordHash: "x", roleId: role.id } })).id;
    await db.companySettings.create({ data: { id: 1, stateCode: "27", gstRegistered: false, roundOffTotals: true } });
    clientId = (await db.client.create({ data: { name: "Acme", stateCode: "27" } })).id;
    otherStateClientId = (await db.client.create({ data: { name: "Beta", stateCode: "29", gstin: "29ABCDE1234F1Z5" } })).id;
    accountId = (await db.account.create({ data: { name: "HDFC Current", openingBalance: "100000", openingDate: toDateOnly("2026-04-01") } })).id;
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  it("refuses a GST tax invoice when the company is not GST-registered", async () => {
    await expect(db.$transaction((tx) => billing.createInvoice(tx, { ...base, type: "TAX_INVOICE", clientId, items: [item("10000")] }, userId))).rejects.toThrow(/GST registration/);
  });

  it("issues a Non-GST invoice with no tax and a gap-free number", async () => {
    const inv = await db.$transaction(async (tx) => {
      const draft = await billing.createInvoice(tx, { ...base, type: "NON_GST", clientId, items: [item("10000")] }, userId);
      expect(draft.number).toBeNull();
      return billing.issueInvoice(tx, draft.id, userId);
    });
    expect(inv.number).toBe("BOS/26-27/0001");
    expect(inv.taxTotal.toFixed(2)).toBe("0.00");
    expect(inv.total.toFixed(2)).toBe("10000.00");
  });

  it("computes CGST/SGST vs IGST after GST registration", async () => {
    await db.companySettings.update({ where: { id: 1 }, data: { gstRegistered: true, gstin: "27ABCDE1234F1Z5" } });
    const intra = await db.$transaction(async (tx) => billing.issueInvoice(tx, (await billing.createInvoice(tx, { ...base, type: "TAX_INVOICE", clientId, items: [item("20000")] }, userId)).id, userId));
    expect(intra.number).toBe("INV/26-27/0001");
    expect(intra.cgstAmount.toFixed(2)).toBe("1800.00");
    expect(intra.sgstAmount.toFixed(2)).toBe("1800.00");
    expect(intra.total.toFixed(2)).toBe("23600.00");
    const inter = await db.$transaction(async (tx) => billing.issueInvoice(tx, (await billing.createInvoice(tx, { ...base, type: "TAX_INVOICE", clientId: otherStateClientId, items: [item("5000")] }, userId)).id, userId));
    expect(inter.number).toBe("INV/26-27/0002");
    expect(inter.igstAmount.toFixed(2)).toBe("900.00");
    expect(inter.cgstAmount.toFixed(2)).toBe("0.00");
  });

  it("records partial payment with TDS, rejects overpayment, then settles", async () => {
    const inv = await db.invoice.findFirstOrThrow({ where: { number: "INV/26-27/0001" } });
    await db.$transaction((tx) => billing.recordPayment(tx, { invoiceId: inv.id, paymentDate: "2026-10-10", amount: "10000", tdsAmount: "400", method: "UPI", accountId, reference: null, notes: null }, userId));
    let fresh = await db.invoice.findUniqueOrThrow({ where: { id: inv.id } });
    expect(fresh.status).toBe("PARTIALLY_PAID");
    expect(fresh.amountPaid.toFixed(2)).toBe("10400.00");
    await expect(db.$transaction((tx) => billing.recordPayment(tx, { invoiceId: inv.id, paymentDate: "2026-10-11", amount: "13300", tdsAmount: "0", method: "UPI", accountId, reference: null, notes: null }, userId))).rejects.toThrow(/exceeds/);
    const p = await db.$transaction((tx) => billing.recordPayment(tx, { invoiceId: inv.id, paymentDate: "2026-10-12", amount: "13200", tdsAmount: "0", method: "BANK_TRANSFER", accountId, reference: "UTR1", notes: null }, userId));
    expect(p.receiptNumber).toBe("RCT/26-27/0002");
    fresh = await db.invoice.findUniqueOrThrow({ where: { id: inv.id } });
    expect(fresh.status).toBe("PAID");
    expect(await db.transaction.count({ where: { paymentId: { not: null } } })).toBe(2);
  });

  it("applies a credit note to the original invoice and blocks over-crediting", async () => {
    const inter = await db.invoice.findFirstOrThrow({ where: { number: "INV/26-27/0002" } });
    await expect(db.$transaction((tx) => billing.createInvoice(tx, { ...base, type: "CREDIT_NOTE", clientId: otherStateClientId, relatedInvoiceId: inter.id, items: [item("6000")] }, userId))).rejects.toThrow(/cannot exceed/);
    const cn = await db.$transaction(async (tx) => billing.issueInvoice(tx, (await billing.createInvoice(tx, { ...base, type: "CREDIT_NOTE", clientId: otherStateClientId, relatedInvoiceId: inter.id, items: [item("1000")] }, userId)).id, userId));
    expect(cn.number).toBe("CN/26-27/0001");
    const fresh = await db.invoice.findUniqueOrThrow({ where: { id: inter.id } });
    expect(fresh.amountCredited.toFixed(2)).toBe("1180.00");
    expect(fresh.status).toBe("PARTIALLY_PAID");
  });

  it("counts vendor bills once in expenses and pays them from the ledger", async () => {
    const vendor = await db.vendor.create({ data: { name: "Freelancer Co", normalizedName: "freelancer co" } });
    const cat = await db.category.create({ data: { name: "Freelancer Payments", type: "EXPENSE", kind: "COST_OF_SERVICES" } });
    const bill = await db.vendorBill.create({ data: { vendorId: vendor.id, billNumber: "F-1", billDate: toDateOnly("2026-10-08"), categoryId: cat.id, subtotal: "5000", taxAmount: "900", total: "5900" } });
    await db.transaction.create({ data: { type: "EXPENSE", date: toDateOnly("2026-10-09"), amount: "5900", description: "Bill F-1", accountId, categoryId: cat.id, vendorId: vendor.id, vendorBillId: bill.id } });
    const updated = await db.$transaction((tx) => recalcVendorBill(tx, bill.id));
    expect(updated.status).toBe("PAID");
  });

  it("produces consistent P&L, receivables, cash and balance sheet", async () => {
    const pnl = await reports.getPnl(range);
    // Revenue: 10000 (non-GST) + 20000 + 5000 − 1000 credit note = 34000 (excl. GST)
    expect(pnl.revenue.toFixed(2)).toBe("34000.00");
    expect(pnl.costOfServices.toFixed(2)).toBe("5000.00");
    expect(pnl.netProfit.toFixed(2)).toBe("29000.00");
    // Cash in = 10000 + 13200 ; cash out = 5900
    expect(pnl.cashIn.toFixed(2)).toBe("23200.00");
    expect(pnl.cashOut.toFixed(2)).toBe("5900.00");

    const ar = await reports.getReceivables(toDateOnly("2026-10-31"));
    // Non-GST 10000 unpaid + inter 5900 − 1180 credit = 14720
    expect(ar.total.toFixed(2)).toBe("14720.00");

    const balances = await accountBalances(toDateOnly("2026-10-31"));
    expect(balances[0]!.balance.toFixed(2)).toBe("117300.00");

    const cf = await reports.getCashFlow(range);
    expect(cf.opening.plus(cf.netChange).toFixed(2)).toBe(cf.closing.toFixed(2));

    const bs = await reports.getBalanceSheet(toDateOnly("2026-10-31"));
    expect(bs.totalAssets.minus(bs.totalLiabilities).toFixed(2)).toBe(bs.totalEquity.toFixed(2));
    const retained = bs.equityLines.find((l) => l.label.startsWith("Retained"))!.amount;
    // Retained earnings ties to accrual net profit (29000) since all activity is in October.
    expect(retained.toFixed(2)).toBe("29000.00");
  });

  it("voids a payment and restores the balance", async () => {
    const p = await db.payment.findFirstOrThrow({ where: { receiptNumber: "RCT/26-27/0002" } });
    await db.$transaction((tx) => billing.voidPayment(tx, p.id, "Bounced", userId));
    const inv = await db.invoice.findUniqueOrThrow({ where: { id: p.invoiceId } });
    expect(inv.status).toBe("PARTIALLY_PAID");
    expect(await db.transaction.count({ where: { paymentId: p.id, deletedAt: null } })).toBe(0);
  });

  it("converts an accepted quotation into a draft invoice exactly once", async () => {
    const q = await db.$transaction((tx) =>
      billing.createQuote(tx, { kind: "QUOTATION", title: "Ads", clientId, projectId: null, templateId: null, issueDate: "2026-10-01", expiryDate: null, placeOfSupply: null, gstApplicable: true, introduction: null, scopeOfWork: null, deliverables: null, timeline: null, paymentTerms: null, terms: null, notes: null, items: [item("15000")] }, userId),
    );
    expect(q.number).toBe("QT/26-27/0001");
    await expect(db.$transaction((tx) => billing.convertQuoteToInvoice(tx, q.id, userId))).rejects.toThrow(/accepted/);
    await db.$transaction((tx) => billing.setQuoteStatus(tx, q.id, "ACCEPTED", userId));
    const inv = await db.$transaction((tx) => billing.convertQuoteToInvoice(tx, q.id, userId));
    expect(inv.status).toBe("DRAFT");
    expect(inv.taxableAmount.toFixed(2)).toBe("15000.00");
    await expect(db.$transaction((tx) => billing.convertQuoteToInvoice(tx, q.id, userId))).rejects.toThrow(/already converted/);
    const v2 = await db.$transaction((tx) => billing.duplicateQuote(tx, q.id, userId, true));
    expect(v2.number).toBe("QT/26-27/0001-v2");
    expect(v2.version).toBe(2);
  });
});
