/* eslint-disable no-console */
// Idempotent setup data: modules, preset roles, first admin, configuration
// defaults, categories, services and document templates. NO financial or demo data.
import { PrismaClient, type CategoryKind, type CategoryType, type QuoteKind } from "@prisma/client";
import bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";
import { MODULES, PRESET_ROLES } from "../src/lib/permissions";
import { DEFAULT_SERIES } from "../src/lib/numbering-defaults";

const db = new PrismaClient();

const CATEGORIES: { name: string; type: CategoryType; kind: CategoryKind; isAcquisition?: boolean; description?: string }[] = [
  // Income
  { name: "Client Payments", type: "INCOME", kind: "REVENUE", description: "Created automatically when an invoice payment is recorded" },
  { name: "Service Revenue (no invoice)", type: "INCOME", kind: "REVENUE" },
  { name: "One-time Project Income", type: "INCOME", kind: "REVENUE" },
  { name: "Interest Income", type: "INCOME", kind: "OTHER_INCOME" },
  { name: "Other Income", type: "INCOME", kind: "OTHER_INCOME" },
  { name: "Capital Introduced", type: "INCOME", kind: "OWNER_EQUITY" },
  { name: "Tax Refund", type: "INCOME", kind: "TAX_SETTLEMENT" },
  { name: "Asset Sale Proceeds", type: "INCOME", kind: "CAPITAL_EXPENDITURE" },
  // Expenses
  { name: "Office Rent", type: "EXPENSE", kind: "OPERATING_EXPENSE" },
  { name: "Office Expenses", type: "EXPENSE", kind: "OPERATING_EXPENSE" },
  { name: "Internet & Utilities", type: "EXPENSE", kind: "OPERATING_EXPENSE" },
  { name: "Software Subscriptions", type: "EXPENSE", kind: "OPERATING_EXPENSE" },
  { name: "Hosting & Domains", type: "EXPENSE", kind: "OPERATING_EXPENSE" },
  { name: "Own Marketing & Advertising", type: "EXPENSE", kind: "OPERATING_EXPENSE", isAcquisition: true, description: "Spend to acquire new clients (used for CAC)" },
  { name: "Salaries & Wages", type: "EXPENSE", kind: "OPERATING_EXPENSE" },
  { name: "Freelancer Payments", type: "EXPENSE", kind: "COST_OF_SERVICES" },
  { name: "Client Ad Spend (billable)", type: "EXPENSE", kind: "COST_OF_SERVICES" },
  { name: "Production & Stock Assets", type: "EXPENSE", kind: "COST_OF_SERVICES" },
  { name: "Travel & Conveyance", type: "EXPENSE", kind: "OPERATING_EXPENSE" },
  { name: "Professional Fees", type: "EXPENSE", kind: "OPERATING_EXPENSE" },
  { name: "Training & Education", type: "EXPENSE", kind: "OPERATING_EXPENSE" },
  { name: "Repairs & Maintenance", type: "EXPENSE", kind: "OPERATING_EXPENSE" },
  { name: "Miscellaneous Expenses", type: "EXPENSE", kind: "OPERATING_EXPENSE" },
  { name: "Bank Charges", type: "EXPENSE", kind: "NON_OPERATING" },
  { name: "Interest & Penalties", type: "EXPENSE", kind: "NON_OPERATING" },
  { name: "Equipment Purchases", type: "EXPENSE", kind: "CAPITAL_EXPENDITURE" },
  { name: "GST Payment", type: "EXPENSE", kind: "TAX_SETTLEMENT" },
  { name: "TDS / Income Tax Payment", type: "EXPENSE", kind: "TAX_SETTLEMENT" },
  { name: "Owner Drawings", type: "EXPENSE", kind: "OWNER_EQUITY" },
];

