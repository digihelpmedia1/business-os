import { describe, expect, it } from "vitest";
import { computeDocument, isInterStateSupply } from "@/lib/gst";
import { amountInWords, D, formatMoney, convert } from "@/lib/money";
import { fyOf, previousPeriod, resolveRange, toDateOnly, addMonths, quarterOf } from "@/lib/dates";
import { accrualEntries, cashEntries, concentration, linearRegression, summarizePnl, type InvRow, type TxnRow, type BillRow } from "@/lib/finance/engine";
import { formatNumber } from "@/lib/numbering-defaults";
import { can, emptyAccess } from "@/lib/permissions";

describe("GST calculation", () => {
  it("splits CGST/SGST for intra-state supply and rounds per line", () => {
    const doc = computeDocument(
      [
        { quantity: "1", unitPrice: "25000", discountPercent: "10", taxRate: "18" },
        { quantity: "3", unitPrice: "1999.99", discountPercent: "0", taxRate: "18" },
      ],
      { gstApplicable: true, interState: false, roundOff: true },
    );
    // line1: 25000 - 2500 = 22500 → tax 4050 ; line2: 5999.97 → tax 1079.99 (1079.9946)
    expect(doc.taxableAmount.toFixed(2)).toBe("28499.97");
    expect(doc.taxTotal.toFixed(2)).toBe("5129.99");
    expect(doc.cgstAmount.plus(doc.sgstAmount).toFixed(2)).toBe("5129.99");
    expect(doc.igstAmount.toFixed(2)).toBe("0.00");
    expect(doc.total.toFixed(2)).toBe("33630.00");
    expect(doc.roundOff.toFixed(2)).toBe("0.04");
  });

  it("uses IGST for inter-state and no tax when GST is not applicable", () => {
    const inter = computeDocument([{ quantity: "2", unitPrice: "1000", taxRate: "18" }], { gstApplicable: true, interState: true, roundOff: false });
    expect(inter.igstAmount.toFixed(2)).toBe("360.00");
    expect(inter.cgstAmount.toFixed(2)).toBe("0.00");
    const none = computeDocument([{ quantity: "2", unitPrice: "1000", taxRate: "18" }], { gstApplicable: false, interState: false, roundOff: false });
    expect(none.taxTotal.toFixed(2)).toBe("0.00");
    expect(none.total.toFixed(2)).toBe("2000.00");
  });

  it("determines place of supply", () => {
    expect(isInterStateSupply({ supplierStateCode: "27", placeOfSupply: "27" })).toBe(false);
    expect(isInterStateSupply({ supplierStateCode: "27", placeOfSupply: "29" })).toBe(true);
    expect(isInterStateSupply({ supplierStateCode: "27", placeOfSupply: "27", clientCountry: "UAE" })).toBe(true);
  });
});

describe("money", () => {
  it("formats INR in Indian grouping and converts currencies", () => {
    expect(formatMoney(1234567.5)).toBe("₹12,34,567.50");
    expect(formatMoney(8350, { currency: { code: "USD", rateToInr: 83.5 } })).toBe("$100.00");
    expect(convert(167, { code: "USD", rateToInr: 83.5 })).toBe(2);
    expect(formatMoney(2500000, { compact: true })).toBe("₹25.00 L");
  });
  it("writes amounts in words (Indian system)", () => {
    expect(amountInWords("125050.75")).toBe("Rupees One Lakh Twenty Five Thousand Fifty and Seventy Five Paise Only");
    expect(amountInWords("10000000")).toBe("Rupees One Crore Only");
  });
});

describe("dates & financial year", () => {
  it("computes Indian FY (April–March)", () => {
    const fy = fyOf(toDateOnly("2026-02-10"));
    expect(fy.label).toBe("FY 2025-26");
    expect(fy.short).toBe("25-26");
    expect(fy.from.toISOString().slice(0, 10)).toBe("2025-04-01");
    expect(fy.to.toISOString().slice(0, 10)).toBe("2026-03-31");
    expect(quarterOf(toDateOnly("2026-11-09")).label).toBe("Q3 FY 2026-27");
  });
  it("resolves presets and previous periods", () => {
    const today = toDateOnly("2026-11-09");
    const lm = resolveRange("last_month", {}, 4, today);
    expect([lm.from, lm.to].map((d) => d.toISOString().slice(0, 10))).toEqual(["2026-10-01", "2026-10-31"]);
    const l3 = resolveRange("last_3_months", {}, 4, today);
    expect(l3.from.toISOString().slice(0, 10)).toBe("2026-09-01");
    const prev = previousPeriod(l3);
    expect([prev.from, prev.to].map((d) => d.toISOString().slice(0, 10))).toEqual(["2026-06-01", "2026-08-31"]);
    expect(resolveRange("prev_fy", {}, 4, today).label).toBe("FY 2025-26");
    expect(addMonths(toDateOnly("2026-01-31"), 1).toISOString().slice(0, 10)).toBe("2026-02-28");
  });
  it("keeps GST invoice numbers within 16 characters", () => {
    const n = formatNumber("INV", "26-27", 1, 4);
    expect(n).toBe("INV/26-27/0001");
    expect(n.length).toBeLessThanOrEqual(16);
  });
});

