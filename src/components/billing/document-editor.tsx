"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { GripVertical, Loader2, Plus, Trash2 } from "lucide-react";
import { computeDocument, isInterStateSupply, INDIAN_STATES } from "@/lib/gst";
import { formatMoney } from "@/lib/money";
import type { ActionState } from "@/lib/action";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader, Notice } from "@/components/ui/primitives";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/fields";
import { blankItem } from "./editor-utils";

export type EditorItem = {
  key: string;
  serviceId: string;
  description: string;
  details: string;
  sacCode: string;
  unit: string;
  quantity: string;
  unitPrice: string;
  discountPercent: string;
  taxRate: string;
};

export type EditorClient = { id: string; label: string; stateCode: string | null; country: string };
export type EditorService = { id: string; name: string; description: string | null; sacCode: string | null; unit: string; defaultPrice: string; defaultTaxRate: string };
export type EditorTemplate = {
  id: string; name: string; kind: string; title: string | null; introduction: string | null; scopeOfWork: string | null; deliverables: string | null;
  timeline: string | null; paymentTerms: string | null; terms: string | null; items: Omit<EditorItem, "key">[];
};

export type EditorValues = {
  kind?: string; // quote
  locked?: boolean; // document type cannot change
  type?: string; // invoice
  title?: string;
  clientId: string;
  projectId: string;
  templateId?: string;
  relatedInvoiceId?: string;
  issueDate: string;
  dueDate?: string;
  expiryDate?: string;
  placeOfSupply: string;
  periodLabel?: string;
  reverseCharge?: boolean;
  gstApplicable?: boolean;
  introduction?: string;
  scopeOfWork?: string;
  deliverables?: string;
  timeline?: string;
  paymentTerms?: string;
  terms?: string;
  notes?: string;
  reason?: string;
  items: EditorItem[];
};

const newKey = () => Math.random().toString(36).slice(2, 10);

const INVOICE_TYPES = [
  { value: "TAX_INVOICE", label: "GST Tax Invoice" },
  { value: "NON_GST", label: "Non-GST Invoice / Bill of Supply" },
  { value: "PROFORMA", label: "Proforma Invoice" },
  { value: "ADVANCE", label: "Advance Invoice" },
  { value: "CREDIT_NOTE", label: "Credit Note" },
  { value: "DEBIT_NOTE", label: "Debit Note" },
];