const SERVICES = [
  { name: "Meta Ads Management", category: "Paid Media", description: "Facebook & Instagram ad campaign strategy, setup, optimisation and reporting." },
  { name: "Google Ads Management", category: "Paid Media", description: "Search, Display, YouTube and Performance Max campaign management." },
  { name: "Performance Marketing", category: "Paid Media", description: "Full-funnel, ROI-focused multi-channel performance campaigns." },
  { name: "Lead Generation", category: "Growth", description: "Lead-generation campaigns, landing pages and lead qualification flows." },
  { name: "Social Media Management", category: "Content", description: "Content calendar, creatives, posting and community management." },
  { name: "Video & Reel Editing", category: "Content", description: "Short-form reels, ad creatives and long-form video editing.", unit: "Video" },
  { name: "AI Automation", category: "Technology", description: "Workflow automation, AI agents and integrations.", unit: "Project" },
  { name: "WhatsApp AI Calling & Automation", category: "Technology", description: "WhatsApp Business API automation, AI calling and chat flows." },
];

const COMMON_TERMS = `1. This document is valid until the expiry date mentioned above.
2. Advertising budgets (ad spend) are paid directly by the client to the platform and are not included unless stated.
3. Work begins after written acceptance and receipt of the advance payment (if applicable).
4. Applicable taxes will be charged as per prevailing law.
5. Results from paid media depend on budget, market and platform factors; no specific outcome is guaranteed.
6. Either party may terminate a monthly engagement with 30 days' written notice.`;

const TEMPLATES: {
  name: string; kind: QuoteKind; service?: string; title: string; introduction: string; scopeOfWork: string; deliverables: string; timeline: string; paymentTerms: string;
  items: { description: string; details?: string; quantity: string; unit?: string }[];
}[] = [
  {
    name: "Meta Ads Management", kind: "PROPOSAL", service: "Meta Ads Management", title: "Meta Ads Management Proposal",
    introduction: "Thank you for considering Digi Help Media. This proposal outlines how we will plan, run and optimise your Facebook and Instagram advertising to generate measurable business results.",
    scopeOfWork: "• Business, audience and competitor research\n• Pixel / Conversions API & event setup verification\n• Campaign architecture (prospecting, retargeting, lookalikes)\n• Ad copy and creative direction\n• Daily monitoring, budget pacing and bid optimisation\n• A/B testing of audiences, creatives and placements",
    deliverables: "• Campaign strategy document\n• Up to 3 active campaigns per month\n• Weekly performance snapshot\n• Monthly performance report with recommendations",
    timeline: "Week 1: Onboarding, audit & tracking setup\nWeek 2: Campaign launch\nOngoing: Optimisation and monthly review",
    paymentTerms: "Monthly management fee payable in advance. Ad spend billed directly by Meta to the client.",
    items: [{ description: "Meta Ads Management — monthly retainer", details: "Facebook & Instagram campaign management", quantity: "1", unit: "Month" }],
  },
  {
    name: "Google Ads Management", kind: "PROPOSAL", service: "Google Ads Management", title: "Google Ads Management Proposal",
    introduction: "This proposal covers end-to-end management of your Google Ads account to capture high-intent demand and maximise return on ad spend.",
    scopeOfWork: "• Account audit and keyword research\n• Conversion tracking (GA4 / Google Tag) verification\n• Search, Performance Max, Display and YouTube campaigns as relevant\n• Negative keyword management and search-term mining\n• Ad copy, extensions/assets and landing-page recommendations\n• Bid strategy and budget optimisation",
    deliverables: "• Keyword & campaign plan\n• Weekly optimisation log\n• Monthly performance report",
    timeline: "Week 1: Audit & setup\nWeek 2: Launch\nOngoing: Optimisation",
    paymentTerms: "Monthly management fee payable in advance. Ad spend billed directly by Google to the client.",
    items: [{ description: "Google Ads Management — monthly retainer", quantity: "1", unit: "Month" }],
  },
  {
    name: "Performance Marketing", kind: "PROPOSAL", service: "Performance Marketing", title: "Performance Marketing Proposal",
    introduction: "A full-funnel performance marketing engagement across paid channels, focused on cost per lead / acquisition and revenue outcomes.",
    scopeOfWork: "• Funnel and offer strategy\n• Multi-channel campaign management (Meta, Google)\n• Landing page CRO recommendations\n• Tracking, attribution and reporting dashboards\n• Creative testing roadmap",
    deliverables: "• Growth plan with KPI targets\n• Bi-weekly review calls\n• Monthly performance & insights report",
    timeline: "Month 1: Setup and testing\nMonth 2–3: Scale winning campaigns",
    paymentTerms: "Monthly fee payable in advance.",
    items: [{ description: "Performance Marketing — monthly retainer", quantity: "1", unit: "Month" }],
  },
  {
    name: "Social Media Management", kind: "PROPOSAL", service: "Social Media Management", title: "Social Media Management Proposal",
    introduction: "We will build a consistent, on-brand social presence that grows engagement and supports your marketing goals.",
    scopeOfWork: "• Monthly content calendar\n• Post and story creatives\n• Captions and hashtags\n• Scheduling and publishing\n• Community management (business hours)",
    deliverables: "• Agreed number of posts and reels per month\n• Monthly analytics report",
    timeline: "Calendar shared by the 25th of the previous month for approval.",
    paymentTerms: "Monthly fee payable in advance.",
    items: [{ description: "Social Media Management — monthly retainer", quantity: "1", unit: "Month" }],
  },
  {
    name: "Video Editing", kind: "QUOTATION", service: "Video & Reel Editing", title: "Video & Reel Editing Quotation",
    introduction: "Quotation for professional video and reel editing.",
    scopeOfWork: "• Editing of client-supplied footage\n• Cuts, transitions, captions/subtitles\n• Background music (royalty-free) and basic colour correction\n• Export in platform-ready formats",
    deliverables: "• Final edited videos in agreed formats\n• Up to 2 rounds of revisions per video",
    timeline: "Standard turnaround: 2–3 working days per video after footage is received.",
    paymentTerms: "50% advance, balance on delivery.",
    items: [{ description: "Reel / short video editing (up to 60 sec)", quantity: "10", unit: "Video" }],
  },
  {
    name: "AI Automation", kind: "PROPOSAL", service: "AI Automation", title: "AI Automation Proposal",
    introduction: "This proposal covers designing and implementing AI-powered automations to save time and improve response speed.",
    scopeOfWork: "• Process discovery workshop\n• Automation design and tool selection\n• Build, integrate and test workflows\n• Team handover and documentation",
    deliverables: "• Working automations as per agreed scope\n• Documentation and walkthrough\n• 30 days of post-launch support",
    timeline: "Discovery: 1 week · Build: 2–3 weeks · Testing & handover: 1 week",
    paymentTerms: "50% advance, 50% on go-live.",
    items: [{ description: "AI automation implementation", quantity: "1", unit: "Project" }],
  },
  {
    name: "Custom Package", kind: "QUOTATION", title: "Digital Marketing Package",
    introduction: "A custom digital marketing package tailored to your goals.",
    scopeOfWork: "Describe the agreed scope here.",
    deliverables: "List the deliverables here.",
    timeline: "Outline the timeline here.",
    paymentTerms: "Monthly fee payable in advance.",
    items: [{ description: "Custom service", quantity: "1", unit: "Month" }],
  },
];

