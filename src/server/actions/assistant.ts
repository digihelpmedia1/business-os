"use server";

import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { requireActionAccess } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { assistantConfigured, runAssistant, type ChatTurn } from "@/lib/assistant";

const historySchema = z
  .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().min(1).max(8000) }))
  .min(1)
  .max(30)
  .refine((h) => h[0]!.role === "user" && h[h.length - 1]!.role === "user", "Conversation must start and end with a user message");

export async function askAssistant(raw: ChatTurn[]): Promise<{ ok: boolean; answer?: string; toolsUsed?: string[]; message?: string }> {
  try {
    const user = await requireActionAccess("assistant", "VIEW");
    if (!assistantConfigured()) return { ok: false, message: "The AI assistant isn't configured. Add ANTHROPIC_API_KEY to the server environment." };
    const history = historySchema.parse(raw);
    const result = await runAssistant(history, user.access);
    await audit({ userId: user.id, action: "AI_QUERY", entityType: "Assistant", summary: `Asked: ${history[history.length - 1]!.content.slice(0, 180)} · tools: ${[...new Set(result.toolsUsed)].join(", ") || "none"}` });
    return { ok: true, answer: result.answer, toolsUsed: [...new Set(result.toolsUsed)] };
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) return { ok: false, message: "The AI API key was rejected. Check ANTHROPIC_API_KEY." };
    if (e instanceof Anthropic.RateLimitError) return { ok: false, message: "The AI service is rate-limited right now. Try again in a minute." };
    if (e instanceof Anthropic.APIError) {
      console.error("[assistant]", e.status, e.message);
      return { ok: false, message: `The AI service returned an error (${e.status ?? "network"}). Try again.` };
    }
    if (e instanceof z.ZodError) return { ok: false, message: "Invalid question." };
    if (e instanceof Error && e.name === "ActionError") return { ok: false, message: e.message };
    console.error("[assistant]", e);
    return { ok: false, message: "Something went wrong. Please try again." };
  }
}