export function DocumentEditor({
  mode,
  initial,
  clients,
  projects,
  services,
  taxRates,
  templates = [],
  relatedInvoices = [],
  company,
  save,
  canIssue,
}: {
  mode: "quote" | "invoice";
  initial: EditorValues;
  clients: EditorClient[];
  projects: { value: string; label: string; clientId: string | null }[];
  services: EditorService[];
  taxRates: { name: string; rate: string }[];
  templates?: EditorTemplate[];
  relatedInvoices?: { id: string; number: string; clientId: string; total: string }[];
  company: { gstRegistered: boolean; hasGstin: boolean; stateCode: string | null; roundOff: boolean };
  save: (input: unknown) => Promise<ActionState>;
  canIssue?: boolean;
}) {
  const router = useRouter();
  const [v, setV] = React.useState<EditorValues>(initial);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [pending, start] = React.useTransition();
  const set = <K extends keyof EditorValues>(k: K, val: EditorValues[K]) => setV((s) => ({ ...s, [k]: val }));
  const setItem = (key: string, patch: Partial<EditorItem>) => setV((s) => ({ ...s, items: s.items.map((it) => (it.key === key ? { ...it, ...patch } : it)) }));

  const client = clients.find((c) => c.id === v.clientId);
  const isNote = v.type === "CREDIT_NOTE" || v.type === "DEBIT_NOTE";
  const gstApplicable =
    mode === "quote"
      ? !!v.gstApplicable && company.gstRegistered
      : company.gstRegistered && ["TAX_INVOICE", "CREDIT_NOTE", "DEBIT_NOTE", "PROFORMA", "ADVANCE"].includes(v.type ?? "");
  const pos = v.placeOfSupply || client?.stateCode || company.stateCode || "";
  const interState = isInterStateSupply({ supplierStateCode: company.stateCode, placeOfSupply: pos, clientCountry: client?.country });

  const safe = (s: string) => (/^\d+(\.\d+)?$/.test(s.trim()) ? s.trim() : "0");
  const totals = React.useMemo(
    () =>
      computeDocument(
        v.items.map((it) => ({ quantity: safe(it.quantity), unitPrice: safe(it.unitPrice), discountPercent: safe(it.discountPercent), taxRate: safe(it.taxRate) })),
        { gstApplicable, interState, roundOff: company.roundOff },
      ),
    [v.items, gstApplicable, interState, company.roundOff],
  );

  const applyTemplate = (id: string) => {
    const t = templates.find((x) => x.id === id);
    set("templateId", id);
    if (!t) return;
    setV((s) => ({
      ...s,
      templateId: id,
      title: t.title ?? s.title,
      introduction: t.introduction ?? "",
      scopeOfWork: t.scopeOfWork ?? "",
      deliverables: t.deliverables ?? "",
      timeline: t.timeline ?? "",
      paymentTerms: t.paymentTerms ?? "",
      terms: t.terms ?? s.terms,
      items: t.items.length
        ? t.items.map((it) => {
            const svc = services.find((x) => x.id === it.serviceId);
            return {
              ...blankItem(),
              ...it,
              unitPrice: it.unitPrice && it.unitPrice !== "0" ? it.unitPrice : (svc?.defaultPrice ?? "0"),
              taxRate: it.taxRate && it.taxRate !== "0" ? it.taxRate : (svc?.defaultTaxRate ?? "0"),
              sacCode: it.sacCode || svc?.sacCode || "",
              key: newKey(),
            };
          })
        : s.items,
    }));
    toast.info(`Template “${t.name}” applied — review prices before saving.`);
  };

  const pickService = (key: string, id: string) => {
    const svc = services.find((s) => s.id === id);
    if (!svc) return setItem(key, { serviceId: "" });
    setItem(key, {
      serviceId: id,
      description: svc.name,
      details: svc.description ?? "",
      sacCode: svc.sacCode ?? "",
      unit: svc.unit,
      unitPrice: svc.defaultPrice,
      taxRate: svc.defaultTaxRate,
    });
  };

  const submit = (issue: boolean) => {
    setErrors({});
    const payload = {
      ...v,
      placeOfSupply: v.placeOfSupply || null,
      issue,
      items: v.items.map(({ key: _k, ...it }) => it),
    };
    start(async () => {
      const res = await save(payload);
      if (res?.ok) {
        toast.success(res.message ?? "Saved");
        if (res.redirectTo) router.push(res.redirectTo);
        router.refresh();
      } else {
        setErrors(res?.fieldErrors ?? {});
        toast.error(res?.message ?? "Could not save");
      }
    });
  };

  const err = (k: string) => errors[k];
  const filteredProjects = projects.filter((p) => !v.clientId || !p.clientId || p.clientId === v.clientId);

  return (
    <div className="space-y-4 pb-24">
      {mode === "invoice" && v.type === "TAX_INVOICE" && !(company.gstRegistered && company.hasGstin) ? (
        <Notice tone="warning">
          Your company is not marked as GST-registered (Settings → Company &amp; GST). A GST tax invoice cannot be issued until a GSTIN is added — choose “Non-GST Invoice” instead.
        </Notice>
      ) : null}
      <Card>
        <CardHeader title="Document details" />
        <CardBody className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {mode === "invoice" ? (
            <Field label="Document type" required error={err("type")}>
              <Select value={v.type} onChange={(e) => set("type", e.target.value)} disabled={!!initial.locked}>
                {INVOICE_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </Select>
            </Field>
          ) : (
            <Field label="Document type" required>
              <Select value={v.kind} onChange={(e) => set("kind", e.target.value)} disabled={!!initial.locked}>
                <option value="PROPOSAL">Proposal</option>
                <option value="QUOTATION">Quotation</option>
                <option value="ESTIMATE">Service Estimate</option>
              </Select>
            </Field>
          )}
          <Field label="Client" required error={err("clientId")} className="lg:col-span-2">
            <Select value={v.clientId} onChange={(e) => setV((s) => ({ ...s, clientId: e.target.value, relatedInvoiceId: "", projectId: "" }))}>
              <option value="">— Select client —</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>{c.label}</option>
              ))}
            </Select>
          </Field>
          <Field label="Project (optional)" error={err("projectId")}>
            <Select value={v.projectId} onChange={(e) => set("projectId", e.target.value)}>
              <option value="">— None —</option>
              {filteredProjects.map((p) => (
                <option key={p.value} value={p.value}>{p.label}</option>
              ))}
            </Select>
          </Field>
          {mode === "quote" ? (
            <>
              <Field label="Title" required error={err("title")} className="lg:col-span-2">
                <Input value={v.title ?? ""} onChange={(e) => set("title", e.target.value)} placeholder="e.g. Meta Ads Management Proposal" />
              </Field>
              <Field label="Start from template">
                <Select value={v.templateId ?? ""} onChange={(e) => applyTemplate(e.target.value)}>
                  <option value="">— No template —</option>
                  {templates.map((t) => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                </Select>
              </Field>
              <Field label="GST" hint={company.gstRegistered ? "Show GST on this document" : "Company not GST-registered"}>
                <div className="flex h-9 items-center">
                  <Checkbox label="Apply GST" checked={!!v.gstApplicable && company.gstRegistered} disabled={!company.gstRegistered} onChange={(e) => set("gstApplicable", e.target.checked)} />
                </div>
              </Field>
            </>
          ) : null}
          {isNote ? (
            <Field label="Original invoice" required error={err("relatedInvoiceId")} className="lg:col-span-2">
              <Select value={v.relatedInvoiceId ?? ""} onChange={(e) => set("relatedInvoiceId", e.target.value)}>
                <option value="">— Select invoice —</option>
                {relatedInvoices.filter((r) => r.clientId === v.clientId).map((r) => (
                  <option key={r.id} value={r.id}>{r.number} · {formatMoney(r.total)}</option>
                ))}
              </Select>
            </Field>
          ) : null}
          <Field label={mode === "quote" ? "Date" : "Invoice date"} required error={err("issueDate")}>
            <Input type="date" value={v.issueDate} onChange={(e) => set("issueDate", e.target.value)} />
          </Field>
          {mode === "quote" ? (
            <Field label="Valid until" error={err("expiryDate")} hint="Blank = default validity">
              <Input type="date" value={v.expiryDate ?? ""} onChange={(e) => set("expiryDate", e.target.value)} />
            </Field>
          ) : v.type !== "CREDIT_NOTE" ? (
            <Field label="Due date" error={err("dueDate")}>
              <Input type="date" value={v.dueDate ?? ""} onChange={(e) => set("dueDate", e.target.value)} />
            </Field>
          ) : null}
          <Field label="Place of supply" hint={gstApplicable ? (interState ? "Inter-state → IGST" : "Intra-state → CGST + SGST") : "GST not applied"} error={err("placeOfSupply")}>
            <Select value={v.placeOfSupply} onChange={(e) => set("placeOfSupply", e.target.value)}>
              <option value="">{client?.stateCode ? `Client's state (${client.stateCode})` : "— Select —"}</option>
              {INDIAN_STATES.map((s) => (
                <option key={s.code} value={s.code}>{s.code} — {s.name}</option>
              ))}
            </Select>
          </Field>
          {mode === "invoice" ? (
            <>
              <Field label="Billing period" hint="e.g. November 2026">
                <Input value={v.periodLabel ?? ""} onChange={(e) => set("periodLabel", e.target.value)} />
              </Field>
              {gstApplicable ? (
                <Field label="Reverse charge">
                  <div className="flex h-9 items-center">
                    <Checkbox label="Tax payable on reverse charge" checked={!!v.reverseCharge} onChange={(e) => set("reverseCharge", e.target.checked)} />
                  </div>
                </Field>
              ) : null}
            </>
          ) : null}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={mode === "quote" ? "Services & pricing" : "Line items"} description={err("items") ?? undefined} />
        <div className="thin-scroll overflow-x-auto">
          <table className="w-full min-w-[980px] text-sm">
            <thead>
              <tr className="border-b border-line bg-surface-2 text-left text-xs font-medium text-muted">
                <th className="w-6 px-2 py-2" />
                <th className="px-2 py-2">Service / description</th>
                <th className="w-24 px-2 py-2">SAC</th>
                <th className="w-20 px-2 py-2">Qty</th>
                <th className="w-24 px-2 py-2">Unit</th>
                <th className="w-32 px-2 py-2">Rate (₹)</th>
                <th className="w-20 px-2 py-2">Disc %</th>
                <th className="w-28 px-2 py-2">{gstApplicable ? "GST %" : "Tax"}</th>
                <th className="w-32 px-2 py-2 text-right">Amount</th>
                <th className="w-10 px-2 py-2" />
              </tr>
            </thead>
            <tbody>
              {v.items.map((it, idx) => {
                const line = totals.lines[idx];
                const ie = (f: string) => errors[`items.${idx}.${f}`];
                return (
                  <tr key={it.key} className="border-b border-line align-top last:border-0">
                    <td className="px-2 pt-4 text-subtle"><GripVertical className="h-4 w-4" /></td>
                    <td className="space-y-1.5 px-2 py-2">
                      <Select value={it.serviceId} onChange={(e) => pickService(it.key, e.target.value)} aria-label="Service">
                        <option value="">— Custom item —</option>
                        {services.map((s) => (
                          <option key={s.id} value={s.id}>{s.name}</option>
                        ))}
                      </Select>
                      <Input value={it.description} onChange={(e) => setItem(it.key, { description: e.target.value })} placeholder="Description" aria-invalid={!!ie("description")} />
                      <Textarea rows={2} value={it.details} onChange={(e) => setItem(it.key, { details: e.target.value })} placeholder="Details (optional)" className="text-[13px]" />
                      {ie("description") ? <p className="text-xs text-danger">{ie("description")}</p> : null}
                    </td>
                    <td className="px-2 py-2"><Input value={it.sacCode} onChange={(e) => setItem(it.key, { sacCode: e.target.value })} placeholder="9983xx" aria-invalid={!!ie("sacCode")} /></td>
                    <td className="px-2 py-2"><Input inputMode="decimal" value={it.quantity} onChange={(e) => setItem(it.key, { quantity: e.target.value })} aria-invalid={!!ie("quantity")} /></td>
                    <td className="px-2 py-2"><Input value={it.unit} onChange={(e) => setItem(it.key, { unit: e.target.value })} placeholder="Month" /></td>
                    <td className="px-2 py-2"><Input inputMode="decimal" value={it.unitPrice} onChange={(e) => setItem(it.key, { unitPrice: e.target.value })} aria-invalid={!!ie("unitPrice")} /></td>
                    <td className="px-2 py-2"><Input inputMode="decimal" value={it.discountPercent} onChange={(e) => setItem(it.key, { discountPercent: e.target.value })} aria-invalid={!!ie("discountPercent")} /></td>
                    <td className="px-2 py-2">
                      {gstApplicable ? (
                        <Select value={it.taxRate} onChange={(e) => setItem(it.key, { taxRate: e.target.value })}>
                          {!taxRates.some((t) => Number(t.rate) === Number(it.taxRate)) ? <option value={it.taxRate}>{it.taxRate}%</option> : null}
                          {taxRates.map((t) => (
                            <option key={t.name} value={String(Number(t.rate))}>{Number(t.rate)}%</option>
                          ))}
                        </Select>
                      ) : (
                        <span className="block pt-2 text-xs text-muted">N/A</span>
                      )}
                    </td>
                    <td className="tabular px-2 pt-4 text-right font-medium">{line ? formatMoney(line.taxableAmount) : "—"}</td>
                    <td className="px-2 pt-2.5">
                      <Button variant="ghost" size="icon-sm" onClick={() => setV((s) => ({ ...s, items: s.items.filter((x) => x.key !== it.key) }))} disabled={v.items.length === 1} aria-label="Remove line">
                        <Trash2 />
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="flex flex-col gap-4 border-t border-line p-4 lg:flex-row lg:items-start lg:justify-between">
          <Button variant="outline" size="sm" onClick={() => setV((s) => ({ ...s, items: [...s.items, blankItem(s.items.at(-1)?.taxRate ?? "0")] }))}>
            <Plus /> Add line
          </Button>
          <dl className="w-full max-w-sm space-y-1.5 text-sm">
            <Row label="Subtotal" value={formatMoney(totals.subtotal)} />
            {totals.discountTotal.gt(0) ? <Row label="Discount" value={`− ${formatMoney(totals.discountTotal)}`} /> : null}
            <Row label="Taxable value" value={formatMoney(totals.taxableAmount)} />
            {gstApplicable ? (
              interState ? (
                <Row label="IGST" value={formatMoney(totals.igstAmount)} />
              ) : (
                <>
                  <Row label="CGST" value={formatMoney(totals.cgstAmount)} />
                  <Row label="SGST" value={formatMoney(totals.sgstAmount)} />
                </>
              )
            ) : null}
            {!totals.roundOff.isZero() ? <Row label="Round off" value={formatMoney(totals.roundOff)} /> : null}
            <div className="flex justify-between border-t border-line pt-2 text-base font-semibold">
              <dt>Total</dt>
              <dd className="tabular">{formatMoney(totals.total)}</dd>
            </div>
          </dl>
        </div>
      </Card>

      <Card>
        <CardHeader title={mode === "quote" ? "Proposal content" : "Terms & notes"} />
        <CardBody className="grid gap-4 lg:grid-cols-2">
          {mode === "quote" ? (
            <>
              <TextBlock label="Introduction" value={v.introduction} onChange={(x) => set("introduction", x)} />
              <TextBlock label="Scope of work" value={v.scopeOfWork} onChange={(x) => set("scopeOfWork", x)} />
              <TextBlock label="Deliverables" value={v.deliverables} onChange={(x) => set("deliverables", x)} />
              <TextBlock label="Project timeline" value={v.timeline} onChange={(x) => set("timeline", x)} />
            </>
          ) : null}
          {isNote ? <TextBlock label="Reason for note" value={v.reason} onChange={(x) => set("reason", x)} /> : null}
          <TextBlock label="Payment terms" value={v.paymentTerms} onChange={(x) => set("paymentTerms", x)} />
          <TextBlock label="Terms & conditions" value={v.terms} onChange={(x) => set("terms", x)} rows={6} />
          <TextBlock label={mode === "quote" ? "Internal notes (not printed)" : "Notes (printed)"} value={v.notes} onChange={(x) => set("notes", x)} />
        </CardBody>
      </Card>

      <div className="no-print fixed inset-x-0 bottom-0 z-20 border-t border-line bg-surface/95 backdrop-blur lg:left-[264px]">
        <div className="mx-auto flex max-w-[1440px] items-center justify-between gap-3 px-4 py-3 sm:px-6 lg:px-8">
          <p className="tabular text-sm text-muted">
            Total <span className="ml-1 text-base font-semibold text-fg">{formatMoney(totals.total)}</span>
          </p>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => router.back()} disabled={pending}>Cancel</Button>
            <Button variant={mode === "invoice" && canIssue ? "outline" : "primary"} onClick={() => submit(false)} disabled={pending}>
              {pending ? <Loader2 className="animate-spin" /> : null} Save draft
            </Button>
            {mode === "invoice" && canIssue ? (
              <Button onClick={() => submit(true)} disabled={pending}>
                {pending ? <Loader2 className="animate-spin" /> : null} Save &amp; issue
              </Button>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-muted">
      <dt>{label}</dt>
      <dd className="tabular text-fg">{value}</dd>
    </div>
  );
}

function TextBlock({ label, value, onChange, rows = 4 }: { label: string; value?: string; onChange: (v: string) => void; rows?: number }) {
  return (
    <Field label={label}>
      <Textarea rows={rows} value={value ?? ""} onChange={(e) => onChange(e.target.value)} />
    </Field>
  );
}
