import { requirePageAccess } from "@/lib/auth";
import { assistantConfigured, ASSISTANT_MODEL, quickFacts } from "@/lib/assistant";
import { formatMoney } from "@/lib/money";
import { getDisplayCurrency } from "@/lib/settings";
import { Notice, PageHeader, StatCard } from "@/components/ui/primitives";
import { AssistantChat } from "@/components/assistant-chat";

export const metadata = { title: "AI Business Assistant" };

export default async function AssistantPage() {
  const user = await requirePageAccess("assistant");
  const configured = assistantConfigured();
  const [facts, currency] = await Promise.all([quickFacts(user.access), getDisplayCurrency()]);
  return (
    <>
      <PageHeader
        title="AI Business Assistant"
        description={configured ? `Read-only analyst powered by Claude (${ASSISTANT_MODEL}). It only sees modules your role can access.` : "Optional AI analyst for your business data."}
      />
      {!configured ? (
        <Notice tone="warning" className="mb-4">
          The assistant is not configured. An administrator can enable it by adding <code>ANTHROPIC_API_KEY</code> (and optionally <code>ANTHROPIC_MODEL</code>) to the server environment — no other setup is needed. Everything else in DHM Business OS works without it.
        </Notice>
      ) : null}
      {facts ? (
        <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-5">
          <StatCard label="Revenue this month" value={formatMoney(facts.revenue, { currency, compact: true })} />
          <StatCard label="Net profit this month" value={formatMoney(facts.netProfit, { currency, compact: true })} tone={facts.netProfit.lt(0) ? "danger" : "default"} />
          <StatCard label="Cash received this month" value={formatMoney(facts.cashIn, { currency, compact: true })} />
          <StatCard label="Pending from clients" value={formatMoney(facts.receivables, { currency, compact: true })} />
          <StatCard label="MRR" value={facts.mrr ? formatMoney(facts.mrr, { currency, compact: true }) : "Insufficient Data"} />
        </div>
      ) : null}
      <AssistantChat configured={configured} />
    </>
  );
}
