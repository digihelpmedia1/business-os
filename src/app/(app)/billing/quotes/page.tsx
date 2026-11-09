import { FileText, Plus } from "lucide-react";
import type { Prisma } from "@prisma/client";
import { requirePageAccess } from "@/lib/auth";
import { db } from "@/lib/db";
import { can } from "@/lib/permissions";
import { parseList, param, type SearchParams } from "@/lib/list";
import { formatMoney } from "@/lib/money";
import { fmtDate, todayIST } from "@/lib/dates";
import { clientOptions } from "@/lib/options";
import { PageHeader, Badge } from "@/components/ui/primitives";
import { LinkButton } from "@/components/ui/button";
import { DataTable, LinkTabs, type Column } from "@/components/ui/data-table";
import { ListToolbar } from "@/components/ui/list-toolbar";
import { StatusBadge } from "@/components/status-badge";
import { withParams } from "@/lib/list";

export const metadata = { title: "Proposals & Quotations" };

const KIND_LABEL = { PROPOSAL: "Proposal", QUOTATION: "Quotation", ESTIMATE: "Estimate" } as const;

export default async function QuotesPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const user = await requirePageAccess("billing");
  const sp = await searchParams;
  const list = parseList(sp, { sortable: ["issueDate", "number", "total", "status", "expiryDate"] as const, defaultSort: "issueDate" });
  const kind = param(sp, "kind") as keyof typeof KIND_LABEL | undefined;
  const status = param(sp, "status");
  const clientId = param(sp, "clientId");
  const where: Prisma.QuoteWhereInput = {
    deletedAt: null,
    ...(kind && KIND_LABEL[kind] ? { kind } : {}),
    ...(status ? { status: status as "DRAFT" } : {}),
    ...(clientId ? { clientId } : {}),
    ...(list.q ? { OR: [{ number: { contains: list.q, mode: "insensitive" } }, { title: { contains: list.q, mode: "insensitive" } }, { client: { name: { contains: list.q, mode: "insensitive" } } }] } : {}),
  };
  const [rows, total, counts, clients] = await Promise.all([
    db.quote.findMany({ where, include: { client: { select: { name: true } } }, orderBy: [{ [list.sort]: list.dir }, { createdAt: "desc" }], skip: list.skip, take: list.pageSize }),
    db.quote.count({ where }),
    db.quote.groupBy({ by: ["kind"], where: { deletedAt: null }, _count: true }),
    clientOptions(),
  ]);
  const today = todayIST();
  type Row = (typeof rows)[number];
  const columns: Column<Row>[] = [
    { key: "number", header: "Number", sortKey: "number", render: (q) => <span className="font-mono text-[13px]">{q.number}</span> },
    { key: "title", header: "Title", render: (q) => <span><span className="block">{q.title}</span><span className="text-xs text-muted">{KIND_LABEL[q.kind]}{q.version > 1 ? ` · v${q.version}` : ""}</span></span> },
    { key: "client", header: "Client", render: (q) => q.client.name },
    { key: "date", header: "Date", sortKey: "issueDate", render: (q) => fmtDate(q.issueDate) },
    { key: "expiry", header: "Valid until", sortKey: "expiryDate", render: (q) => <span className={q.expiryDate && q.expiryDate < today && q.status === "SENT" ? "text-danger" : ""}>{fmtDate(q.expiryDate)}</span> },
    { key: "status", header: "Status", sortKey: "status", render: (q) => <span className="flex flex-wrap gap-1"><StatusBadge status={q.status} />{q.convertedInvoiceId ? <Badge tone="success">Invoiced</Badge> : null}</span> },
    { key: "total", header: "Total", sortKey: "total", align: "right", render: (q) => formatMoney(q.total) },
  ];
  const count = (k?: string) => (k ? (counts.find((c) => c.kind === k)?._count ?? 0) : counts.reduce((a, c) => a + c._count, 0));

  return (
    <>
      <PageHeader
        title="Proposals & Quotations"
        description="Create branded proposals, quotations and service estimates, track versions and convert accepted ones into invoices."
        actions={
          can(user.access, "billing", "EDIT") ? (
            <>
              <LinkButton href="/billing/quotes/new?kind=QUOTATION" variant="outline"><Plus /> Quotation</LinkButton>
              <LinkButton href="/billing/quotes/new?kind=PROPOSAL"><Plus /> New proposal</LinkButton>
            </>
          ) : null
        }
      />
      <LinkTabs
        active={kind ?? "all"}
        tabs={[
          { key: "all", label: "All", href: withParams("/billing/quotes", sp, { kind: null, page: null }), count: count() },
          { key: "PROPOSAL", label: "Proposals", href: withParams("/billing/quotes", sp, { kind: "PROPOSAL", page: null }), count: count("PROPOSAL") },
          { key: "QUOTATION", label: "Quotations", href: withParams("/billing/quotes", sp, { kind: "QUOTATION", page: null }), count: count("QUOTATION") },
          { key: "ESTIMATE", label: "Estimates", href: withParams("/billing/quotes", sp, { kind: "ESTIMATE", page: null }), count: count("ESTIMATE") },
        ]}
      />
      <DataTable
        columns={columns}
        rows={rows}
        basePath="/billing/quotes"
        searchParams={sp}
        sort={list.sort}
        dir={list.dir}
        total={total}
        page={list.page}
        pageSize={list.pageSize}
        rowHref={(q) => `/billing/quotes/${q.id}`}
        toolbar={
          <ListToolbar
            placeholder="Search number, title, client…"
            filters={[
              { type: "select", name: "status", label: "Status", options: ["DRAFT", "SENT", "ACCEPTED", "REJECTED", "EXPIRED"].map((s) => ({ value: s, label: s.charAt(0) + s.slice(1).toLowerCase() })) },
              { type: "select", name: "clientId", label: "Client", options: clients },
            ]}
          />
        }
        empty={{ icon: <FileText />, title: "No documents yet", description: "Start from a template for Meta Ads, Google Ads, social media, video editing, AI automation or a custom package." }}
      />
    </>
  );
}
