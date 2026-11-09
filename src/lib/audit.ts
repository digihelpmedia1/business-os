import "server-only";
import { headers } from "next/headers";
import type { Prisma } from "@prisma/client";
import { db, type Tx } from "./db";

export type AuditInput = {
  userId?: string | null;
  action: string; // CREATE | UPDATE | DELETE | ISSUE | CANCEL | PAYMENT | LOGIN …
  entityType: string;
  entityId?: string | null;
  summary: string;
  changes?: unknown;
};

function serialize(value: unknown): Prisma.InputJsonValue | undefined {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value, (_k, v) => (typeof v === "bigint" ? v.toString() : v)));
}

async function clientIp(): Promise<string | null> {
  try {
    const h = await headers();
    return h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || null;
  } catch {
    return null;
  }
}

/** Record an audit entry. Pass `tx` to make it part of the same DB transaction. */
export async function audit(entry: AuditInput, tx: Tx = db) {
  await tx.auditLog.create({
    data: {
      userId: entry.userId ?? null,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId ?? null,
      summary: entry.summary.slice(0, 500),
      changes: serialize(entry.changes),
      ipAddress: await clientIp(),
    },
  });
}

/** Shallow diff of two records for audit "changes". */
export function diff(before: Record<string, unknown>, after: Record<string, unknown>) {
  const out: Record<string, { from: unknown; to: unknown }> = {};
  for (const key of Object.keys(after)) {
    const a = before[key];
    const b = after[key];
    const norm = (v: unknown) => (v instanceof Date ? v.toISOString() : v != null && typeof v === "object" ? String(v) : v);
    if (norm(a) !== norm(b)) out[key] = { from: norm(a), to: norm(b) };
  }
  return out;
}