describe("revenue recognition (no double counting)", () => {
  const d = toDateOnly("2026-10-15");
  const inv: InvRow[] = [
    { id: "i1", type: "TAX_INVOICE", issueDate: d, clientId: "c1", projectId: null, taxableAmount: "10000", items: [{ serviceId: "s1", taxableAmount: "10000" }] },
    { id: "i2", type: "CREDIT_NOTE", issueDate: d, clientId: "c1", projectId: null, taxableAmount: "1000", items: [{ serviceId: "s1", taxableAmount: "1000" }] },
    { id: "i3", type: "PROFORMA", issueDate: d, clientId: "c1", projectId: null, taxableAmount: "5000", items: [] },
  ];
  const base = { taxAmount: "0", vendorBillId: null, categoryId: "cat", clientId: null, projectId: null, serviceId: null, vendorId: null, employeeId: null, isAcquisition: false };
  const txns: TxnRow[] = [
    { ...base, id: "t1", type: "INCOME", date: d, amount: "11800", paymentId: "p1", categoryName: "Client Payments", kind: "REVENUE" },
    { ...base, id: "t2", type: "INCOME", date: d, amount: "2000", paymentId: null, categoryName: "Service Revenue", kind: "REVENUE" },
    { ...base, id: "t3", type: "EXPENSE", date: d, amount: "1180", taxAmount: "180", paymentId: null, categoryName: "Software", kind: "OPERATING_EXPENSE" },
    { ...base, id: "t4", type: "EXPENSE", date: d, amount: "5900", paymentId: null, vendorBillId: "b1", categoryName: "Freelancers", kind: "COST_OF_SERVICES" },
    { ...base, id: "t5", type: "EXPENSE", date: d, amount: "50000", paymentId: null, categoryName: "Equipment", kind: "CAPITAL_EXPENDITURE" },
    { ...base, id: "t6", type: "EXPENSE", date: d, amount: "3000", paymentId: null, categoryName: "GST Payment", kind: "TAX_SETTLEMENT" },
    { ...base, id: "t7", type: "TRANSFER", date: d, amount: "9999", paymentId: null, categoryName: null, kind: null },
    { ...base, id: "t8", type: "INCOME", date: d, amount: "100", paymentId: null, categoryName: "Interest", kind: "OTHER_INCOME" },
    { ...base, id: "t9", type: "EXPENSE", date: d, amount: "50", paymentId: null, categoryName: "Bank charges", kind: "NON_OPERATING" },
  ];
  const bills: BillRow[] = [{ id: "b1", billDate: d, subtotal: "5000", categoryId: "cf", categoryName: "Freelancers", kind: "COST_OF_SERVICES", isAcquisition: false, projectId: null, vendorId: "v1" }];

  it("recognises revenue from invoices, not from the linked payment", () => {
    const pnl = summarizePnl(accrualEntries(inv, txns, bills));
    expect(pnl.grossRevenue.toFixed(2)).toBe("12000.00"); // 10000 invoice + 2000 direct, payment t1 & proforma excluded
    expect(pnl.creditNotes.toFixed(2)).toBe("1000.00");
    expect(pnl.revenue.toFixed(2)).toBe("11000.00");
    expect(pnl.costOfServices.toFixed(2)).toBe("5000.00"); // bill once, bill payment excluded
    expect(pnl.operatingExpenses.toFixed(2)).toBe("1000.00"); // net of input GST
    expect(pnl.otherIncome.toFixed(2)).toBe("100.00");
    expect(pnl.nonOperating.toFixed(2)).toBe("50.00");
    expect(pnl.grossProfit.toFixed(2)).toBe("6000.00");
    expect(pnl.operatingProfit.toFixed(2)).toBe("5000.00");
    expect(pnl.netProfit.toFixed(2)).toBe("5050.00");
  });

  it("classifies cash flows and ignores transfers", () => {
    const cash = cashEntries(txns);
    const total = cash.reduce((a, c) => a.plus(c.amount), D(0));
    expect(total.toFixed(2)).toBe(D(11800 + 2000 + 100 - 1180 - 5900 - 50000 - 3000 - 50).toFixed(2));
    expect(cash.filter((c) => c.section === "INVESTING").length).toBe(1);
    expect(cash.find((c) => c.label.startsWith("Receipts from clients"))?.amount.toFixed(2)).toBe("11800.00");
  });
});

describe("analytics helpers", () => {
  it("computes concentration and regression", () => {
    const c = concentration([50, 30, 20])!;
    expect(c.top1).toBeCloseTo(0.5);
    expect(c.hhi).toBeCloseTo(0.38);
    expect(concentration([])).toBeNull();
    const fit = linearRegression([10, 20, 30, 40])!;
    expect(fit.slope).toBeCloseTo(10);
    expect(fit.predict(4)).toBeCloseTo(50);
  });
  it("checks cumulative access levels", () => {
    const a = { ...emptyAccess(), billing: "EDIT" as const };
    expect(can(a, "billing", "VIEW")).toBe(true);
    expect(can(a, "billing", "EDIT")).toBe(true);
    expect(can(a, "billing", "FULL")).toBe(false);
    expect(can(a, "finance", "VIEW")).toBe(false);
  });
});
