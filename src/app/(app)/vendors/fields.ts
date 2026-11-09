import "server-only";
import type { Vendor, VendorBill } from "@prisma/client";
import type { FieldDef } from "@/components/ui/form-dialog";
import type { Option } from "@/lib/options";
import { INDIAN_STATES } from "@/lib/gst";
import { isoDate } from "@/lib/dates";

export const VENDOR_CATEGORIES = ["Software & SaaS", "Hosting & Domains", "Freelancer", "Agency / Contractor", "Media & Production", "Office & Utilities", "Hardware", "Professional Services", "Marketing", "Other"];

export const vendorFields: FieldDef[] = [
  { name: "name", label: "Vendor name", required: true },
  { name: "category", label: "Category", type: "select", options: VENDOR_CATEGORIES.map((c) => ({ value: c, label: c })) },
  { name: "contactPerson", label: "Contact person" },
  { name: "email", label: "Email", type: "email" },
  { name: "phone", label: "Phone", type: "tel" },
  { name: "website", label: "Website" },
  { name: "gstin", label: "GSTIN" },
  { name: "pan", label: "PAN" },
  { name: "stateCode", label: "State", type: "select", options: INDIAN_STATES.map((s) => ({ value: s.code, label: `${s.code} — ${s.name}` })) },
  { name: "paymentTermsDays", label: "Payment terms (days)", type: "number" },
  { name: "address", label: "Address", type: "textarea", rows: 2 },
  { name: "bankDetails", label: "Bank / UPI details", type: "textarea", rows: 2 },
  { name: "notes", label: "Notes", type: "textarea" },
  { name: "isActive", label: "Active", type: "checkbox" },
];

export function vendorDefaults(v?: Vendor | null) {
  if (!v) return { isActive: true };
  return {
    name: v.name, category: v.category, contactPerson: v.contactPerson, email: v.email, phone: v.phone, website: v.website, gstin: v.gstin, pan: v.pan,
    stateCode: v.stateCode, paymentTermsDays: v.paymentTermsDays, address: v.address, bankDetails: v.bankDetails, notes: v.notes, isActive: v.isActive,
  };
}

export function billFields(o: { vendors: Option[]; categories: Option[]; projects: Option[] }, withFile = true): FieldDef[] {
  return [
    { name: "vendorId", label: "Vendor", type: "select", options: o.vendors, required: true },
    { name: "billNumber", label: "Bill / invoice number", required: true },
    { name: "billDate", label: "Bill date", type: "date", required: true },
    { name: "dueDate", label: "Due date", type: "date" },
    { name: "categoryId", label: "Expense category", type: "select", options: o.categories, required: true },
    { name: "projectId", label: "Project (if billable)", type: "select", options: o.projects },
    { name: "subtotal", label: "Amount before GST (₹)", type: "money", required: true },
    { name: "taxAmount", label: "Claimable input GST (₹)", type: "money", hint: "0 if not GST-registered or not claimable" },
    { name: "description", label: "Description", span: 2 },
    ...(withFile ? [{ name: "attachment", label: "Attach bill (PDF/image)", type: "file", accept: "application/pdf,image/*" } as FieldDef] : []),
    { name: "notes", label: "Notes", type: "textarea" },
  ];
}

export function billDefaults(b: VendorBill) {
  return {
    vendorId: b.vendorId, billNumber: b.billNumber, billDate: isoDate(b.billDate), dueDate: isoDate(b.dueDate), categoryId: b.categoryId, projectId: b.projectId,
    subtotal: b.subtotal.toFixed(2), taxAmount: b.taxAmount.toFixed(2), description: b.description, notes: b.notes,
  };
}

export function payFields(accounts: Option[], methods: Option[]): FieldDef[] {
  return [
    { name: "date", label: "Payment date", type: "date", required: true },
    { name: "amount", label: "Amount (₹)", type: "money", required: true },
    { name: "accountId", label: "Paid from", type: "select", options: accounts, required: true },
    { name: "method", label: "Method", type: "select", options: methods, emptyOption: false },
    { name: "reference", label: "Reference / UTR", span: 2 },
  ];
}
