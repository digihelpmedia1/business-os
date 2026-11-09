import "server-only";
import type { Asset } from "@prisma/client";
import type { FieldDef } from "@/components/ui/form-dialog";
import type { Option } from "@/lib/options";
import { isoDate } from "@/lib/dates";

export const ASSET_CATEGORIES: Option[] = [
  { value: "LAPTOP", label: "Laptop" }, { value: "DESKTOP", label: "Desktop" }, { value: "CAMERA", label: "Camera" }, { value: "MOBILE", label: "Mobile" },
  { value: "OFFICE_EQUIPMENT", label: "Office equipment" }, { value: "FURNITURE", label: "Furniture" }, { value: "OTHER", label: "Other" },
];
export const ASSET_STATUSES: Option[] = [
  { value: "IN_USE", label: "In use" }, { value: "IN_STOCK", label: "In stock" }, { value: "UNDER_REPAIR", label: "Under repair" },
  { value: "RETIRED", label: "Retired" }, { value: "LOST", label: "Lost" }, { value: "SOLD", label: "Sold" },
];

export function assetFields(o: { vendors: Option[]; employees: Option[] }): FieldDef[] {
  return [
    { name: "name", label: "Asset name", required: true, placeholder: "MacBook Pro 14 — Design" },
    { name: "category", label: "Category", type: "select", options: ASSET_CATEGORIES, emptyOption: false },
    { name: "brand", label: "Brand" },
    { name: "model", label: "Model" },
    { name: "serialNumber", label: "Serial number" },
    { name: "status", label: "Status", type: "select", options: ASSET_STATUSES, emptyOption: false },
    { name: "purchaseDate", label: "Purchase date", type: "date" },
    { name: "purchaseValue", label: "Purchase value (₹)", type: "money" },
    { name: "vendorId", label: "Purchased from", type: "select", options: o.vendors },
    { name: "warrantyUntil", label: "Warranty until", type: "date" },
    { name: "assignedEmployeeId", label: "Assigned to", type: "select", options: o.employees },
    { name: "location", label: "Location" },
    { name: "notes", label: "Notes", type: "textarea" },
  ];
}

export function assetDefaults(a?: Asset | null) {
  if (!a) return { category: "LAPTOP", status: "IN_USE", purchaseValue: "0" };
  return {
    name: a.name, category: a.category, brand: a.brand, model: a.model, serialNumber: a.serialNumber, status: a.status, purchaseDate: isoDate(a.purchaseDate),
    purchaseValue: a.purchaseValue.toFixed(2), vendorId: a.vendorId, warrantyUntil: isoDate(a.warrantyUntil), assignedEmployeeId: a.assignedEmployeeId, location: a.location, notes: a.notes,
  };
}
