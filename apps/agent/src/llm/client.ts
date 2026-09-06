import Anthropic from "@anthropic-ai/sdk";
import { GoogleGenAI } from "@google/genai";
import Groq from "groq-sdk";

/**
 * Single point of contact for every "upgrade heuristics to a real model"
 * call site (engine/requirements.ts, editIntent.ts, copywriter.ts, critic.ts,
 * routes/messages.ts). Each of those used to instantiate its own Anthropic
 * client directly; this module adds Gemini and Groq as alternative providers
 * behind the same shape, so call sites don't need to know or care which one
 * answered.
 *
 * Provider choice is env-driven, never hardcoded:
 *  - Set exactly one of ANTHROPIC_API_KEY / GEMINI_API_KEY / GROQ_API_KEY
 *    and that's the provider used.
 *  - Set more than one and `AI_PROVIDER` ("anthropic" | "gemini" | "groq")
 *    picks which; with no override, first match wins in that fixed order
 *    (preserves old ANTHROPIC_API_KEY-only behavior unchanged).
 *  - Set none: aiAvailable() is false everywhere and every call site's
 *    existing heuristic fallback runs, exactly as before this file existed.
 *
 * Every function here returns null (or, for streamAck, simply does nothing)
 * on any auth/network/parse failure instead of throwing -- callers already
 * treat "no AI answer" as "fall back to the heuristic", so this file must
 * never be the thing that takes the request down.
 */

export type Provider = "anthropic" | "gemini" | "groq";

const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-5";
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";
const GROQ_MODEL = process.env.GROQ_MODEL || "llama-3.3-70b-versatile";
// Groq's text models don't take images; this is the multimodal one used
// only by completeVision() below.
const GROQ_VISION_MODEL = process.env.GROQ_VISION_MODEL || "qwen/qwen3.8-27b";

function keyFor(provider: Provider): string | undefined {
  switch (provider) {
    case "anthropic":
      return process.env.ANTHROPIC_API_KEY;
    case "gemini":
      return process.env.GEMINI_API_KEY;
    case "groq":
      return process.env.GROQ_API_KEY;
  }
}

export function pickProvider(): Provider | null {
  const forced = process.env.AI_PROVIDER?.trim().toLowerCase();
  if (forced === "anthropic" || forced === "gemini" || forced === "groq") {
    // Forced but the matching key is missing is a config mistake worth
    // surfacing as "no AI" -- it must not silently fall through to whatever
    // other key happens to be set.
    return keyFor(forced) ? forced : null;
  }
  return (["anthropic", "gemini", "groq"] as Provider[]).find((p) => keyFor(p)) ?? null;
}

export function aiAvailable(): boolean {
  return pickProvider() !== null;
}

export interface CompleteOptions {
  system?: string;
  prompt: string;
  maxTokens: number;
}

/** One text-in/text-out call to whichever provider is active. */
export async function completeText(opts: CompleteOptions): Promise<string | null> {
  const provider = pickProvider();
  if (!provider) return null;
  try {
    if (provider === "anthropic") {
      const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
      const response = await client.messages.create({
        model: ANTHROPIC_MODEL,
        max_tokens: opts.maxTokens,
        ...(opts.system ? { system: opts.system } : {}),
        messages: [{ role: "user", content: opts.prompt }],
      });
      const block = response.content.find((c) => c.type === "text");
      return block && block.type === "text" ? block.text : null;
    }
    if (provider === "gemini") {
      const client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      const response = await client.models.generateContent({
        model: GEMINI_MODEL,
        contents: opts.prompt,
        config: {
          maxOutputTokens: opts.maxTokens,
          ...(opts.system ? { systemInstruction: opts.system } : {}),
        },
      });
      return response.text ?? null;
    }
    // groq
    const client = new Groq({ apiKey: process.env.GROQ_API_KEY });
    const completion = await client.chat.completions.create({
      model: GROQ_MODEL,
      max_tokens: opts.maxTokens,
      messages: [
        ...(opts.system ? [{ role: "system" as const, content: opts.system }] : []),
        { role: "user" as const, content: opts.prompt },
      ],
    });
    return completion.choices[0]?.message?.content ?? null;
  } catch {
    return null;
  }
}

export interface VisionCompleteOptions {
  prompt: string;
  imageBase64: string;
  mediaType: string;
  maxTokens: number;
}

/** One image+text-in/text-out call, for critic.ts's screenshot review. */
export async function completeVision(opts: VisionCompleteOptions): Promise<string | null> {
  const provider = pickProvider();
  if (!provider) return null;
  try {
    if (provider === "anthropic") {
      const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
      const response = await client.messages.create({
        model: ANTHROPIC_MODEL,
        max_tokens: opts.maxTokens,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image",
                source: { type: "base64", media_type: opts.mediaType as "image/png", data: opts.imageBase64 },
              },
              { type: "text", text: opts.prompt },
            ],
          },
        ],
      });
      const block = response.content.find((c) => c.type === "text");
      return block && block.type === "text" ? block.text : null;
    }
    if (provider === "gemini") {
      const client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      const response = await client.models.generateContent({
        model: GEMINI_MODEL,
        contents: [opts.prompt, { inlineData: { data: opts.imageBase64, mimeType: opts.mediaType } }],
        config: { maxOutputTokens: opts.maxTokens },
      });
      return response.text ?? null;
    }
    // groq -- needs its separate vision-capable model; the text one above
    // doesn't accept image parts.
    const client = new Groq({ apiKey: process.env.GROQ_API_KEY });
    const completion = await client.chat.completions.create({
      model: GROQ_VISION_MODEL,
      max_tokens: opts.maxTokens,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: opts.prompt },
            { type: "image_url", image_url: { url: `data:${opts.mediaType};base64,${opts.imageBase64}` } },
          ],
        },
      ],
    });
    return completion.choices[0]?.message?.content ?? null;
  } catch {
    return null;
  }
}

/**
 * Streams a short acknowledgement reply token-by-token via `onDelta`, purely
 * as a typing-indicator-with-content UX for routes/messages.ts's SSE
 * endpoint -- never the authoritative reply. Swallows every error: a failed
 * or unavailable stream just means no deltas get sent, which is fine.
 */
export async function streamAck(userText: string, onDelta: (text: string) => void): Promise<void> {
  const provider = pickProvider();
  if (!provider) return;
  const system =
    "You are a friendly AI website builder assistant. Reply in one short, warm sentence " +
    "acknowledging the user's message about their website. Plain text only.";
  try {
    if (provider === "anthropic") {
      const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
      const stream = client.messages.stream({
        model: ANTHROPIC_MODEL,
        max_tokens: 150,
        system,
        messages: [{ role: "user", content: userText }],
      });
      stream.on("text", onDelta);
      await stream.finalMessage();
      return;
    }
    if (provider === "gemini") {
      const client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      const stream = await client.models.generateContentStream({
        model: GEMINI_MODEL,
        contents: userText,
        config: { maxOutputTokens: 150, systemInstruction: system },
      });
      for await (const chunk of stream) {
        if (chunk.text) onDelta(chunk.text);
      }
      return;
    }
    // groq
    const client = new Groq({ apiKey: process.env.GROQ_API_KEY });
    const stream = await client.chat.completions.create({
      model: GROQ_MODEL,
      max_tokens: 150,
      messages: [
        { role: "system", content: system },
        { role: "user", content: userText },
      ],
      stream: true,
    });
    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content;
      if (delta) onDelta(delta);
    }
  } catch {
    // non-fatal -- the "done" event still carries the real reply
  }
}
