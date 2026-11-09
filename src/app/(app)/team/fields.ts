import "server-only";
import type { Employee } from "@prisma/client";
import type { FieldDef } from "@/components/ui/form-dialog";
import type { Option } from "@/lib/options";
import { isoDate } from "@/lib/dates";

export function employeeFields(users: Option[]): FieldDef[] {
  return [
    { name: "type", label: "Type", type: "select", emptyOption: false, options: [{ value: "EMPLOYEE", label: "Employee" }, { value: "FREELANCER", label: "Freelancer" }] },
    { name: "name", label: "Full name", required: true },
    { name: "email", label: "Email", type: "email" },
    { name: "phone", label: "Phone", type: "tel" },
    { name: "designation", label: "Role / designation", placeholder: "Performance Marketer" },
    { name: "department", label: "Department", placeholder: "Paid Media" },
    { name: "joiningDate", label: "Joining date", type: "date" },
    { name: "status", label: "Status", type: "select", emptyOption: false, options: [{ value: "ACTIVE", label: "Active" }, { value: "ON_LEAVE", label: "On leave" }, { value: "EXITED", label: "Exited" }] },
    { name: "exitDate", label: "Exit date", type: "date" },
    { name: "userId", label: "Login account", type: "select", options: users, hint: "Link to let them log time and see their tasks" },
    { name: "_comp", label: "Compensation", type: "heading" },
    { name: "compensationType", label: "Paid", type: "select", emptyOption: false, options: [{ value: "MONTHLY_SALARY", label: "Monthly salary" }, { value: "HOURLY", label: "Hourly" }, { value: "PER_PROJECT", label: "Per project" }] },
    { name: "monthlySalary", label: "Monthly salary (₹)", type: "money" },
    { name: "hourlyRate", label: "Hourly rate (₹)", type: "money" },
    { name: "costPerHour", label: "Internal cost per hour (₹)", type: "money", hint: "For project profitability. Blank = salary ÷ 176 h" },
    { name: "_bank", label: "Payment details (private)", type: "heading" },
    { name: "pan", label: "PAN" },
    { name: "upiId", label: "UPI ID" },
    { name: "bankAccount", label: "Bank account no." },
    { name: "bankIfsc", label: "IFSC" },
    { name: "address", label: "Address", type: "textarea", rows: 2 },
    { name: "notes", label: "Notes", type: "textarea" },
  ];
}

export function employeeDefaults(e?: Employee | null) {
  if (!e) return { type: "EMPLOYEE", status: "ACTIVE", compensationType: "MONTHLY_SALARY" };
  return {
    type: e.type, name: e.name, email: e.email, phone: e.phone, designation: e.designation, department: e.department, joiningDate: isoDate(e.joiningDate),
    status: e.status, exitDate: isoDate(e.exitDate), userId: e.userId, compensationType: e.compensationType, monthlySalary: e.monthlySalary?.toFixed(2),
    hourlyRate: e.hourlyRate?.toFixed(2), costPerHour: e.costPerHour?.toFixed(2), pan: e.pan, upiId: e.upiId, bankAccount: e.bankAccount, bankIfsc: e.bankIfsc,
    address: e.address, notes: e.notes,
  };
}
