"use client";

import * as React from "react";
import { toast } from "sonner";
import { Check, Copy, Printer } from "lucide-react";
import { Button, type ButtonProps } from "./button";

export function CopyButton({ text, label = "Copy", variant = "outline", size = "sm" }: { text: string; label?: string; variant?: ButtonProps["variant"]; size?: ButtonProps["size"] }) {
  const [done, setDone] = React.useState(false);
  return (
    <Button
      variant={variant}
      size={size}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          toast.success("Copied to clipboard");
          setTimeout(() => setDone(false), 1500);
        } catch {
          toast.error("Could not copy — select and copy manually.");
        }
      }}
    >
      {done ? <Check /> : <Copy />} {label}
    </Button>
  );
}

export function PrintButton({ label = "Print", variant = "outline", size = "md" }: { label?: string; variant?: ButtonProps["variant"]; size?: ButtonProps["size"] }) {
  return (
    <Button variant={variant} size={size} onClick={() => window.print()}>
      <Printer /> {label}
    </Button>
  );
}
