"use server";

import bcrypt from "bcryptjs";
import { cookies } from "next/headers";
import { z } from "zod";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { run, type ActionState, ActionError } from "@/lib/action";
import { SESSION_COOKIE, SESSION_MAX_AGE, signSession } from "@/lib/auth/session";
import { getCurrentUser, homePathFor } from "@/lib/auth";
import { emptyAccess, MODULES, type ModuleKey, type Level } from "@/lib/permissions";

const MAX_ATTEMPTS = 5;
const LOCK_MINUTES = 15;

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email"),
  password: z.string().min(1, "Enter your password").max(200),
  remember: z.preprocess((v) => v === "on", z.boolean()),
  next: z.string().optional(),
});

export async function login(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return run(async () => {
    const input = loginSchema.parse(Object.fromEntries(formData));
    const user = await db.user.findUnique({
      where: { email: input.email },
      include: { role: { include: { permissions: { include: { permission: true } } } } },
    });
    const generic = "Invalid email or password.";
    if (!user || !user.isActive) {
      // Constant-ish time to avoid user enumeration.
      await bcrypt.compare(input.password, "$2b$12$C6UzMDM.H6dfI/f/IKcEeO5YkRrXEtbWkwBRmDPnSMXZXX6dDgSb2");
      throw new ActionError(generic);
    }
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      throw new ActionError(`Too many failed attempts. Try again after ${user.lockedUntil.toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata" })}.`);
    }
    const ok = await bcrypt.compare(input.password, user.passwordHash);
    if (!ok) {
      const failed = user.failedLogins + 1;
      await db.user.update({
        where: { id: user.id },
        data: {
          failedLogins: failed >= MAX_ATTEMPTS ? 0 : failed,
          lockedUntil: failed >= MAX_ATTEMPTS ? new Date(Date.now() + LOCK_MINUTES * 60_000) : null,
        },
      });
      await audit({ userId: user.id, action: "LOGIN_FAILED", entityType: "User", entityId: user.id, summary: `Failed sign-in for ${user.email}` });
      throw new ActionError(generic);
    }
    await db.user.update({ where: { id: user.id }, data: { failedLogins: 0, lockedUntil: null, lastLoginAt: new Date() } });
    const maxAge = input.remember ? SESSION_MAX_AGE * 4 : SESSION_MAX_AGE;
    const token = await signSession({ uid: user.id, tv: user.tokenVersion }, maxAge);
    const store = await cookies();
    store.set(SESSION_COOKIE, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge,
    });
    await audit({ userId: user.id, action: "LOGIN", entityType: "User", entityId: user.id, summary: `${user.email} signed in` });

    const access = emptyAccess();
    if (user.role.isSystem && user.role.name === "Admin") Object.assign(access, emptyAccess("FULL"));
    else for (const rp of user.role.permissions) if (MODULES.some((m) => m.key === rp.permission.key)) access[rp.permission.key as ModuleKey] = rp.level as Level;
    const next = input.next && input.next.startsWith("/") && !input.next.startsWith("//") ? input.next : null;
    return { ok: true, message: `Welcome back, ${user.name.split(" ")[0]}`, redirectTo: user.mustChangePassword ? "/profile#password" : (next ?? homePathFor(access)) };
  });
}

const passwordSchema = z
  .object({
    current: z.string().min(1, "Enter your current password"),
    password: z
      .string()
      .min(10, "Use at least 10 characters")
      .max(128)
      .regex(/[A-Za-z]/, "Include at least one letter")
      .regex(/[0-9]/, "Include at least one number"),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, { message: "Passwords do not match", path: ["confirm"] });

export async function changePassword(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return run(async () => {
    const me = await getCurrentUser();
    if (!me) throw new ActionError("Session expired.");
    const input = passwordSchema.parse(Object.fromEntries(formData));
    const user = await db.user.findUniqueOrThrow({ where: { id: me.id } });
    if (!(await bcrypt.compare(input.current, user.passwordHash))) {
      throw new ActionError("Current password is incorrect.", { current: "Current password is incorrect" });
    }
    const updated = await db.user.update({
      where: { id: me.id },
      data: { passwordHash: await bcrypt.hash(input.password, 12), tokenVersion: { increment: 1 }, mustChangePassword: false },
    });
    // Re-issue the session for this device (other devices are signed out by tokenVersion bump).
    const token = await signSession({ uid: updated.id, tv: updated.tokenVersion });
    (await cookies()).set(SESSION_COOKIE, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: SESSION_MAX_AGE,
    });
    await audit({ userId: me.id, action: "PASSWORD_CHANGE", entityType: "User", entityId: me.id, summary: "Password changed; other sessions signed out" });
    return { ok: true, message: "Password updated. Other devices have been signed out." };
  });
}

export async function updateProfile(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return run(async () => {
    const me = await getCurrentUser();
    if (!me) throw new ActionError("Session expired.");
    const { name } = z.object({ name: z.string().trim().min(2, "Name is required").max(100) }).parse(Object.fromEntries(formData));
    await db.user.update({ where: { id: me.id }, data: { name } });
    return { ok: true, message: "Profile updated" };
  });
}