async function main() {
  // Modules (permissions)
  for (const [i, m] of MODULES.entries()) {
    await db.permission.upsert({
      where: { key: m.key },
      create: { key: m.key, label: m.label, description: m.description, sortOrder: i },
      update: { label: m.label, description: m.description, sortOrder: i },
    });
  }
  const permissions = await db.permission.findMany();

  // Preset roles (only created if missing — admin edits are preserved)
  for (const preset of PRESET_ROLES) {
    const existing = await db.role.findUnique({ where: { name: preset.name } });
    if (existing) {
      if (preset.isSystem) {
        for (const p of permissions) {
          await db.rolePermission.upsert({
            where: { roleId_permissionId: { roleId: existing.id, permissionId: p.id } },
            create: { roleId: existing.id, permissionId: p.id, level: "FULL" },
            update: { level: "FULL" },
          });
        }
      }
      continue;
    }
    await db.role.create({
      data: {
        name: preset.name,
        description: preset.description,
        isSystem: !!preset.isSystem,
        permissions: {
          create: permissions.map((p) => ({ permissionId: p.id, level: preset.access[p.key as keyof typeof preset.access] ?? "NONE" })),
        },
      },
    });
  }

  // Company settings & document numbering
  await db.companySettings.upsert({
    where: { id: 1 },
    create: {
      id: 1,
      companyName: "Digi Help Media",
      website: "https://digihelpmedia.com/",
      defaultQuoteTerms: COMMON_TERMS,
      defaultInvoiceTerms: "1. Please pay by the due date mentioned above.\n2. Interest may be charged on overdue amounts as per agreed terms.\n3. This is a computer-generated document.",
    },
    update: {},
  });
  for (const s of DEFAULT_SERIES) {
    await db.documentSeries.upsert({ where: { docType: s.docType }, create: { docType: s.docType, prefix: s.prefix }, update: {} });
  }

  // GST slabs as selectable options — none is assumed as default.
  for (const r of [
    { name: "Exempt / Nil (0%)", rate: "0" },
    { name: "GST 5%", rate: "5" },
    { name: "GST 12%", rate: "12" },
    { name: "GST 18%", rate: "18" },
    { name: "GST 28%", rate: "28" },
  ]) {
    await db.taxRate.upsert({ where: { name: r.name }, create: r, update: {} });
  }

  for (const c of CATEGORIES) {
    await db.category.upsert({
      where: { type_name: { type: c.type, name: c.name } },
      create: { ...c, isSystem: c.name === "Client Payments" },
      update: {},
    });
  }

  for (const s of SERVICES) {
    await db.service.upsert({ where: { name: s.name }, create: { ...s, unit: s.unit ?? "Month" }, update: {} });
  }
  const services = await db.service.findMany();
  for (const t of TEMPLATES) {
    const service = services.find((s) => s.name === t.service);
    await db.documentTemplate.upsert({
      where: { name: t.name },
      create: {
        name: t.name,
        kind: t.kind,
        serviceId: service?.id ?? null,
        title: t.title,
        introduction: t.introduction,
        scopeOfWork: t.scopeOfWork,
        deliverables: t.deliverables,
        timeline: t.timeline,
        paymentTerms: t.paymentTerms,
        terms: COMMON_TERMS,
        items: t.items.map((i) => ({ ...i, serviceId: service?.id ?? null, unitPrice: "0", discountPercent: "0", taxRate: "0", sacCode: "" })),
      },
      update: {},
    });
  }

  // First administrator
  const email = process.env.SEED_ADMIN_EMAIL?.trim().toLowerCase();
  if (email) {
    const existing = await db.user.findUnique({ where: { email } });
    if (!existing) {
      let password = process.env.SEED_ADMIN_PASSWORD;
      let generated = false;
      if (!password) {
        password = randomBytes(12).toString("base64url");
        generated = true;
      }
      const admin = await db.role.findUniqueOrThrow({ where: { name: "Admin" } });
      await db.user.create({
        data: { email, name: process.env.SEED_ADMIN_NAME || "Owner", passwordHash: await bcrypt.hash(password, 12), roleId: admin.id },
      });
      console.log(`✔ Admin user created: ${email}${generated ? `  (generated password: ${password})` : ""}`);
    } else {
      console.log(`• Admin user ${email} already exists — unchanged.`);
    }
  } else {
    console.log("• SEED_ADMIN_EMAIL not set — no admin user created.");
  }

  // Exchange rates for the display-currency switcher (ECB via frankfurter.app). Optional.
  try {
    const res = await fetch("https://api.frankfurter.app/latest?from=INR", { signal: AbortSignal.timeout(8000) });
    if (res.ok) {
      const data = (await res.json()) as { date: string; rates: Record<string, number> };
      const asOf = new Date(`${data.date}T00:00:00.000Z`);
      for (const [currency, perInr] of Object.entries(data.rates)) {
        if (!(perInr > 0)) continue;
        const rateToInr = (1 / perInr).toFixed(6);
        await db.exchangeRate.upsert({ where: { currency }, create: { currency, rateToInr, asOf, source: "ecb" }, update: {} });
      }
      console.log(`✔ Exchange rates loaded (${Object.keys(data.rates).length} currencies, ECB ${data.date}).`);
    }
  } catch {
    console.log("• Exchange rates not loaded (offline). Add them in Settings → Currencies.");
  }
  console.log("✔ Seed complete.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
