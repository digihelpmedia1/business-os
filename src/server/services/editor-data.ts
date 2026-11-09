import "server-only";
import { db } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import type { EditorClient, EditorService, EditorTemplate } from "@/components/billing/document-editor";

export async function loadEditorData() {
  const [settings, clients, projects, services, taxRates, templates, relatedInvoices] = await Promise.all([
    getSettings(),
    db.client.findMany({ where: { deletedAt: null }, orderBy: { name: "asc" } }),
    db.project.findMany({ where: { deletedAt: null }, orderBy: { name: "asc" }, select: { id: true, name: true, clientId: true } }),
    db.service.findMany({ where: { isActive: true }, orderBy: { name: "asc" } }),
    db.taxRate.findMany({ where: { isActive: true }, orderBy: { rate: "asc" } }),
    db.documentTemplate.findMany({ where: { isActive: true }, orderBy: { name: "asc" } }),
    db.invoice.findMany({
      where: { deletedAt: null, type: { in: ["TAX_INVOICE", "NON_GST"] }, status: { in: ["ISSUED", "PARTIALLY_PAID", "PAID"] } },
      orderBy: { issueDate: "desc" },
      take: 500,
      select: { id: true, number: true, clientId: true, total: true },
    }),
  ]);
  return {
    company: { gstRegistered: settings.gstRegistered, hasGstin: !!settings.gstin, stateCode: settings.stateCode, roundOff: settings.roundOffTotals },
    settings,
    clients: clients.map<EditorClient>((c) => ({ id: c.id, label: c.businessName && c.businessName !== c.name ? `${c.name} (${c.businessName})` : c.name, stateCode: c.stateCode, country: c.country })),
    projects: projects.map((p) => ({ value: p.id, label: p.name, clientId: p.clientId })),
    services: services.map<EditorService>((s) => ({
      id: s.id, name: s.name, description: s.description, sacCode: s.sacCode, unit: s.unit, defaultPrice: s.defaultPrice.toString(), defaultTaxRate: String(Number(s.defaultTaxRate)),
    })),
    taxRates: taxRates.map((t) => ({ name: t.name, rate: t.rate.toString() })),
    templates: templates.map<EditorTemplate>((t) => ({
      id: t.id, name: t.name, kind: t.kind, title: t.title, introduction: t.introduction, scopeOfWork: t.scopeOfWork, deliverables: t.deliverables,
      timeline: t.timeline, paymentTerms: t.paymentTerms, terms: t.terms,
      items: ((t.items as Record<string, string | null>[]) ?? []).map((i) => ({
        serviceId: i.serviceId ?? "", description: i.description ?? "", details: i.details ?? "", sacCode: i.sacCode ?? "", unit: i.unit ?? "",
        quantity: i.quantity ?? "1", unitPrice: i.unitPrice ?? "0", discountPercent: i.discountPercent ?? "0", taxRate: i.taxRate ?? "0",
      })),
    })),
    relatedInvoices: relatedInvoices.map((r) => ({ id: r.id, number: r.number ?? "", clientId: r.clientId, total: r.total.toString() })),
  };
}

type ItemLike = {
  serviceId: string | null; description: string; details: string | null; sacCode: string | null; unit: string | null;
  quantity: { toString(): string }; unitPrice: { toString(): string }; discountPercent: { toString(): string }; taxRate: { toString(): string };
};

export function toEditorItems(items: ItemLike[]) {
  return items.map((it) => ({
    key: Math.random().toString(36).slice(2, 10),
    serviceId: it.serviceId ?? "",
    description: it.description,
    details: it.details ?? "",
    sacCode: it.sacCode ?? "",
    unit: it.unit ?? "",
    quantity: String(Number(it.quantity.toString())),
    unitPrice: it.unitPrice.toString(),
    discountPercent: String(Number(it.discountPercent.toString())),
    taxRate: String(Number(it.taxRate.toString())),
  }));
}
