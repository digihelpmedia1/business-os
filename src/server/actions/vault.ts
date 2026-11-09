"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireActionAccess } from "@/lib/auth";
import { run, formToObject, ActionError, type ActionState } from "@/lib/action";
import { audit } from "@/lib/audit";
import { can } from "@/lib/permissions";
import { optDate, optId, optStr, reqStr } from "@/lib/validators";
import { storeUpload } from "@/lib/storage";

const CATEGORIES = ["CLIENT_AGREEMENT", "VENDOR_AGREEMENT", "INVOICE", "QUOTATION", "PROPOSAL", "PURCHASE_BILL", "COMPANY", "TAX", "EMPLOYEE", "POLICY", "SOP", "OTHER"] as const;

const docSchema = z.object({
  title: reqStr("Title", 200),
  category: z.enum(CATEGORIES),
  description: optStr(2000),
  clientId: optId,
  projectId: optId,
  vendorId: optId,
  employeeId: optId,
  expiresAt: optDate(),
});

export async function uploadDocument(_p: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const user = await requireActionAccess("vault", "EDIT");
    const raw = formToObject(fd);
    const file = raw.file;
    delete raw.file;
    const input = docSchema.parse(raw);
    if (input.category === "EMPLOYEE" && !can(user.access, "team", "VIEW")) throw new ActionError("Employee documents need access to Employee Management.");
    if (!(file instanceof File)) throw new ActionError("Choose a file to upload.", { file: "Required" });
    const stored = await storeUpload(file, user.id);
    const doc = await db.document.create({ data: { ...input, fileId: stored.id, uploadedById: user.id } });
    await audit({ userId: user.id, action: "UPLOAD", entityType: "Document", entityId: doc.id, summary: `Uploaded “${input.title}” (${stored.fileName}, ${Math.round(stored.size / 1024)} KB)` });
    revalidatePath("/vault");
    if (input.projectId) revalidatePath(`/projects/${input.projectId}`);
    return { ok: true, message: "Document uploaded" };
  });
}

export async function updateDocument(id: string, _p: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const user = await requireActionAccess("vault", "EDIT");
    const raw = formToObject(fd);
    delete raw.file;
    const input = docSchema.parse(raw);
    await db.document.update({ where: { id }, data: input });
    await audit({ userId: user.id, action: "UPDATE", entityType: "Document", entityId: id, summary: `Document “${input.title}” updated` });
    revalidatePath("/vault");
    return { ok: true, message: "Document updated" };
  });
}

export async function deleteDocument(id: string): Promise<ActionState> {
  return run(async () => {
    const user = await requireActionAccess("vault", "FULL");
    const d = await db.document.update({ where: { id }, data: { deletedAt: new Date() } });
    await audit({ userId: user.id, action: "DELETE", entityType: "Document", entityId: id, summary: `Document “${d.title}” deleted` });
    revalidatePath("/vault");
    return { ok: true, message: "Document deleted" };
  });
}
