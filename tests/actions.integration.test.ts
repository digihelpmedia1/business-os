// Exercises the server actions end-to-end (FormData → validation → database) for every module.
// Run with TEST_DATABASE_URL pointing at a disposable database (it is wiped).
import { beforeAll, describe, expect, it, vi } from "vitest";
import { emptyAccess } from "@/lib/permissions";

const hasDb = !!process.env.TEST_DATABASE_URL;

const me = {
  id: "",
  name: "Owner",
  email: "owner@test.local",
  roleId: "",
  roleName: "Admin",
  isAdmin: true,
  access: emptyAccess("FULL"),
  employeeId: null as string | null,
  mustChangePassword: false,
};

vi.mock("@/lib/auth", () => ({
  getCurrentUser: async () => me,
  requireUser: async () => me,
  requirePageAccess: async () => me,
  requireActionAccess: async () => me,
  homePathFor: () => "/dashboard",
}));

function fd(obj: Record<string, string | boolean | File | undefined>) {
  const f = new FormData();
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === false) continue;
    f.set(k, v === true ? "on" : v);
  }
  return f;
}

describe.skipIf(!hasDb)("server actions (integration)", async () => {
  const { db } = await import("@/lib/db");
  const { isoDate, todayIST } = await import("@/lib/dates");
  const clients = await import("@/server/actions/clients");
  const finance = await import("@/server/actions/finance");
  const projects = await import("@/server/actions/projects");
  const vendors = await import("@/server/actions/vendors");
  const assets = await import("@/server/actions/assets");
  const team = await import("@/server/actions/team");
  const planning = await import("@/server/actions/planning");
  const vault = await import("@/server/actions/vault");
  const settings = await import("@/server/actions/settings");
  const billing = await import("@/server/actions/billing");
  const api = await import("@/app/api/v1/[resource]/route");
  const crm = await import("@/app/api/integrations/crm/webhook/route");
  const today = isoDate(todayIST());
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    const tables = await db.$queryRaw<{ tablename: string }[]>`SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
    await db.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(", ")} RESTART IDENTITY CASCADE`);
    for (const [i, key] of ["dashboard", "billing", "finance", "projects", "intelligence", "vendors", "assets", "planning", "team", "reports", "vault", "assistant", "settings", "users"].entries()) {
      await db.permission.create({ data: { key, label: key, sortOrder: i } });
    }
    const role = await db.role.create({ data: { name: "Admin", isSystem: true } });
    const u = await db.user.create({ data: { name: me.name, email: me.email, passwordHash: "x", roleId: role.id } });
    me.id = u.id;
    me.roleId = role.id;
    await db.companySettings.create({ data: { id: 1, stateCode: "27" } });
    await db.category.createMany({
      data: [
        { name: "Software Subscriptions", type: "EXPENSE", kind: "OPERATING_EXPENSE" },
        { name: "Freelancer Payments", type: "EXPENSE", kind: "COST_OF_SERVICES" },
        { name: "Interest Income", type: "INCOME", kind: "OTHER_INCOME" },
      ],
    });
  });

  const ok = (r: { ok: boolean; message?: string; fieldErrors?: Record<string, string> } | null) => {
    if (!r?.ok) throw new Error(`${r?.message} ${JSON.stringify(r?.fieldErrors ?? {})}`);
  };

  it("clients: create, validate, block duplicates", async () => {
    ok(await clients.saveClient(null, null, fd({ name: "Acme", email: "a@acme.in", phone: "+919800000000", stateCode: "27", status: "ACTIVE", country: "India" })));
    const bad = await clients.saveClient(null, null, fd({ name: "Bad", gstin: "NOTAGSTIN", status: "ACTIVE" }));
    expect(bad?.ok).toBe(false);
    expect(bad?.fieldErrors?.gstin).toBeTruthy();
    const dup = await clients.saveClient(null, null, fd({ name: "Acme 2", email: "A@ACME.IN", status: "ACTIVE" }));
    expect(dup?.ok).toBe(false);
    ids.client = (await db.client.findFirstOrThrow()).id;
  });

  it("finance: accounts, categories, expense with GST, transfer, validation", async () => {
    ok(await finance.saveAccount(null, null, fd({ name: "HDFC", type: "BANK", openingBalance: "50,000", openingDate: "2026-04-01", isActive: true })));
    ok(await finance.saveAccount(null, null, fd({ name: "Cash", type: "CASH", openingBalance: "1000", openingDate: "2026-04-01", isActive: true })));
    const [hdfc, cash] = await db.account.findMany({ orderBy: { name: "desc" } });
    ids.account = hdfc!.id;
    ok(await finance.saveCategory(null, null, fd({ name: "Ads (own)", type: "EXPENSE", kind: "OPERATING_EXPENSE", isAcquisition: true, isActive: true })));
    const wrongKind = await finance.saveCategory(null, null, fd({ name: "X", type: "INCOME", kind: "COST_OF_SERVICES", isActive: true }));
    expect(wrongKind?.ok).toBe(false);
    const cat = await db.category.findFirstOrThrow({ where: { name: "Software Subscriptions" } });
    ok(await finance.saveTransaction(null, null, fd({ type: "EXPENSE", date: today, amount: "1180", taxAmount: "180", description: "Canva", categoryId: cat.id, accountId: hdfc!.id })));
    ok(await finance.saveTransaction(null, null, fd({ type: "TRANSFER", date: today, amount: "500", description: "Withdraw", accountId: hdfc!.id, toAccountId: cash!.id })));
    const early = await finance.saveTransaction(null, null, fd({ type: "EXPENSE", date: "2026-01-01", amount: "10", description: "Old", categoryId: cat.id, accountId: hdfc!.id }));
    expect(early?.ok).toBe(false);
    const sameAcct = await finance.saveTransaction(null, null, fd({ type: "TRANSFER", date: today, amount: "5", description: "x", accountId: hdfc!.id, toAccountId: hdfc!.id }));
    expect(sameAcct?.ok).toBe(false);
    const t = await db.transaction.findFirstOrThrow({ where: { description: "Canva" } });
    expect(t.taxAmount.toFixed(2)).toBe("180.00");
    ok(await finance.deleteTransaction(t.id));
    expect((await db.transaction.findUniqueOrThrow({ where: { id: t.id } })).deletedAt).not.toBeNull();
  });

  it("billing: invoice save & issue, payment via form, recurring profile", async () => {
    const r = await billing.saveInvoice(null, {
      type: "NON_GST", clientId: ids.client, projectId: "", relatedInvoiceId: "", issueDate: today, dueDate: today, placeOfSupply: "", periodLabel: "", reverseCharge: false,
      paymentTerms: "", notes: "", terms: "", reason: "", issue: true,
      items: [{ serviceId: "", description: "Ads", details: "", sacCode: "", unit: "", quantity: "1", unitPrice: "10000", discountPercent: "0", taxRate: "0" }],
    });
    ok(r);
    const inv = await db.invoice.findFirstOrThrow();
    expect(inv.number).toMatch(/^BOS\//);
    ok(await billing.recordPaymentAction(inv.id, null, fd({ paymentDate: today, amount: "6000", tdsAmount: "0", method: "UPI", accountId: ids.account })));
    expect((await db.invoice.findUniqueOrThrow({ where: { id: inv.id } })).status).toBe("PARTIALLY_PAID");
    ok(await billing.saveRecurring(null, { name: "Retainer", clientId: ids.client, projectId: "", invoiceType: "NON_GST", frequency: "MONTHLY", startDate: today, endDate: "", dueInDays: "7", autoIssue: "on", isActive: "on", notes: "", items: [{ serviceId: "", description: "Retainer", details: "", sacCode: "", unit: "Month", quantity: "1", unitPrice: "25000", discountPercent: "0", taxRate: "0" }] }));
    ok(await billing.runRecurringNow());
    const generated = await db.invoice.findFirst({ where: { recurringProfileId: { not: null } } });
    expect(generated?.status).toBe("ISSUED");
  });

  it("projects: project, task, subtask, kanban move rules, time entry, notes", async () => {
    ok(await team.saveEmployee(null, null, fd({ type: "EMPLOYEE", name: "Riya", status: "ACTIVE", compensationType: "MONTHLY_SALARY", monthlySalary: "35200", joiningDate: "2026-04-01" })));
    const emp = await db.employee.findFirstOrThrow();
    ids.employee = emp.id;
    expect(await db.salaryRecord.count()).toBe(1);
    const retainerNoFee = await projects.saveProject(null, null, fd({ name: "R", status: "PLANNING", billingType: "RETAINER" }));
    expect(retainerNoFee?.ok).toBe(false);
    ok(await projects.saveProject(null, null, fd({ name: "Acme Meta", clientId: ids.client, managerId: emp.id, status: "IN_PROGRESS", billingType: "RETAINER", monthlyFee: "25000", budget: "50000" })));
    const p = await db.project.findFirstOrThrow();
    ids.project = p.id;
    ok(await projects.saveTask(null, null, fd({ projectId: p.id, title: "Launch", status: "TODO", priority: "HIGH", assigneeId: emp.id, dueDate: today, isRecurring: true })));
    const task = await db.task.findFirstOrThrow();
    ok(await projects.saveTask(null, null, fd({ projectId: p.id, parentId: task.id, title: "Creatives", status: "TODO", priority: "MEDIUM" })));
    const blocked = await projects.moveTask(task.id, "DONE");
    expect(blocked?.ok).toBe(false); // open subtask
    const sub = await db.task.findFirstOrThrow({ where: { parentId: task.id } });
    ok(await projects.moveTask(sub.id, "DONE"));
    ok(await projects.moveTask(task.id, "DONE"));
    ok(await projects.saveTimeEntry(null, null, fd({ employeeId: emp.id, projectId: p.id, taskId: task.id, date: today, hours: "4", billable: true })));
    const te = await db.timeEntry.findFirstOrThrow();
    expect(te.costRate.toFixed(2)).toBe("200.00"); // 35200 / 176
    ok(await projects.addProjectNote(p.id, null, fd({ body: "Kick-off done" })));
    ok(await projects.rollOverRecurringTasks(p.id));
    expect(await db.task.count({ where: { title: "Launch" } })).toBe(2);
    ok(await projects.saveMilestone(p.id, null, null, fd({ title: "Month 1", status: "PENDING", amount: "5000" })));
  });

  it("vendors: duplicate prevention, bill, pay bill", async () => {
    ok(await vendors.saveVendor(null, null, fd({ name: "Pixel Studio", gstin: "27ABCDE1234F1Z5", isActive: true })));
    const dup = await vendors.saveVendor(null, null, fd({ name: "  pixel   STUDIO ", isActive: true }));
    expect(dup?.ok).toBe(false);
    const v = await db.vendor.findFirstOrThrow();
    const cat = await db.category.findFirstOrThrow({ where: { name: "Freelancer Payments" } });
    ok(await vendors.saveBill(null, null, fd({ vendorId: v.id, billNumber: "PS-1", billDate: today, dueDate: today, categoryId: cat.id, subtotal: "5000", taxAmount: "900", projectId: ids.project })));
    const bill = await db.vendorBill.findFirstOrThrow();
    expect(bill.total.toFixed(2)).toBe("5900.00");
    const over = await vendors.payBill(bill.id, null, fd({ date: today, amount: "6000", accountId: ids.account, method: "UPI" }));
    expect(over?.ok).toBe(false);
    ok(await vendors.payBill(bill.id, null, fd({ date: today, amount: "5900", accountId: ids.account, method: "UPI" })));
    expect((await db.vendorBill.findUniqueOrThrow({ where: { id: bill.id } })).status).toBe("PAID");
  });

  it("subscriptions & assets: renew advances date, asset maintenance", async () => {
    ok(await assets.saveSubscription(null, null, fd({ name: "Workspace", kind: "SOFTWARE", billingCycle: "MONTHLY", cost: "1500", renewalDate: "2026-11-15", status: "ACTIVE", autoRenew: true })));
    const s = await db.subscription.findFirstOrThrow();
    ok(await assets.renewSubscription(s.id, null, fd({ date: today, amount: "1500", taxAmount: "0", accountId: ids.account })));
    expect(isoDate((await db.subscription.findUniqueOrThrow({ where: { id: s.id } })).renewalDate)).toBe("2026-12-15");
    expect(await db.transaction.count({ where: { subscriptionId: s.id } })).toBe(1);
    ok(await assets.saveAsset(null, null, fd({ name: "MacBook", category: "LAPTOP", status: "IN_USE", purchaseValue: "150000", assignedEmployeeId: ids.employee })));
    const a = await db.asset.findFirstOrThrow();
    ok(await assets.addMaintenance(a.id, null, fd({ date: today, description: "Battery", cost: "8000" })));
  });

  it("team: attendance, leave approval, payroll duplicate guard", async () => {
    const f = new FormData();
    f.set(`status_${ids.employee}`, "PRESENT");
    ok(await team.saveAttendance(today, null, f));
    expect(await db.attendance.count()).toBe(1);
    ok(await team.applyLeave(null, fd({ employeeId: ids.employee, type: "SICK", startDate: "2026-12-01", endDate: "2026-12-02" })));
    const leave = await db.leaveRecord.findFirstOrThrow();
    expect(leave.status).toBe("APPROVED"); // recorded by a manager
    expect(Number(leave.days)).toBe(2);
    const overlap = await team.applyLeave(null, fd({ employeeId: ids.employee, type: "CASUAL", startDate: "2026-12-02", endDate: "2026-12-03" }));
    expect(overlap?.ok).toBe(false);
    const month = today.slice(0, 7);
    ok(await team.recordPayout(null, fd({ employeeId: ids.employee, payrollMonth: month, date: today, amount: "35200", accountId: ids.account, method: "BANK_TRANSFER" })));
    const again = await team.recordPayout(null, fd({ employeeId: ids.employee, payrollMonth: month, date: today, amount: "35200", accountId: ids.account, method: "BANK_TRANSFER" }));
    expect(again?.ok).toBe(false);
  });

  it("planning: goal and budget", async () => {
    ok(await planning.saveGoal(null, null, fd({ title: "Revenue", metric: "REVENUE", periodType: "QUARTER", periodStart: today, target: "300000" })));
    const g = await db.financialGoal.findFirstOrThrow();
    expect(g.periodStart.getUTCDate()).toBe(1);
    const cat = await db.category.findFirstOrThrow({ where: { name: "Software Subscriptions" } });
    ok(await planning.saveBudget(null, null, fd({ categoryId: cat.id, periodType: "MONTH", periodStart: today, amount: "10000" })));
    const dup = await planning.saveBudget(null, null, fd({ categoryId: cat.id, periodType: "MONTH", periodStart: today, amount: "9000" }));
    expect(dup?.ok).toBe(false);
  });

  it("vault: upload with type and size checks", async () => {
    const pdf = new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], "agreement.pdf", { type: "application/pdf" });
    ok(await vault.uploadDocument(null, fd({ title: "Agreement", category: "CLIENT_AGREEMENT", clientId: ids.client, file: pdf })));
    const exe = new File([new Uint8Array([1])], "x.exe", { type: "application/x-msdownload" });
    const bad = await vault.uploadDocument(null, fd({ title: "Bad", category: "OTHER", file: exe }));
    expect(bad?.ok).toBe(false);
    expect(await db.fileBlob.count()).toBe(1);
  });

  it("settings: company GST validation, numbering limit, roles & users", async () => {
    const base = { companyName: "DHM", primaryColor: "#005CFF", secondaryColor: "#F65000", fyStartMonth: "4", defaultDueDays: "15", quoteValidityDays: "15", salaryPayDay: "7" };
    const noGstin = await settings.saveCompany(null, fd({ ...base, gstRegistered: true }));
    expect(noGstin?.ok).toBe(false);
    const mismatch = await settings.saveCompany(null, fd({ ...base, gstRegistered: true, gstin: "29ABCDE1234F1Z5", stateCode: "27" }));
    expect(mismatch?.ok).toBe(false);
    ok(await settings.saveCompany(null, fd({ ...base, gstRegistered: true, gstin: "27ABCDE1234F1Z5", stateCode: "27", pan: "ABCDE1234F" })));
    const tooLong = await settings.saveSeries("TAX_INVOICE", null, fd({ prefix: "DHMINVOICE", padding: "5", includeFy: true }));
    expect(tooLong?.ok).toBe(false);
    const roleFd = fd({ name: "Editor", description: "Edits projects" });
    roleFd.set("level_projects", "EDIT");
    roleFd.set("level_vault", "VIEW");
    ok(await settings.saveRole(null, null, roleFd));
    const role = await db.role.findFirstOrThrow({ where: { name: "Editor" }, include: { permissions: { include: { permission: true } } } });
    expect(role.permissions.find((p) => p.permission.key === "projects")?.level).toBe("EDIT");
    expect(role.permissions.find((p) => p.permission.key === "finance")?.level).toBe("NONE");
    const weak = await settings.saveUser(null, null, fd({ name: "Staff", email: "staff@test.local", roleId: role.id, isActive: true, password: "short" }));
    expect(weak?.ok).toBe(false);
    ok(await settings.saveUser(null, null, fd({ name: "Staff", email: "staff@test.local", roleId: role.id, isActive: true, password: "Strong-pass-123", employeeId: ids.employee })));
    expect((await db.employee.findUniqueOrThrow({ where: { id: ids.employee } })).userId).not.toBeNull();
    const lastAdmin = await settings.saveUser(me.id, null, fd({ name: me.name, email: me.email, roleId: role.id, isActive: true }));
    expect(lastAdmin?.ok).toBe(false);
  });

  it("integrations: scoped API key, REST API, CRM webhook upsert without duplicates", async () => {
    const created = await settings.createApiKey(null, fd({ name: "CRM", "scope_clients:write": true, "scope_clients:read": true }));
    ok(created);
    const key = created!.message!.match(/dhm_[\w-]+/)![0];
    const auth = { authorization: `Bearer ${key}`, "content-type": "application/json" };
    const params = (resource: string) => ({ params: Promise.resolve({ resource }) });
    expect((await api.GET(new Request("http://x/api/v1/clients"), params("clients"))).status).toBe(401);
    expect((await api.GET(new Request("http://x/api/v1/invoices", { headers: auth }), params("invoices"))).status).toBe(403);
    const list = await api.GET(new Request("http://x/api/v1/clients?limit=10", { headers: auth }), params("clients"));
    expect(list.status).toBe(200);
    expect(((await list.json()) as { data: unknown[] }).data.length).toBe(1);
    const post = await api.POST(new Request("http://x/api/v1/clients", { method: "POST", headers: auth, body: JSON.stringify({ externalId: "CRM-9", full_name: "Zeta Foods", phone_number: "+91 99999 00000" }) }), params("clients"));
    expect(post.status).toBe(200);
    // Same lead again from the CRM's webhook → updated, not duplicated. Non-converted leads are ignored.
    const ignored = await crm.POST(new Request("http://x", { method: "POST", headers: auth, body: JSON.stringify({ event: "lead.status_changed", lead: { id: "CRM-10", full_name: "New lead", status: "Interested" } }) }));
    expect(ignored.status).toBe(202);
    const conv = await crm.POST(new Request("http://x", { method: "POST", headers: auth, body: JSON.stringify({ event: "lead.status_changed", lead: { id: "CRM-9", full_name: "Zeta Foods Pvt Ltd", status: "Converted" } }) }));
    expect(((await conv.json()) as { created: boolean }).created).toBe(false);
    expect(await db.client.count({ where: { externalCrmId: "CRM-9" } })).toBe(1);
    // Manually created client with same email gets linked instead of duplicated.
    await api.POST(new Request("http://x/api/v1/clients", { method: "POST", headers: auth, body: JSON.stringify({ externalId: "CRM-1", name: "Acme", email: "a@acme.in" }) }), params("clients"));
    expect(await db.client.count({ where: { deletedAt: null } })).toBe(2);
    ok(await settings.saveWebhook(null, null, fd({ name: "n8n", url: "http://127.0.0.1:9/hook", isActive: true, "event_*": true })));
    expect((await db.webhook.findFirstOrThrow()).secret).toMatch(/^whsec_/);
  });
});
