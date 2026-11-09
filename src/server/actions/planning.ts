"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireActionAccess } from "@/lib/auth";
import { run, formToObject, ActionError, type ActionState } from "@/lib/action";
import { audit } from "@/lib/audit";
import { dateStr, money, optId, optMoney, optStr, reqStr } from "@/lib/validators";
import { periodBounds } from "@/lib/dates";
import { getSettings } from "@/lib/settings";

const goalSchema = z.object({
  title: reqStr("Title", 150),
  metric: z.enum(["REVENUE", "CASH_COLLECTED", "NET_PROFIT", "EXPENSE_LIMIT", "SERVICE_REVENUE", "NEW_CLIENTS", "CLIENT_RETENTION", "MRR", "CUSTOM"]),
  periodType: z.enum(["MONTH", "QUARTER", "YEAR"]),
  periodStart: dateStr("Period"),
  target: money("Target", { allowZero: false }),
  serviceId: optId,
  manualActual: optMoney("Actual"),
  notes: optStr(1000),
});

export async function saveGoal(id: string | null, _p: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const user = await requireActionAccess("planning", "EDIT");
    const input = goalSchema.parse(formToObject(fd));
    if (input.metric === "SERVICE_REVENUE" && !input.serviceId) throw new ActionError("Select the service for this goal.", { serviceId: "Required" });
    const settings = await getSettings();
    const p = periodBounds(input.periodType, input.periodStart, settings.fyStartMonth);
    const data = { ...input, periodStart: p.from, periodEnd: p.to };
    if (id) await db.financialGoal.update({ where: { id }, data });
    else await db.financialGoal.create({ data });
    await audit({ userId: user.id, action: id ? "UPDATE" : "CREATE", entityType: "Goal", entityId: id ?? undefined, summary: `Goal “${input.title}” saved (${p.label})` });
    revalidatePath("/planning");
    return { ok: true, message: `Goal saved for ${p.label}` };
  });
}

export async function deleteGoal(id: string): Promise<ActionState> {
  return run(async () => {
    const user = await requireActionAccess("planning", "FULL");
    const g = await db.financialGoal.delete({ where: { id } });
    await audit({ userId: user.id, action: "DELETE", entityType: "Goal", entityId: id, summary: `Goal “${g.title}” deleted` });
    revalidatePath("/planning");
    return { ok: true, message: "Goal deleted" };
  });
}

const budgetSchema = z.object({
  categoryId: z.string().min(1, "Select a category"),
  periodType: z.enum(["MONTH", "QUARTER", "YEAR"]),
  periodStart: dateStr("Period"),
  amount: money("Budget", { allowZero: false }),
  notes: optStr(500),
});

export async function saveBudget(id: string | null, _p: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const user = await requireActionAccess("planning", "EDIT");
    const input = budgetSchema.parse(formToObject(fd));
    const settings = await getSettings();
    const p = periodBounds(input.periodType, input.periodStart, settings.fyStartMonth);
    const data = { ...input, periodStart: p.from };
    if (id) await db.budget.update({ where: { id }, data });
    else {
      const exists = await db.budget.findUnique({ where: { categoryId_periodType_periodStart: { categoryId: input.categoryId, periodType: input.periodType, periodStart: p.from } } });
      if (exists) throw new ActionError(`A budget for this category already exists for ${p.label}. Edit it instead.`);
      await db.budget.create({ data });
    }
    await audit({ userId: user.id, action: id ? "UPDATE" : "CREATE", entityType: "Budget", entityId: id ?? undefined, summary: `Budget ₹${input.amount} for ${p.label}` });
    revalidatePath("/planning");
    return { ok: true, message: "Budget saved" };
  });
}

export async function deleteBudget(id: string): Promise<ActionState> {
  return run(async () => {
    const user = await requireActionAccess("planning", "FULL");
    await db.budget.delete({ where: { id } });
    await audit({ userId: user.id, action: "DELETE", entityType: "Budget", entityId: id, summary: "Budget deleted" });
    revalidatePath("/planning");
    return { ok: true, message: "Budget deleted" };
  });
}
