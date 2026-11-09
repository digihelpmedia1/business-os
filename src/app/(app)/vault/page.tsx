import { Download, FileText, FolderLock, Pencil, Trash2, Upload, History } from "lucide-react";
import type { Prisma } from "@prisma/client";
import { requirePageAccess } from "@/lib/auth";
import { db } from "@/lib/db";
import { can } from "@/lib/permissions";
import { parseList, param, type SearchParams, orderByField } from "@/lib/list";
import { fmtDate, fmtDateTime, isoDate, todayIST } from "@/lib/dates";
import { clientOptions, employeeOptions, projectOptions, vendorOptions, type Option } from "@/lib/options";
import { PageHeader, Badge, Card, CardHeader } from "@/components/ui/primitives";
import { DataTable, type Column } from "@/components/ui/data-table";
import { ListToolbar } from "@/components/ui/list-toolbar";
import { FormDialog, type FieldDef } from "@/components/ui/form-dialog";
import { ConfirmAction } from "@/components/ui/confirm-action";
import { deleteDocument, updateDocument, uploadDocument } from "@/server/actions/vault";
import { MAX_UPLOAD_BYTES } from "@/lib/storage";

export const metadata = { title: "Document Vault" };

const CATEGORIES: Option[] = [
  { value: "CLIENT_AGREEMENT", label: "Client agreements" }, { value: "VENDOR_AGREEMENT", label: "Vendor agreements" }, { value: "INVOICE", label: "Invoices" },
  { value: "QUOTATION", label: "Quotations" }, { value: "PROPOSAL", label: "Proposals" }, { value: "PURCHASE_BILL", label: "Purchase bills" },
  { value: "COMPANY", label: "Company documents" }, { value: "TAX", label: "Tax documents" }, { value: "EMPLOYEE", label: "Employee documents" },
  { value: "POLICY", label: "Business policies" }, { value: "SOP", label: "SOPs" }, { value: "OTHER", label: "Other" },
];

