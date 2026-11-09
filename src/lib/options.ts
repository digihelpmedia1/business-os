import "server-only";
import type { CategoryType } from "@prisma/client";
import { db } from "./db";

export type Option = { value: string; label: string };

export async function clientOptions(): Promise<Option[]> {
  const rows = await db.client.findMany({ where: { deletedAt: null }, orderBy: { name: "asc" }, select: { id: true, name: true, businessName: true } });
  return rows.map((c) => ({ value: c.id, label: c.businessName && c.businessName !== c.name ? `${c.name} (${c.businessName})` : c.name }));
}

export async function projectOptions(opts: { activeOnly?: boolean } = {}): Promise<Option[]> {
  const rows = await db.project.findMany({
    where: { deletedAt: null, ...(opts.activeOnly ? { status: { notIn: ["COMPLETED", "CANCELLED"] } } : {}) },
    orderBy: { name: "asc" },
    select: { id: true, name: true, client: { select: { name: true } } },
  });
  return rows.map((p) => ({ value: p.id, label: p.client ? `${p.name} — ${p.client.name}` : p.name }));
}

export async function employeeOptions(opts: { includeExited?: boolean } = {}): Promise<Option[]> {
  const rows = await db.employee.findMany({
    where: { deletedAt: null, ...(opts.includeExited ? {} : { status: { not: "EXITED" } }) },
    orderBy: { name: "asc" },
    select: { id: true, name: true, type: true },
  });
  return rows.map((e) => ({ value: e.id, label: e.type === "FREELANCER" ? `${e.name} (freelancer)` : e.name }));
}

export async function vendorOptions(): Promise<Option[]> {
  const rows = await db.vendor.findMany({ where: { deletedAt: null }, orderBy: { name: "asc" }, select: { id: true, name: true } });
  return rows.map((v) => ({ value: v.id, label: v.name }));
}

export async function categoryOptions(type?: CategoryType): Promise<Option[]> {
  const rows = await db.category.findMany({
    where: { isActive: true, ...(type ? { type } : {}) },
    orderBy: [{ type: "asc" }, { name: "asc" }],
    select: { id: true, name: true, type: true },
  });
  return rows.map((c) => ({ value: c.id, label: type ? c.name : `${c.type === "INCOME" ? "Income" : "Expense"} · ${c.name}` }));
}

export async function accountOptions(): Promise<Option[]> {
  const rows = await db.account.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true } });
  return rows.map((a) => ({ value: a.id, label: a.name }));
}

export async function serviceOptions(): Promise<Option[]> {
  const rows = await db.service.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true } });
  return rows.map((s) => ({ value: s.id, label: s.name }));
}

export const PAYMENT_METHOD_OPTIONS: Option[] = [
  { value: "BANK_TRANSFER", label: "Bank transfer (NEFT/RTGS/IMPS)" },
  { value: "UPI", label: "UPI" },
  { value: "CASH", label: "Cash" },
  { value: "CHEQUE", label: "Cheque" },
  { value: "CARD", label: "Card" },
  { value: "PAYMENT_GATEWAY", label: "Payment gateway" },
  { value: "OTHER", label: "Other" },
];
