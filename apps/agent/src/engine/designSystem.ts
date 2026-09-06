import type { SiteSpecification } from "@ai-wp/shared";
import { aiAvailable, completeText } from "../llm/client.js";

/**
 * GEN-10: the design system phase after "content first" (GEN-05/05b) --
 * upgrading spec.design from a single primary color + one font into a real,
 * coherent bundle: a secondary/accent color, a heading/body font pairing,
 * and a corner-radius personality, all chosen together rather than picked
 * independently.
 *
 * Same two-mode shape as every other engine module here (requirements.ts,
 * copywriter.ts, contentGenerator.ts): a deterministic, fully-offline
 * heuristic (keyword-match the visual style/site type against a small
 * curated preset table, derive the secondary color mathematically from the
 * primary) upgraded to an AI-informed pick -- still constrained to the same
 * curated presets, so a hallucinated font or a wall of unreadable CSS is
 * never possible -- when a provider is configured. Nothing downstream
 * (childtheme.ts's CSS renderer, themes.ts's variant swatches) needs to know
 * which mode produced the bundle it's rendering.
 */

export interface DesignPreset {
  id: string;
  label: string;
  radius: "sharp" | "soft" | "pill";
  headingFont: string;
  bodyFont: string;
  /** Matched against spec.design.style and spec.site.type -- see pickPresetHeuristic. */
  tags: string[];
}

// Every font named here must have a stack in childtheme.ts's GOOGLE_FONT_STACKS
// (a name that isn't there still works -- it just falls back to a generic
// sans-serif stack -- but these are the ones actually designed to pair well).
export const DESIGN_PRESETS: DesignPreset[] = [
  {
    id: "minimal",
    label: "Minimal",
    radius: "soft",
    headingFont: "Inter",
    bodyFont: "Inter",
    tags: ["minimal", "startup", "blog"],
  },
  {
    id: "corporate",
    label: "Corporate",
    radius: "sharp",
    headingFont: "IBM Plex Sans",
    bodyFont: "IBM Plex Sans",
    tags: ["corporate", "organization", "agency"],
  },
  {
    id: "bold",
    label: "Bold",
    radius: "pill",
    headingFont: "Poppins",
    bodyFont: "Inter",
    tags: ["bold", "futuristic", "ecommerce"],
  },
  {
    id: "playful",
    label: "Playful",
    radius: "pill",
    headingFont: "Poppins",
    bodyFont: "Nunito",
    tags: ["playful", "club", "restaurant"],
  },
  {
    id: "editorial",
    label: "Editorial",
    radius: "sharp",
    headingFont: "Playfair Display",
    bodyFont: "Georgia",
    tags: ["premium", "portfolio", "nonprofit"],
  },
];

const PRESET_BY_ID = new Map(DESIGN_PRESETS.map((p) => [p.id, p]));
const DEFAULT_PRESET = DESIGN_PRESETS[0];

export function presetById(id: string): DesignPreset {
  return PRESET_BY_ID.get(id) ?? DEFAULT_PRESET;
}

/**
 * Keyword match against a preset's tags, trying the visual style first (a
 * more deliberate signal than the site type) and falling back to the type.
 * Always returns something -- "minimal" is a safe, neutral default for a
 * style/type this table hasn't seen.
 */
export function pickPresetHeuristic(style: string, siteType: string): DesignPreset {
  const byStyle = DESIGN_PRESETS.find((p) => p.tags.includes(style));
  if (byStyle) return byStyle;
  const byType = DESIGN_PRESETS.find((p) => p.tags.includes(siteType));
  if (byType) return byType;
  return DEFAULT_PRESET;
}

// ---------------------------------------------------------------------------
// Secondary/accent color: derived mathematically from the primary so one
// never ships without the other, regardless of where primary_color came from
// (a keyword color word, a hex the user typed, a theme variant swatch).
// ---------------------------------------------------------------------------

function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace("#", "");
  const full = clean.length === 3 ? clean.split("").map((c) => c + c).join("") : clean;
  const n = parseInt(full, 16);
  if (full.length !== 6 || Number.isNaN(n)) return [54, 81, 212]; // fallback: the default brand blue
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l * 100];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  switch (max) {
    case r:
      h = ((g - b) / d + (g < b ? 6 : 0)) * 60;
      break;
    case g:
      h = ((b - r) / d + 2) * 60;
      break;
    default:
      h = ((r - g) / d + 4) * 60;
  }
  return [h, s * 100, l * 100];
}