export default async function VaultPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const user = await requirePageAccess("vault");
  const sp = await searchParams;
  const list = parseList(sp, { sortable: ["createdAt", "title", "expiresAt"] as const, defaultSort: "createdAt" });
  const seeEmployeeDocs = can(user.access, "team");
  const category = param(sp, "category");
  const where: Prisma.DocumentWhereInput = {
    deletedAt: null,
    ...(category ? { category: category as "SOP" } : {}),
    ...(!seeEmployeeDocs ? { category: category && category !== "EMPLOYEE" ? (category as "SOP") : { not: "EMPLOYEE" } } : {}),
    ...(param(sp, "clientId") ? { clientId: param(sp, "clientId") } : {}),
    ...(param(sp, "projectId") ? { projectId: param(sp, "projectId") } : {}),
    ...(param(sp, "vendorId") ? { vendorId: param(sp, "vendorId") } : {}),
    ...(param(sp, "expiring") === "1" ? { expiresAt: { not: null, lte: new Date(todayIST().getTime() + 60 * 86_400_000) } } : {}),
    ...(list.q ? { OR: [{ title: { contains: list.q, mode: "insensitive" } }, { description: { contains: list.q, mode: "insensitive" } }, { file: { fileName: { contains: list.q, mode: "insensitive" } } }] } : {}),
  };
  const [rows, total, clients, projects, vendors, employees, uploads] = await Promise.all([
    db.document.findMany({
      where,
      include: { file: { select: { fileName: true, size: true, mimeType: true } }, client: { select: { name: true } }, project: { select: { name: true } }, vendor: { select: { name: true } }, employee: { select: { name: true } }, uploadedBy: { select: { name: true } } },
      orderBy: [orderByField(list.sort, list.dir, ["expiresAt"])],
      skip: list.skip,
      take: list.pageSize,
    }),
    db.document.count({ where }),
    clientOptions(),
    projectOptions(),
    vendorOptions(),
    seeEmployeeDocs ? employeeOptions({ includeExited: true }) : Promise.resolve([]),
    db.auditLog.findMany({ where: { entityType: "Document", action: { in: ["UPLOAD", "DELETE", "UPDATE"] } }, include: { user: { select: { name: true } } }, orderBy: { createdAt: "desc" }, take: 10 }),
  ]);
  const cats = seeEmployeeDocs ? CATEGORIES : CATEGORIES.filter((c) => c.value !== "EMPLOYEE");
  const fields = (withFile: boolean): FieldDef[] => [
    ...(withFile ? [{ name: "file", label: `File (max ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} MB — PDF, images, Office, CSV, ZIP)`, type: "file", required: true, span: 2 } as FieldDef] : []),
    { name: "title", label: "Title", required: true, span: 2 },
    { name: "category", label: "Category", type: "select", options: cats, emptyOption: false },
    { name: "expiresAt", label: "Expiry / renewal date", type: "date", hint: "For agreements — you'll get a reminder" },
    { name: "clientId", label: "Client", type: "select", options: clients },
    { name: "projectId", label: "Project", type: "select", options: projects },
    { name: "vendorId", label: "Vendor", type: "select", options: vendors },
    ...(seeEmployeeDocs ? [{ name: "employeeId", label: "Employee", type: "select", options: employees } as FieldDef] : []),
    { name: "description", label: "Description", type: "textarea" },
  ];
  const canEdit = can(user.access, "vault", "EDIT");
  const today = todayIST();
  type Row = (typeof rows)[number];
  const columns: Column<Row>[] = [
    { key: "title", header: "Document", sortKey: "title", render: (d) => <span className="flex items-start gap-2"><FileText className="mt-0.5 h-4 w-4 shrink-0 text-muted" /><span><a href={`/api/files/${d.fileId}`} target="_blank" className="font-medium hover:text-brand">{d.title}</a><span className="block text-xs text-muted">{d.file.fileName} · {Math.max(1, Math.round(d.file.size / 1024))} KB</span></span></span> },
    { key: "cat", header: "Category", render: (d) => <Badge>{CATEGORIES.find((c) => c.value === d.category)?.label}</Badge> },
    { key: "links", header: "Linked to", render: (d) => <span className="text-[13px] text-muted">{[d.client?.name, d.project?.name, d.vendor?.name, d.employee?.name].filter(Boolean).join(" · ") || "—"}</span> },
    { key: "exp", header: "Expires", sortKey: "expiresAt", render: (d) => (d.expiresAt ? <span className={d.expiresAt < today ? "text-danger" : ""}>{fmtDate(d.expiresAt)}</span> : "—") },
    { key: "up", header: "Uploaded", sortKey: "createdAt", render: (d) => <span className="text-[13px]">{fmtDate(isoDate(d.createdAt))}<span className="block text-xs text-muted">{d.uploadedBy?.name}</span></span> },
    {
      key: "a", header: "", align: "right",
      render: (d) => (
        <div className="flex justify-end gap-1">
          <a href={`/api/files/${d.fileId}?download=1`} className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted hover:bg-surface-2" aria-label="Download"><Download className="h-4 w-4" /></a>
          {canEdit ? <FormDialog trigger={<Pencil />} triggerVariant="ghost" triggerSize="icon-sm" title="Edit document details" fields={fields(false)} defaults={{ title: d.title, category: d.category, expiresAt: isoDate(d.expiresAt), clientId: d.clientId, projectId: d.projectId, vendorId: d.vendorId, employeeId: d.employeeId, description: d.description }} action={updateDocument.bind(null, d.id)} size="lg" /> : null}
          {can(user.access, "vault", "FULL") ? <ConfirmAction action={deleteDocument.bind(null, d.id)} label={<Trash2 />} variant="ghost" size="icon-sm" title="Delete document?" message="It will be removed from the vault (kept in the audit log)." confirmLabel="Delete" /> : null}
        </div>
      ),
    },
  ];
  return (
    <>
      <PageHeader
        title="Document Vault"
        description="Agreements, bills, tax papers, policies and SOPs — stored privately; every download is checked and logged."
        actions={canEdit ? <FormDialog trigger={<><Upload /> Upload</>} title="Upload document" fields={fields(true)} defaults={{ category: "OTHER", projectId: param(sp, "projectId"), clientId: param(sp, "clientId") }} action={uploadDocument} size="lg" /> : null}
      />
      <DataTable
        columns={columns}
        rows={rows}
        basePath="/vault"
        searchParams={sp}
        sort={list.sort}
        dir={list.dir}
        total={total}
        page={list.page}
        pageSize={list.pageSize}
        toolbar={
          <ListToolbar
            placeholder="Search title, description, file name…"
            filters={[
              { type: "select", name: "category", label: "Category", options: cats },
              { type: "select", name: "clientId", label: "Client", options: clients },
              { type: "select", name: "projectId", label: "Project", options: projects },
              { type: "select", name: "vendorId", label: "Vendor", options: vendors },
              { type: "select", name: "expiring", label: "Expiry", options: [{ value: "1", label: "Expiring ≤ 60 days" }] },
            ]}
          />
        }
        empty={{ icon: <FolderLock />, title: "No documents found", description: "Upload agreements, bills, tax documents, policies and SOPs." }}
      />
      <Card className="mt-6">
        <CardHeader title="Recent upload history" action={can(user.access, "users") ? <a href="/settings/audit?entityType=Document" className="text-[13px] text-brand">Full log</a> : null} />
        <ul className="divide-y divide-line">
          {uploads.length ? uploads.map((u) => (
            <li key={u.id} className="flex items-center gap-3 px-5 py-2.5 text-[13px]"><History className="h-4 w-4 text-subtle" /><span className="flex-1">{u.summary}</span><span className="text-xs text-muted">{u.user?.name} · {fmtDateTime(u.createdAt)}</span></li>
          )) : <li className="px-5 py-6 text-center text-[13px] text-muted">No uploads yet.</li>}
        </ul>
      </Card>
    </>
  );
}
