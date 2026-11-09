"use client";

import * as React from "react";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import type { ActionState } from "@/lib/action";
import { cn } from "@/lib/utils";
import { Button, type ButtonProps } from "./button";
import { Checkbox, Field, Input, Select, Textarea } from "./fields";
import { Modal } from "./modal";

export type FieldDef = {
  name: string;
  label: string;
  type?: "text" | "email" | "tel" | "number" | "money" | "date" | "textarea" | "select" | "checkbox" | "password" | "color" | "file" | "hidden" | "heading";
  options?: { value: string; label: string }[];
  required?: boolean;
  placeholder?: string;
  hint?: string;
  span?: 1 | 2;
  step?: string;
  min?: string | number;
  max?: string | number;
  accept?: string;
  rows?: number;
  emptyOption?: string | false;
};

export type FormAction = (state: ActionState, formData: FormData) => Promise<ActionState>;

export function SubmitButton({ children, className, variant, pendingText }: { children: React.ReactNode; className?: string; variant?: ButtonProps["variant"]; pendingText?: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} className={className} variant={variant}>
      {pending ? <Loader2 className="animate-spin" /> : null}
      {pending ? (pendingText ?? "Saving…") : children}
    </Button>
  );
}

export function FormFields({
  fields,
  defaults = {},
  errors = {},
}: {
  fields: FieldDef[];
  defaults?: Record<string, string | number | boolean | null | undefined>;
  errors?: Record<string, string>;
}) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      {fields.map((f) => {
        const dv = defaults[f.name];
        const id = `f-${f.name}`;
        const span = f.span === 2 || f.type === "textarea" || f.type === "heading" ? "sm:col-span-2" : "";
        if (f.type === "hidden") return <input key={f.name} type="hidden" name={f.name} defaultValue={dv == null ? "" : String(dv)} />;
        if (f.type === "heading")
          return (
            <div key={f.name} className={cn(span, "border-b border-line pb-1 pt-2 text-xs font-semibold uppercase tracking-wide text-muted")}>
              {f.label}
            </div>
          );
        if (f.type === "checkbox")
          return (
            <div key={f.name} className={cn(span, "flex items-end pb-2")}>
              <Field error={errors[f.name]} hint={f.hint}>
                <Checkbox name={f.name} label={f.label} defaultChecked={dv === true || dv === "true"} />
              </Field>
            </div>
          );
        let control: React.ReactNode;
        const common = {
          id,
          name: f.name,
          required: f.required,
          placeholder: f.placeholder,
          "aria-invalid": errors[f.name] ? true : undefined,
        };
        if (f.type === "textarea") control = <Textarea {...common} rows={f.rows ?? 3} defaultValue={dv == null ? "" : String(dv)} />;
        else if (f.type === "select")
          control = (
            <Select {...common} defaultValue={dv == null ? "" : String(dv)}>
              {f.emptyOption !== false ? <option value="">{f.emptyOption ?? "— Select —"}</option> : null}
              {f.options?.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          );
        else if (f.type === "file") control = <Input {...common} type="file" accept={f.accept} className="h-auto py-1.5" />;
        else
          control = (
            <Input
              {...common}
              type={f.type === "money" ? "text" : (f.type ?? "text")}
              inputMode={f.type === "money" || f.type === "number" ? "decimal" : undefined}
              step={f.step}
              min={f.min}
              max={f.max}
              defaultValue={dv == null ? "" : String(dv)}
              className={f.type === "color" ? "h-9 p-1" : undefined}
            />
          );
        return (
          <Field key={f.name} label={f.label} htmlFor={id} required={f.required} error={errors[f.name]} hint={f.hint} className={span}>
            {control}
          </Field>
        );
      })}
    </div>
  );
}

/** Inline (non-modal) form bound to a server action, with toasts and field errors. */
export function ActionForm({
  action,
  children,
  className,
  onSuccess,
  resetOnSuccess,
  successMessage,
}: {
  action: FormAction;
  children: (state: ActionState) => React.ReactNode;
  className?: string;
  onSuccess?: (state: ActionState) => void;
  resetOnSuccess?: boolean;
  successMessage?: string;
}) {
  const router = useRouter();
  const formRef = React.useRef<HTMLFormElement>(null);
  const [state, formAction] = useActionState<ActionState, FormData>(action, null);
  const handled = React.useRef<ActionState>(null);
  React.useEffect(() => {
    if (!state || handled.current === state) return;
    handled.current = state;
    if (state.ok) {
      toast.success(state.message ?? successMessage ?? "Saved");
      if (resetOnSuccess) formRef.current?.reset();
      onSuccess?.(state);
      if (state.redirectTo) router.push(state.redirectTo);
      else router.refresh();
    } else if (state.message) toast.error(state.message);
  }, [state, onSuccess, resetOnSuccess, router, successMessage]);
  return (
    <form ref={formRef} action={formAction} className={className} noValidate>
      {children(state)}
    </form>
  );
}

/** Server-component friendly inline form (children are plain nodes, not a function). */
export function InlineForm({
  action,
  children,
  className,
  resetOnSuccess,
  successMessage,
}: {
  action: FormAction;
  children: React.ReactNode;
  className?: string;
  resetOnSuccess?: boolean;
  successMessage?: string;
}) {
  return (
    <ActionForm action={action} className={className} resetOnSuccess={resetOnSuccess} successMessage={successMessage}>
      {(state) => (
        <>
          {state && !state.ok && state.message ? (
            <div className="mb-3 rounded-lg border border-danger/30 bg-danger-soft px-3 py-2 text-[13px] text-danger">{state.message}</div>
          ) : null}
          {children}
        </>
      )}
    </ActionForm>
  );
}

/** Button that opens a modal with a config-driven form. */
export function FormDialog({
  trigger,
  triggerVariant = "primary",
  triggerSize = "md",
  triggerClassName,
  title,
  description,
  fields,
  defaults,
  action,
  submitLabel = "Save",
  size = "md",
  successMessage,
}: {
  trigger: React.ReactNode;
  triggerVariant?: ButtonProps["variant"];
  triggerSize?: ButtonProps["size"];
  triggerClassName?: string;
  title: string;
  description?: string;
  fields: FieldDef[];
  defaults?: Record<string, string | number | boolean | null | undefined>;
  action: FormAction;
  submitLabel?: string;
  size?: "sm" | "md" | "lg" | "xl";
  successMessage?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const [key, setKey] = React.useState(0);
  return (
    <>
      <Button
        variant={triggerVariant}
        size={triggerSize}
        className={triggerClassName}
        onClick={() => {
          setKey((k) => k + 1);
          setOpen(true);
        }}
      >
        {trigger}
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title={title} description={description} size={size}>
        <ActionForm key={key} action={action} onSuccess={() => setOpen(false)} successMessage={successMessage}>
          {(state) => (
            <>
              {state && !state.ok && state.message ? (
                <div className="mb-4 rounded-lg border border-danger/30 bg-danger-soft px-3 py-2 text-[13px] text-danger">{state.message}</div>
              ) : null}
              <FormFields fields={fields} defaults={defaults} errors={state?.fieldErrors} />
              <div className="mt-6 flex justify-end gap-2 border-t border-line pt-4">
                <Button variant="outline" onClick={() => setOpen(false)}>
                  Cancel
                </Button>
                <SubmitButton>{submitLabel}</SubmitButton>
              </div>
            </>
          )}
        </ActionForm>
      </Modal>
    </>
  );
}
