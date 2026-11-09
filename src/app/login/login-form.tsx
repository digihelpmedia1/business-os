"use client";

import * as React from "react";
import { useActionState } from "react";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import { login } from "@/server/auth";
import type { ActionState } from "@/lib/action";
import { Button } from "@/components/ui/button";
import { Checkbox, Field, Input } from "@/components/ui/fields";

export function LoginForm({ next }: { next?: string }) {
  const router = useRouter();
  const [state, action, pending] = useActionState<ActionState, FormData>(login, null);
  const [show, setShow] = React.useState(false);

  React.useEffect(() => {
    if (state?.ok && state.redirectTo) {
      router.replace(state.redirectTo);
      router.refresh();
    }
  }, [state, router]);

  return (
    <form action={action} className="mt-8 space-y-4">
      <input type="hidden" name="next" value={next ?? ""} />
      {state && !state.ok && state.message ? (
        <div role="alert" className="rounded-lg border border-danger/30 bg-danger-soft px-3 py-2.5 text-[13px] text-danger">
          {state.message}
        </div>
      ) : null}
      <Field label="Email" htmlFor="email" error={state?.fieldErrors?.email}>
        <Input id="email" name="email" type="email" autoComplete="username" required autoFocus className="h-10" />
      </Field>
      <Field label="Password" htmlFor="password" error={state?.fieldErrors?.password}>
        <div className="relative">
          <Input id="password" name="password" type={show ? "text" : "password"} autoComplete="current-password" required className="h-10 pr-10" />
          <button
            type="button"
            onClick={() => setShow((s) => !s)}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted hover:text-fg"
            aria-label={show ? "Hide password" : "Show password"}
          >
            {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
      </Field>
      <Checkbox name="remember" label="Keep me signed in for 30 days" />
      <Button type="submit" size="lg" className="w-full" disabled={pending || !!state?.ok}>
        {pending || state?.ok ? <Loader2 className="animate-spin" /> : null}
        {state?.ok ? "Signing in…" : "Sign in"}
      </Button>
      <p className="text-center text-xs text-muted">Forgot your password? Ask an administrator to reset it from Users &amp; Access.</p>
    </form>
  );
}
