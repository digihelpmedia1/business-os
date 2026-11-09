import Link from "next/link";
import { Landmark, Pencil, Plus, Trash2 } from "lucide-react";
import { requirePageAccess } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { formatMoney, Decimal } from "@/lib/money";
import { fmtDate, isoDate, todayIST } from "@/lib/dates";
import { accountBalances } from "@/lib/finance/ledger";
import { Card, EmptyState, PageHeader, StatCard } from "@/components/ui/primitives";
import { FormDialog, type FieldDef } from "@/components/ui/form-dialog";
import { ConfirmAction } from "@/components/ui/confirm-action";
import { StatusBadge } from "@/components/status-badge";
import { deleteAccount, saveAccount } from "@/server/actions/finance";

export const metadata = { title: "Bank & Cash Accounts" };

const fields: FieldDef[] = [
  { name: "name", label: "Account name", required: true, placeholder: "e.g. HDFC Current A/c" },
  { name: "type", label: "Type", type: "select", emptyOption: false, options: [
    { value: "BANK", label: "Bank account" }, { value: "CASH", label: "Cash in hand" }, { value: "WALLET", label: "Wallet / UPI" }, { value: "CREDIT_CARD", label: "Credit card" }, { value: "OTHER", label: "Other" },
  ] },
  { name: "bankName", label: "Bank name" },
  { name: "accountLast4", label: "Last 4 digits", placeholder: "1234", hint: "Never store full account numbers here" },
  { name: "openingBalance", label: "Opening balance (₹)", type: "money", required: true, hint: "Negative for credit-card dues" },
  { name: "openingDate", label: "Opening balance date", type: "date", required: true, hint: "Transactions before this date are not allowed" },
  { name: "isActive", label: "Active", type: "checkbox" },
  { name: "notes", label: "Notes", type: "textarea" },
];

export default async function AccountsPage() {
  const user = await requirePageAccess("finance");
  const accounts = await accountBalances(todayIST());
  const total = accounts.reduce((a, b) => a.plus(b.balance), new Decimal(0));
  const canEdit = can(user.access, "finance", "EDIT");
  return (
    <>
      <PageHeader
        title="Bank & Cash Accounts"
        description="Balances are computed from opening balance + all transactions — never typed in."
        actions={canEdit ? <FormDialog trigger={<><Plus /> Add account</>} title="Add account" fields={fields} defaults={{ type: "BANK", openingBalance: "0", openingDate: isoDate(todayIST()), isActive: true }} action={saveAccount.bind(null, null)} /> : null}
      />
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-3">
        <StatCard label="Total cash balance" value={formatMoney(total)} hint="All accounts, today" />
        <StatCard label="Accounts" value={accounts.filter((a) => a.isActive).length} hint={`${accounts.length} total`} />
      </div>
      {accounts.length ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {accounts.map((a) => (
            <Card key={a.id} className="p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-semibold">{a.name}</p>
                  <p className="text-xs text-muted">{a.type.replace("_", " ").toLowerCase()}{a.bankName ? ` · ${a.bankName}` : ""}{a.accountLast4 ? ` ····${a.accountLast4}` : ""}</p>
                </div>
                {!a.isActive ? <StatusBadge status="INACTIVE" /> : null}
              </div>
              <p className={`tabular mt-4 text-2xl font-semibold ${a.balance.lt(0) ? "text-danger" : ""}`}>{formatMoney(a.balance)}</p>
              <p className="mt-1 text-xs text-muted">Opening {formatMoney(a.openingBalance)} on {fmtDate(a.openingDate)}</p>
              <div className="mt-4 flex items-center gap-2 border-t border-line pt-3">
                <Link href={`/finance/transactions?accountId=${a.id}`} className="text-[13px] text-brand hover:underline">Transactions</Link>
                <span className="flex-1" />
                {canEdit ? (
                  <FormDialog
                    trigger={<Pencil />} triggerVariant="ghost" triggerSize="icon-sm" title="Edit account" fields={fields} action={saveAccount.bind(null, a.id)}
                    defaults={{ name: a.name, type: a.type, bankName: a.bankName, accountLast4: a.accountLast4, openingBalance: a.openingBalance.toFixed(2), openingDate: isoDate(a.openingDate), isActive: a.isActive, notes: a.notes }}
                  />
                ) : null}
                {can(user.access, "finance", "FULL") ? <ConfirmAction action={deleteAccount.bind(null, a.id)} label={<Trash2 />} variant="ghost" size="icon-sm" title="Delete account?" message="Accounts with transactions are deactivated instead." confirmLabel="Delete" /> : null}
              </div>
            </Card>
          ))}
        </div>
      ) : (
        <Card><EmptyState icon={<Landmark />} title="No accounts yet" description="Add your bank accounts and cash in hand with their opening balances to start tracking cash." /></Card>
      )}
    </>
  );
}
