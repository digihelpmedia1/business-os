import { ZodError } from "zod";

export type ActionState = {
  ok: boolean;
  message?: string;
  fieldErrors?: Record<string, string>;
  id?: string;
  redirectTo?: string;
} | null;

/** An error whose message is safe to show to the user. */
export class ActionError extends Error {
  fieldErrors?: Record<string, string>;
  constructor(message: string, fieldErrors?: Record<string, string>) {
    super(message);
    this.name = "ActionError";
    this.fieldErrors = fieldErrors;
  }
}

function prismaCode(e: unknown): string | undefined {
  if (e && typeof e === "object" && "code" in e && typeof (e as { code: unknown }).code === "string") {
    return (e as { code: string }).code;
  }
  return undefined;
}

export function toActionState(e: unknown): ActionState {
  if (e instanceof ActionError) return { ok: false, message: e.message, fieldErrors: e.fieldErrors };
  if (e instanceof ZodError) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of e.issues) {
      const key = issue.path.join(".") || "_form";
      if (!fieldErrors[key]) fieldErrors[key] = issue.message;
    }
    return { ok: false, message: "Please correct the highlighted fields.", fieldErrors };
  }
  const code = prismaCode(e);
  if (code === "P2002") return { ok: false, message: "A record with these details already exists." };
  if (code === "P2003") return { ok: false, message: "This record is linked to other records and cannot be removed." };
  if (code === "P2025") return { ok: false, message: "The record no longer exists." };
  // Next.js redirect()/notFound() must propagate.
  if (e && typeof e === "object" && "digest" in e && String((e as { digest: unknown }).digest).startsWith("NEXT_")) throw e;
  console.error("[action]", e);
  return { ok: false, message: "Something went wrong. Please try again." };
}

/** Wrap a server-action body: returns ActionState instead of throwing. */
export async function run(fn: () => Promise<ActionState | void>): Promise<ActionState> {
  try {
    const result = await fn();
    return result ?? { ok: true };
  } catch (e) {
    return toActionState(e);
  }
}

/** FormData → plain object. Repeated keys become arrays. */
export function formToObject(fd: FormData): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of fd.entries()) {
    if (key.startsWith("$ACTION")) continue;
    const v = typeof value === "string" ? value : value;
    if (key in out) {
      const prev = out[key];
      out[key] = Array.isArray(prev) ? [...prev, v] : [prev, v];
    } else out[key] = v;
  }
  return out;
}
