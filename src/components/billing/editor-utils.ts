// Plain helpers shared by server pages and client editors (no "use client").
const newKey = () => Math.random().toString(36).slice(2, 10);

export type LineItemDraft = {
  key: string; serviceId: string; description: string; details: string; sacCode: string; unit: string;
  quantity: string; unitPrice: string; discountPercent: string; taxRate: string;
};

export const blankItem = (taxRate = "0"): LineItemDraft => ({
  key: newKey(), serviceId: "", description: "", details: "", sacCode: "", unit: "", quantity: "1", unitPrice: "0", discountPercent: "0", taxRate,
});

export const blankRecurringItem = (): LineItemDraft => ({ ...blankItem(), unit: "Month" });
