"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { run, ActionError, type ActionState } from "@/lib/action";
import { NOTIFICATION_TYPES, generateNotifications } from "@/lib/jobs";

async function me() {
  const user = await getCurrentUser();
  if (!user) throw new ActionError("Session expired.");
  return user;
}

export async function markRead(id: string): Promise<ActionState> {
  return run(async () => {
    const user = await me();
    await db.notification.updateMany({ where: { id, userId: user.id }, data: { readAt: new Date() } });
    revalidatePath("/", "layout");
    return { ok: true, message: "Marked as read" };
  });
}

export async function markAllRead(): Promise<ActionState> {
  return run(async () => {
    const user = await me();
    const r = await db.notification.updateMany({ where: { userId: user.id, readAt: null }, data: { readAt: new Date() } });
    revalidatePath("/", "layout");
    return { ok: true, message: `${r.count} notification(s) marked as read` };
  });
}

export async function clearRead(): Promise<ActionState> {
  return run(async () => {
    const user = await me();
    const r = await db.notification.deleteMany({ where: { userId: user.id, readAt: { not: null } } });
    revalidatePath("/notifications");
    return { ok: true, message: `${r.count} read notification(s) cleared` };
  });
}

export async function refreshNotifications(): Promise<ActionState> {
  return run(async () => {
    await me();
    const r = await generateNotifications();
    revalidatePath("/", "layout");
    return { ok: true, message: r.created ? `Checked — reminders updated` : "Checked — nothing new" };
  });
}

export async function savePreferences(_p: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const user = await me();
    for (const t of NOTIFICATION_TYPES) {
      const lead = Number(fd.get(`lead_${t.type}`) ?? t.defaultLead);
      await db.notificationPreference.upsert({
        where: { userId_type: { userId: user.id, type: t.type } },
        create: {
          userId: user.id, type: t.type, inApp: fd.get(`inApp_${t.type}`) === "on", email: fd.get(`email_${t.type}`) === "on", whatsapp: fd.get(`wa_${t.type}`) === "on",
          leadDays: Number.isFinite(lead) ? Math.min(Math.max(Math.round(lead), 0), 120) : t.defaultLead,
        },
        update: {
          inApp: fd.get(`inApp_${t.type}`) === "on", email: fd.get(`email_${t.type}`) === "on", whatsapp: fd.get(`wa_${t.type}`) === "on",
          leadDays: Number.isFinite(lead) ? Math.min(Math.max(Math.round(lead), 0), 120) : t.defaultLead,
        },
      });
    }
    revalidatePath("/notifications");
    return { ok: true, message: "Preferences saved" };
  });
}
