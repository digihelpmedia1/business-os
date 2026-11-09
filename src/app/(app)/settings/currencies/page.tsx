import { Plus, RefreshCw, Trash2 } from "lucide-react";
import { requirePageAccess } from "@/lib/auth";
import { db } from "@/lib/db";
import { can } from "@/lib/permissions";
import { fmtDate } from "@/lib/dates";
import { SUPPORTED_CURRENCIES } from "@/lib/money";
import { Badge, Card, Notice, PageHeader } from "@/components/ui/primitives";
import { FormDialog } from "@/components/ui/form-dialog";
import { ConfirmAction } from "@/components/ui/confirm-action";
import { deleteRate, refreshRates, saveRate } from "@/server/actions/settings";

export const metadata = { title: "Currencies" };

export default async function CurrenciesPage() {
  const user = await requirePageAccess("settings");
  const rates = await db.exchangeRate.findMany({ orderBy: { currency: "asc" } });
  const canEdit = can(user.access, "settings", "EDIT");
  return (
    <>
      <PageHeader
        title="Currencies"
        description="Books are always kept in INR. These rates let anyone switch dashboards, reports and BI to another currency (top bar)."
        actions={canEdit ? (
          <>
            <ConfirmAction action={refreshRates} label={<><RefreshCw /> Refresh from ECB</>} noConfirm variant="outline" size="md" />
            <FormDialog trigger={<><Plus /> Set rate manually</>} title="Set exchange rate" fields={[
              { name: "currency", label: "Currency", type: "select", emptyOption: false, options: SUPPORTED_CURRENCIES.filter((c) => c !== "INR").map((c) => ({ value: c, label: c })) },
              { name: "rateToInr", label: "1 unit = how many ₹", type: "number", step: "0.000001", required: true },
            ]} defaults={{ currency: "USD" }} action={saveRate} />
          </>
        ) : null}
      />
      <Notice className="mb-4">“Refresh from ECB” pulls the latest European Central Bank reference rates (via frankfurter.app). Converted figures are labelled with the rate and date used.</Notice>
      <Card className="overflow-hidden">
        <div className="thin-scroll overflow-x-auto">
          <table className="w-full min-w-[480px] text-sm">
            <thead><tr className="border-b border-line bg-surface-2 text-left text-xs text-muted"><th className="px-4 py-2.5">Currency</th><th className="px-4 py-2.5 text-right">1 unit in ₹</th><th className="px-4 py-2.5 text-right">₹1 in currency</th><th className="px-4 py-2.5">Source</th><th className="px-4 py-2.5">As of</th><th className="px-4 py-2.5" /></tr></thead>
            <tbody>
              {rates.length ? rates.map((r) => (
                <tr key={r.currency} className="border-b border-line last:border-0">
                  <td className="px-4 py-2.5 font-medium">{r.currency}</td>
                  <td className="tabular px-4 py-2.5 text-right">₹{Number(r.rateToInr).toFixed(4)}</td>
                  <td className="tabular px-4 py-2.5 text-right">{(1 / Number(r.rateToInr)).toFixed(6)}</td>
                  <td className="px-4 py-2.5"><Badge tone={r.source === "ecb" ? "info" : "neutral"}>{r.source === "ecb" ? "ECB" : "Manual"}</Badge></td>
                  <td className="px-4 py-2.5">{fmtDate(r.asOf)}</td>
                  <td className="px-4 py-2.5 text-right">{can(user.access, "settings", "FULL") ? <ConfirmAction action={deleteRate.bind(null, r.currency)} label={<Trash2 />} variant="ghost" size="icon-sm" title={`Remove ${r.currency}?`} confirmLabel="Remove" /> : null}</td>
                </tr>
              )) : <tr><td colSpan={6} className="px-4 py-10 text-center text-muted">No rates yet — click “Refresh from ECB”.</td></tr>}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}
