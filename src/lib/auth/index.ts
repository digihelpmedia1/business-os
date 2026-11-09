import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { ActionError } from "@/lib/action";
import { can, emptyAccess, type AccessMap, type Level, type ModuleKey, MODULES } from "@/lib/permissions";
import { SESSION_COOKIE, verifySession } from "./session";

export type CurrentUser = {
  id: string;
  name: string;
  email: string;
  roleId: string;
  roleName: string;
  isAdmin: boolean;
  access: AccessMap;
  employeeId: string | null;
  mustChangePassword: boolean;
};

export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const store = await cookies();
  const session = await verifySession(store.get(SESSION_COOKIE)?.value);
  if (!session) return null;
  const user = await db.user.findUnique({
    where: { id: session.uid },
    include: { role: { include: { permissions: { include: { permission: true } } } }, employee: { select: { id: true } } },
  });
  if (!user || !user.isActive || user.tokenVersion !== session.tv) return null;
  const access = emptyAccess();
  const isAdmin = user.role.isSystem && user.role.name === "Admin";
  for (const rp of user.role.permissions) {
    if (MODULES.some((m) => m.key === rp.permission.key)) access[rp.permission.key as ModuleKey] = rp.level as Level;
  }
  if (isAdmin) Object.assign(access, emptyAccess("FULL"));
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    roleId: user.roleId,
    roleName: user.role.name,
    isAdmin,
    access,
    employeeId: user.employee?.id ?? null,
    mustChangePassword: user.mustChangePassword,
  };
});

export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

/** For pages: redirect to /no-access when the level isn't met. */
export async function requirePageAccess(module: ModuleKey, level: Level = "VIEW"): Promise<CurrentUser> {
  const user = await requireUser();
  if (!can(user.access, module, level)) redirect(`/no-access?module=${module}`);
  return user;
}

/** For server actions / route handlers: throws when the level isn't met. */
export async function requireActionAccess(module: ModuleKey, level: Level = "EDIT"): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) throw new ActionError("Your session has expired. Please sign in again.");
  if (!can(user.access, module, level)) {
    throw new ActionError(`You don't have ${level.toLowerCase()} access to ${MODULES.find((m) => m.key === module)?.label}.`);
  }
  return user;
}

/** First page a user is allowed to see (used after login). */
export function homePathFor(access: AccessMap): string {
  if (can(access, "dashboard")) return "/dashboard";
  if (can(access, "billing")) return "/billing/invoices";
  if (can(access, "finance")) return "/finance/transactions";
  if (can(access, "projects")) return "/projects";
  return "/my-work";
}
