import type { FieldDef } from "@/components/ui/form-dialog";
import { INDIAN_STATES } from "@/lib/gst";
import type { Client } from "@prisma/client";
import { isoDate } from "@/lib/dates";

export const clientFields: FieldDef[] = [
  { name: "name", label: "Client name", required: true, placeholder: "Contact or brand name" },
  { name: "businessName", label: "Business / legal name", placeholder: "Shown on invoices" },
  { name: "contactPerson", label: "Contact person" },
  { name: "email", label: "Email", type: "email" },
  { name: "phone", label: "Phone", type: "tel", placeholder: "+91 98xxxxxxxx" },
  { name: "status", label: "Status", type: "select", emptyOption: false, options: [{ value: "ACTIVE", label: "Active" }, { value: "INACTIVE", label: "Inactive" }, { value: "CHURNED", label: "Churned" }] },
  { name: "_tax", label: "Tax & billing", type: "heading" },
  { name: "gstin", label: "GSTIN", placeholder: "27ABCDE1234F1Z5", hint: "Leave empty for unregistered clients" },
  { name: "pan", label: "PAN" },
  { name: "billingAddress", label: "Billing address", type: "textarea", rows: 2 },
  { name: "city", label: "City" },
  { name: "stateCode", label: "State (place of supply)", type: "select", options: INDIAN_STATES.map((s) => ({ value: s.code, label: `${s.code} — ${s.name}` })) },
  { name: "pincode", label: "PIN code" },
  { name: "country", label: "Country", placeholder: "India" },
  { name: "_acq", label: "Acquisition", type: "heading" },
  { name: "acquiredAt", label: "Client since", type: "date", hint: "Used for new-client and CAC metrics" },
  { name: "acquisitionChannel", label: "Acquisition channel", placeholder: "Meta Ads, referral, website…" },
  { name: "notes", label: "Notes", type: "textarea" },
];

export function clientDefaults(c?: Client | null) {
  if (!c) return { status: "ACTIVE", country: "India" };
  return {
    name: c.name, businessName: c.businessName, contactPerson: c.contactPerson, email: c.email, phone: c.phone, status: c.status,
    gstin: c.gstin, pan: c.pan, billingAddress: c.billingAddress, city: c.city, stateCode: c.stateCode, pincode: c.pincode,
    country: c.country, acquiredAt: isoDate(c.acquiredAt), acquisitionChannel: c.acquisitionChannel, notes: c.notes,
  };
}
