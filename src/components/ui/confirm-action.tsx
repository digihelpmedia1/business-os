"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import type { ActionState } from "@/lib/action";
import { Button, type ButtonProps } from "./button";
import { Field, Textarea } from "./fields";
import { Modal } from "./modal";

/**
 * A button that asks for confirmation, then calls a (bound) server action.
 * With `reasonLabel`, a reason is collected and passed as FormData "reason".
 */
export function ConfirmAction({
  action,
  label,
  title,
  message,
  confirmLabel = "Confirm",
  variant = "outline",
  size = "sm",
  confirmVariant = "danger",
  reasonLabel,
  reasonRequired,
  className,
  redirectTo,
  noConfirm,
}: {
  action: (formData: FormData) => Promise<ActionState>;
  label: React.ReactNode;
  title?: string;
  message?: React.ReactNode;
  confirmLabel?: string;
  variant?: ButtonProps["variant"];
  size?: ButtonProps["size"];
  confirmVariant?: ButtonProps["variant"];
  reasonLabel?: string;
  reasonRequired?: boolean;
  className?: string;
  redirectTo?: string;
  noConfirm?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [pending, startTransition] = React.useTransition();
  const [reason, setReason] = React.useState("");

  const execute = () => {
    const fd = new FormData();
    if (reasonLabel) fd.set("reason", reason);
    startTransition(async () => {
      const res = await action(fd);
      if (res?.ok) {
        toast.success(res.message ?? "Done");
        setOpen(false);
        if (res.redirectTo ?? redirectTo) router.push((res.redirectTo ?? redirectTo)!);
        else router.refresh();
      } else {
        toast.error(res?.message ?? "Action failed");
      }
    });
  };

  return (
    <>
      <Button
        variant={variant}
        size={size}
        className={className}
        disabled={pending}
        onClick={() => (noConfirm ? execute() : setOpen(true))}
      >
        {pending && noConfirm ? <Loader2 className="animate-spin" /> : null}
        {label}
      </Button>
      {!noConfirm ? (
        <Modal
          open={open}
          onClose={() => setOpen(false)}
          title={title ?? "Are you sure?"}
          size="sm"
          footer={
            <>
              <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
                Cancel
              </Button>
              <Button variant={confirmVariant} onClick={execute} disabled={pending || (reasonRequired && reason.trim().length < 3)}>
                {pending ? <Loader2 className="animate-spin" /> : null}
                {confirmLabel}
              </Button>
            </>
          }
        >
          {message ? <div className="text-sm text-muted">{message}</div> : null}
          {reasonLabel ? (
            <Field label={reasonLabel} required={reasonRequired} className="mt-4">
              <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} />
            </Field>
          ) : null}
        </Modal>
      ) : null}
    </>
  );
}
