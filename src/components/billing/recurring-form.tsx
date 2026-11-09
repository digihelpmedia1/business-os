"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Plus, Trash2 } from "lucide-react";
import type { ActionState } from "@/lib/action";
import { computeDocument } from "@/lib/gst";
import { formatMoney } from "@/lib/money";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/primitives";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/fields";
import type { EditorService } from "./document-editor";
import { blankRecurringItem } from "./editor-utils";

type Item = { key: string; serviceId: string; description: string; details: string; sacCode: string; unit: string; quantity: string; unitPrice: string; discountPercent: string; taxRate: string };
export type RecurringValues = {
  name: string; clientId: string; projectId: string; invoiceType: string; frequency: string; startDate: string; endDate: string;
  dueInDays: string; autoIssue: boolean; isActive: boolean; notes: string; items: Item[];
};


export function RecurringForm({
  initial, clients, projects, services, taxRates, gstRegistered, save,
}: {
  initial: RecurringValues;
  clients: { value: string; label: string }[];
  projects: { value: string; label: string; clientId: string | null }[];
  services: EditorService[];
  taxRates: { name: string; rate: string }[];
  gstRegistered: boolean;
  save: (input: unknown) => Promise<ActionState>;
}) {
  const router = useRouter();
  const [v, setV] = React.useState(initial);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [pending, start] = React.useTransition();
  const set = <K extends keyof RecurringValues>(key: K, val: RecurringValues[K]) => setV((s) => ({ ...s, [key]: val }));
  const setItem = (key: string, patch: Partial<Item>) => setV((s) => ({ ...s, items: s.items.map((i) => (i.key === key ? { ...i, ...patch } : i)) }));
  const gst = gstRegistered && v.invoiceType !== "NON_GST";
  const safe = (s: string) => (/^\d+(\.\d+)?$/.test(s) ? s : "0");
  const totals = computeDocument(v.items.map((i) => ({ quantity: safe(i.quantity), unitPrice: safe(i.unitPrice), discountPercent: safe(i.discountPercent), taxRate: safe(i.taxRate) })), { gstApplicable: gst, interState: false, roundOff: false });

  const submit = () =>
    start(async () => {
      setErrors({});
      const res = await save({ ...v, autoIssue: v.autoIssue ? "on" : "", isActive: v.isActive ? "on" : "", items: v.items.map(({ key: _k, ...i }) => i) });
      if (res?.ok) {
        toast.success(res.message ?? "Saved");
        if (res.redirectTo) router.push(res.redirectTo);
        router.refresh();
      } else {
        setErrors(res?.fieldErrors ?? {});
        toast.error(res?.message ?? "Could not save");
      }
    });

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader title="Schedule" />
        <CardBody className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Profile name" required error={errors.name} className="lg:col-span-2"><Input value={v.name} onChange={(e) => set("name", e.target.value)} placeholder="e.g. Acme — Meta Ads retainer" /></Field>
          <Field label="Client" required error={errors.clientId}>
            <Select value={v.clientId} onChange={(e) => set("clientId", e.target.value)}>
              <option value="">— Select —</option>
              {clients.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
            </Select>
          </Field>
          <Field label="Project">
            <Select value={v.projectId} onChange={(e) => set("projectId", e.target.value)}>
              <option value="">— None —</option>
              {projects.filter((p) => !v.clientId || p.clientId === v.clientId).map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
            </Select>
          </Field>
          <Field label="Invoice type">
            <Select value={v.invoiceType} onChange={(e) => set("invoiceType", e.target.value)}>
              <option value="TAX_INVOICE">GST Tax Invoice</option>
              <option value="NON_GST">Non-GST Invoice</option>
              <option value="PROFORMA">Proforma Invoice</option>
            </Select>
          </Field>
          <Field label="Frequency">
            <Select value={v.frequency} onChange={(e) => set("frequency", e.target.value)}>
              <option value="MONTHLY">Monthly</option>
              <option value="QUARTERLY">Quarterly</option>
              <option value="HALF_YEARLY">Half-yearly</option>
              <option value="YEARLY">Yearly</option>
            </Select>
          </Field>
          <Field label="First invoice date" required error={errors.startDate}><Input type="date" value={v.startDate} onChange={(e) => set("startDate", e.target.value)} /></Field>
          <Field label="End date" hint="Optional" error={errors.endDate}><Input type="date" value={v.endDate} onChange={(e) => set("endDate", e.target.value)} /></Field>
          <Field label="Payment due (days)" error={errors.dueInDays}><Input inputMode="numeric" value={v.dueInDays} onChange={(e) => set("dueInDays", e.target.value)} /></Field>
          <Field label="Automation" className="lg:col-span-3">
            <div className="flex h-9 flex-wrap items-center gap-5">
              <Checkbox label="Issue automatically (otherwise a draft is created for review)" checked={v.autoIssue} onChange={(e) => set("autoIssue", e.target.checked)} />
              <Checkbox label="Active" checked={v.isActive} onChange={(e) => set("isActive", e.target.checked)} />
            </div>
          </Field>
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Line items" description={errors.items} />
        <div className="thin-scroll overflow-x-auto">
          <table className="w-full min-w-[860px] text-sm">
            <thead><tr className="border-b border-line bg-surface-2 text-left text-xs text-muted">
              <th className="px-2 py-2">Service / description</th><th className="w-24 px-2 py-2">SAC</th><th className="w-20 px-2 py-2">Qty</th><th className="w-32 px-2 py-2">Rate (₹)</th><th className="w-20 px-2 py-2">Disc %</th><th className="w-24 px-2 py-2">GST %</th><th className="w-10" />
            </tr></thead>
            <tbody>
              {v.items.map((it) => (
                <tr key={it.key} className="border-b border-line align-top">
                  <td className="space-y-1.5 px-2 py-2">
                    <Select value={it.serviceId} onChange={(e) => {
                      const s = services.find((x) => x.id === e.target.value);
                      setItem(it.key, s ? { serviceId: s.id, description: s.name, sacCode: s.sacCode ?? "", unitPrice: s.defaultPrice, taxRate: s.defaultTaxRate, unit: s.unit } : { serviceId: "" });
                    }}>
                      <option value="">— Custom item —</option>
                      {services.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </Select>
                    <Input value={it.description} onChange={(e) => setItem(it.key, { description: e.target.value })} placeholder="Description" />
                  </td>
                  <td className="px-2 py-2"><Input value={it.sacCode} onChange={(e) => setItem(it.key, { sacCode: e.target.value })} /></td>
                  <td className="px-2 py-2"><Input value={it.quantity} onChange={(e) => setItem(it.key, { quantity: e.target.value })} /></td>
                  <td className="px-2 py-2"><Input value={it.unitPrice} onChange={(e) => setItem(it.key, { unitPrice: e.target.value })} /></td>
                  <td className="px-2 py-2"><Input value={it.discountPercent} onChange={(e) => setItem(it.key, { discountPercent: e.target.value })} /></td>
                  <td className="px-2 py-2">
                    <Select value={it.taxRate} onChange={(e) => setItem(it.key, { taxRate: e.target.value })} disabled={!gst}>
                      {!taxRates.some((t) => Number(t.rate) === Number(it.taxRate)) ? <option value={it.taxRate}>{it.taxRate}%</option> : null}
                      {taxRates.map((t) => <option key={t.name} value={String(Number(t.rate))}>{Number(t.rate)}%</option>)}
                    </Select>
                  </td>
                  <td className="px-2 py-2"><Button variant="ghost" size="icon-sm" onClick={() => setV((s) => ({ ...s, items: s.items.filter((x) => x.key !== it.key) }))} disabled={v.items.length === 1} aria-label="Remove"><Trash2 /></Button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-between border-t border-line p-4">
          <Button variant="outline" size="sm" onClick={() => setV((s) => ({ ...s, items: [...s.items, blankRecurringItem()] }))}><Plus /> Add line</Button>
          <p className="text-sm text-muted">Per invoice (excl. GST): <span className="tabular font-semibold text-fg">{formatMoney(totals.taxableAmount)}</span> · incl. GST (intra-state est.): <span className="tabular font-semibold text-fg">{formatMoney(totals.total)}</span></p>
        </div>
      </Card>
      <Card>
        <CardBody>
          <Field label="Notes printed on each invoice"><Textarea value={v.notes} onChange={(e) => set("notes", e.target.value)} /></Field>
        </CardBody>
      </Card>
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={() => router.back()}>Cancel</Button>
        <Button onClick={submit} disabled={pending}>{pending ? <Loader2 className="animate-spin" /> : null} Save profile</Button>
      </div>
    </div>
  );
}
