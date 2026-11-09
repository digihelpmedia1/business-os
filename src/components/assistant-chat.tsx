"use client";

import * as React from "react";
import { ArrowUp, Bot, Loader2, RotateCcw, Wrench } from "lucide-react";
import { askAssistant } from "@/server/actions/assistant";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";

type Msg = { role: "user" | "assistant"; content: string; tools?: string[]; error?: boolean };

const SUGGESTIONS = [
  "How much profit did we make this month?",
  "Which service generated the highest profit this financial year?",
  "How much money is pending from clients?",
  "What are our biggest expenses in the last 3 months?",
  "What is our current MRR?",
  "Which projects are unprofitable?",
  "How much did we spend on software subscriptions this month?",
  "Compare this month with last month.",
  "Are we meeting our revenue targets?",
];

/** Minimal, safe markdown: paragraphs, **bold**, bullet lists and pipe tables. No HTML injection. */
function Markdown({ text }: { text: string }) {
  const blocks = text.split(/\n{2,}/);
  const inline = (s: string) => s.split(/(\*\*[^*]+\*\*)/g).map((part, i) => (part.startsWith("**") && part.endsWith("**") ? <strong key={i}>{part.slice(2, -2)}</strong> : <React.Fragment key={i}>{part}</React.Fragment>));
  return (
    <div className="space-y-3 text-sm leading-relaxed">
      {blocks.map((b, i) => {
        const lines = b.split("\n").filter(Boolean);
        if (lines.length >= 2 && lines.every((l) => l.trim().startsWith("|"))) {
          const rows = lines.filter((l) => !/^\s*\|?\s*:?-{2,}/.test(l)).map((l) => l.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim()));
          return (
            <div key={i} className="thin-scroll overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead><tr className="border-b border-line">{rows[0]!.map((c, j) => <th key={j} className="px-2 py-1.5 text-left font-semibold">{inline(c)}</th>)}</tr></thead>
                <tbody>{rows.slice(1).map((r, k) => <tr key={k} className="border-b border-line last:border-0">{r.map((c, j) => <td key={j} className="tabular px-2 py-1.5">{inline(c)}</td>)}</tr>)}</tbody>
              </table>
            </div>
          );
        }
        if (lines.every((l) => /^\s*([-*]|\d+\.)\s/.test(l))) {
          return <ul key={i} className="list-disc space-y-1 pl-5">{lines.map((l, j) => <li key={j}>{inline(l.replace(/^\s*([-*]|\d+\.)\s/, ""))}</li>)}</ul>;
        }
        if (/^#{1,4}\s/.test(lines[0] ?? "")) return <p key={i} className="font-semibold">{inline(lines.join(" ").replace(/^#+\s/, ""))}</p>;
        return <p key={i} className="whitespace-pre-wrap">{inline(lines.join("\n"))}</p>;
      })}
    </div>
  );
}

export function AssistantChat({ configured }: { configured: boolean }) {
  const [messages, setMessages] = React.useState<Msg[]>([]);
  const [input, setInput] = React.useState("");
  const [pending, setPending] = React.useState(false);
  const endRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }), [messages, pending]);

  const send = async (text: string) => {
    const q = text.trim();
    if (!q || pending) return;
    const next: Msg[] = [...messages.filter((m) => !m.error), { role: "user", content: q }];
    setMessages(next);
    setInput("");
    setPending(true);
    const res = await askAssistant(next.slice(-20).map(({ role, content }) => ({ role, content })));
    setPending(false);
    setMessages((m) => [...m, res.ok ? { role: "assistant", content: res.answer!, tools: res.toolsUsed } : { role: "assistant", content: res.message ?? "Error", error: true }]);
  };

  return (
    <Card className="flex h-[calc(100vh-15rem)] min-h-[480px] flex-col overflow-hidden">
      <div className="thin-scroll flex-1 space-y-4 overflow-y-auto p-5">
        {messages.length === 0 ? (
          <div className="mx-auto max-w-2xl py-6 text-center">
            <span className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-brand-soft text-brand"><Bot className="h-5 w-5" /></span>
            <p className="mt-3 font-semibold">Ask about your business</p>
            <p className="mt-1 text-[13px] text-muted">Answers come only from your records. Facts, forecasts and recommendations are labelled separately. The assistant can't change any data.</p>
            <div className="mt-5 flex flex-wrap justify-center gap-2">
              {SUGGESTIONS.map((s) => (
                <button key={s} disabled={!configured} onClick={() => send(s)} className="rounded-full border border-line bg-surface px-3 py-1.5 text-[13px] text-fg hover:border-brand hover:text-brand disabled:opacity-50">{s}</button>
              ))}
            </div>
          </div>
        ) : null}
        {messages.map((m, i) => (
          <div key={i} className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}>
            <div className={cn("max-w-[85%] rounded-2xl px-4 py-3", m.role === "user" ? "bg-brand text-white" : m.error ? "border border-danger/30 bg-danger-soft" : "border border-line bg-surface-2")}>
              {m.role === "user" ? <p className="whitespace-pre-wrap text-sm">{m.content}</p> : <Markdown text={m.content} />}
              {m.tools?.length ? <p className="mt-2 flex items-center gap-1 text-[11px] text-muted"><Wrench className="h-3 w-3" /> Data used: {m.tools.join(", ").replace(/_/g, " ")}</p> : null}
            </div>
          </div>
        ))}
        {pending ? <div className="flex items-center gap-2 text-[13px] text-muted"><Loader2 className="h-4 w-4 animate-spin" /> Analysing your records…</div> : null}
        <div ref={endRef} />
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void send(input);
        }}
        className="flex items-end gap-2 border-t border-line p-3"
      >
        {messages.length ? <Button variant="ghost" size="icon" onClick={() => setMessages([])} aria-label="New conversation"><RotateCcw /></Button> : null}
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send(input);
            }
          }}
          rows={1}
          disabled={!configured}
          placeholder={configured ? "Ask a question… (Enter to send, Shift+Enter for a new line)" : "AI assistant not configured"}
          className="max-h-40 min-h-[40px] flex-1 resize-none rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm focus:border-brand focus:outline-none focus:ring-3 focus:ring-[var(--ring)]"
          aria-label="Your question"
        />
        <Button type="submit" size="icon" disabled={!configured || pending || !input.trim()} aria-label="Send"><ArrowUp /></Button>
      </form>
    </Card>
  );
}