function hslToHex(h: number, s: number, l: number): string {
  h = ((h % 360) + 360) % 360;
  s = Math.min(100, Math.max(0, s)) / 100;
  l = Math.min(100, Math.max(0, l)) / 100;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let [r, g, b] = [0, 0, 0];
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const toHex = (v: number) =>
    Math.round((v + m) * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`.toUpperCase();
}

/**
 * A triadic-ish hue rotation off the primary color -- distinct enough to be
 * useful as a second accent (gradients, alternating tiles) without clashing,
 * with saturation/lightness nudged to stay legible in either light or dark
 * mode rather than reproducing the primary's own tone exactly.
 */
export function deriveSecondaryColor(primaryHex: string, mode: "light" | "dark"): string {
  const [r, g, b] = hexToRgb(primaryHex);
  const [h, s, l] = rgbToHsl(r, g, b);
  const hue = h + 150;
  const saturation = Math.min(85, Math.max(45, s));
  const lightness = mode === "dark" ? Math.min(70, l + 12) : Math.max(28, l - 6);
  return hslToHex(hue, saturation, lightness);
}

// ---------------------------------------------------------------------------
// Full bundle: what requirements.ts and themes.ts actually consume.
// ---------------------------------------------------------------------------

export interface DesignSystemFields {
  secondary_color: string;
  heading_font: string;
  body_font: string;
  radius: "sharp" | "soft" | "pill";
  preset: string;
}

export function heuristicDesignSystem(style: string, siteType: string, primaryColor: string, mode: "light" | "dark"): DesignSystemFields {
  const preset = pickPresetHeuristic(style, siteType);
  return {
    secondary_color: deriveSecondaryColor(primaryColor, mode),
    heading_font: preset.headingFont,
    body_font: preset.bodyFont,
    radius: preset.radius,
    preset: preset.id,
  };
}

interface AiDesignResponse {
  preset?: string;
  secondary_color?: string;
}

const HEX_RE = /^#[0-9a-f]{6}$/i;

/**
 * Asks the model to pick, from the curated preset list, the one that best
 * fits this specific business, plus a secondary color -- constrained to
 * "one of these exact ids" and "a hex color", each independently validated
 * and falling back to the heuristic pick on any miss, same per-field
 * fallback spirit as contentGenerator.ts's aiSupportingContent.
 */
async function aiDesignSystem(spec: SiteSpecification): Promise<Partial<AiDesignResponse> | null> {
  const presetList = DESIGN_PRESETS.map((p) => `"${p.id}" (${p.label}: ${p.tags.join("/")} feel)`).join(", ");
  const reply = await completeText({
    maxTokens: 150,
    system:
      "You are the design-system module of an AI WordPress website builder. Given a business, pick the best-fitting " +
      `design preset from EXACTLY this list: ${presetList}. Also suggest a secondary accent color (hex) that ` +
      "complements the given primary color without clashing. Reply with JSON only: " +
      '{"preset": string, "secondary_color": string (hex, e.g. "#1E8E5A")}. No prose.',
    prompt:
      `Business: ${spec.site.name}\nType: ${spec.site.type || "business"}\nIndustry: ${spec.site.industry || "general"}\n` +
      `Visual style requested: ${spec.design.style || "modern"}\nPrimary color: ${spec.design.primary_color}\nMode: ${spec.design.mode}`,
  });
  if (!reply) return null;
  try {
    const match = reply.match(/\{[\s\S]*\}/);
    if (!match) return null;
    return JSON.parse(match[0]) as AiDesignResponse;
  } catch {
    return null;
  }
}

/**
 * AI-first (when a provider is configured), heuristic per-field fallback
 * otherwise or on any invalid/missing field -- called once when a spec is
 * ready (routes/messages.ts) so the extra model round-trip never blocks the
 * synchronous, offline-safe path requirements.ts uses to build the initial
 * spec.
 */
export async function buildDesignSystem(spec: SiteSpecification): Promise<DesignSystemFields> {
  const heuristic = heuristicDesignSystem(spec.design.style, spec.site.type, spec.design.primary_color, spec.design.mode);
  if (!aiAvailable()) return heuristic;

  const ai = await aiDesignSystem(spec);
  if (!ai) return heuristic;

  const preset = ai.preset && PRESET_BY_ID.has(ai.preset) ? presetById(ai.preset) : null;
  const secondary = ai.secondary_color && HEX_RE.test(ai.secondary_color) ? ai.secondary_color : null;

  return {
    secondary_color: secondary ?? heuristic.secondary_color,
    heading_font: preset?.headingFont ?? heuristic.heading_font,
    body_font: preset?.bodyFont ?? heuristic.body_font,
    radius: preset?.radius ?? heuristic.radius,
    preset: preset?.id ?? heuristic.preset,
  };
}
