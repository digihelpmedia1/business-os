import { requirePageAccess } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { getSettings } from "@/lib/settings";
import { INDIAN_STATES } from "@/lib/gst";
import { Card, CardBody, CardHeader, Notice, PageHeader } from "@/components/ui/primitives";
import { FormFields, InlineForm, SubmitButton, type FieldDef } from "@/components/ui/form-dialog";
import { ConfirmAction } from "@/components/ui/confirm-action";
import { removeLogo, saveCompany } from "@/server/actions/settings";

export const metadata = { title: "Company & GST" };

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

const sections: { title: string; description?: string; fields: FieldDef[] }[] = [
  {
    title: "Company profile",
    fields: [
      { name: "companyName", label: "Display name", required: true },
      { name: "legalName", label: "Legal name (on invoices)" },
      { name: "tagline", label: "Tagline" },
      { name: "website", label: "Website" },
      { name: "email", label: "Billing email", type: "email" },
      { name: "phone", label: "Phone", type: "tel" },
      { name: "logo", label: "Logo (PNG/JPG, shown on documents)", type: "file", accept: "image/png,image/jpeg,image/webp" },
      { name: "primaryColor", label: "Brand primary colour", type: "color" },
      { name: "secondaryColor", label: "Brand secondary colour", type: "color" },
    ],
  },
  {
    title: "Registered address",
    fields: [
      { name: "addressLine1", label: "Address line 1", span: 2 },
      { name: "addressLine2", label: "Address line 2", span: 2 },
      { name: "city", label: "City" },
      { name: "stateCode", label: "State", type: "select", options: INDIAN_STATES.map((s) => ({ value: s.code, label: `${s.code} — ${s.name}` })), hint: "Decides CGST+SGST vs IGST" },
      { name: "pincode", label: "PIN code" },
    ],
  },
  {
    title: "GST & tax registration",
    description: "Nothing is assumed: GST is only charged when you mark the company as registered and add a GSTIN.",
    fields: [
      { name: "gstRegistered", label: "Registered under GST", type: "checkbox", span: 2 },
      { name: "gstin", label: "GSTIN" },
      { name: "pan", label: "PAN" },
      { name: "cin", label: "CIN / LLPIN" },
      { name: "lutNumber", label: "LUT number (exports)" },
      { name: "roundOffTotals", label: "Round off document totals to the nearest rupee", type: "checkbox", span: 2 },
    ],
  },
  {
    title: "Bank details (printed on invoices)",
    fields: [
      { name: "bankName", label: "Bank name" },
      { name: "bankBranch", label: "Branch" },
      { name: "bankAccountName", label: "Account name" },
      { name: "bankAccountNumber", label: "Account number" },
      { name: "bankIfsc", label: "IFSC" },
      { name: "upiId", label: "UPI ID" },
      { name: "signatoryName", label: "Authorised signatory" },
      { name: "signatoryDesignation", label: "Signatory designation" },
    ],
  },
  {
    title: "Defaults",
    fields: [
      { name: "fyStartMonth", label: "Financial year starts in", type: "select", emptyOption: false, options: MONTHS.map((m, i) => ({ value: String(i + 1), label: m })), hint: "India: April" },
      { name: "defaultDueDays", label: "Invoice due in (days)", type: "number" },
      { name: "quoteValidityDays", label: "Quotation valid for (days)", type: "number" },
      { name: "salaryPayDay", label: "Salary pay day (1–28)", type: "number" },
      { name: "defaultInvoiceTerms", label: "Default invoice terms", type: "textarea", rows: 4 },
      { name: "defaultQuoteTerms", label: "Default proposal / quotation terms", type: "textarea", rows: 6 },
      { name: "invoiceFooter", label: "Document footer note", type: "textarea", rows: 2 },
    ],
  },
];

export default async function CompanySettingsPage() {
  const user = await requirePageAccess("settings");
  const s = await getSettings();
  const canEdit = can(user.access, "settings", "FULL");
  const defaults = {
    companyName: s.companyName, legalName: s.legalName, tagline: s.tagline, website: s.website, email: s.email, phone: s.phone, primaryColor: s.primaryColor,
    secondaryColor: s.secondaryColor, addressLine1: s.addressLine1, addressLine2: s.addressLine2, city: s.city, stateCode: s.stateCode, pincode: s.pincode,
    gstRegistered: s.gstRegistered, gstin: s.gstin, pan: s.pan, cin: s.cin, lutNumber: s.lutNumber, roundOffTotals: s.roundOffTotals, bankName: s.bankName,
    bankBranch: s.bankBranch, bankAccountName: s.bankAccountName, bankAccountNumber: s.bankAccountNumber, bankIfsc: s.bankIfsc, upiId: s.upiId,
    signatoryName: s.signatoryName, signatoryDesignation: s.signatoryDesignation, fyStartMonth: String(s.fyStartMonth), defaultDueDays: s.defaultDueDays,
    quoteValidityDays: s.quoteValidityDays, salaryPayDay: s.salaryPayDay, defaultInvoiceTerms: s.defaultInvoiceTerms, defaultQuoteTerms: s.defaultQuoteTerms, invoiceFooter: s.invoiceFooter,
  };
  return (
    <>
      <PageHeader title="Company & GST" description="Your company details appear on every proposal, invoice and receipt. Currency: INR · Timezone: Asia/Kolkata." />
      {!canEdit ? <Notice className="mb-4">You can view settings. Full access to Settings is needed to change them.</Notice> : null}
      {s.logoFileId ? (
        <Card className="mb-4">
          <CardBody className="flex items-center gap-4">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/api/public/logo" alt="Company logo" className="h-12 w-auto rounded border border-line bg-white p-1" />
            <p className="flex-1 text-sm text-muted">Current logo — upload a new file below to replace it.</p>
            {canEdit ? <ConfirmAction action={removeLogo} label="Remove logo" title="Remove the logo?" confirmLabel="Remove" /> : null}
          </CardBody>
        </Card>
      ) : null}
      <InlineForm action={saveCompany} successMessage="Settings saved">
        <fieldset disabled={!canEdit} className="space-y-4">
          {sections.map((sec) => (
            <Card key={sec.title}>
              <CardHeader title={sec.title} description={sec.description} />
              <CardBody><FormFields fields={sec.fields} defaults={defaults} /></CardBody>
            </Card>
          ))}
          {canEdit ? <div className="flex justify-end"><SubmitButton>Save settings</SubmitButton></div> : null}
        </fieldset>
      </InlineForm>
    </>
  );
}
