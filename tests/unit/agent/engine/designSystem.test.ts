import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { emptySiteSpecification } from "@ai-wp/shared";
import type { SiteSpecification } from "@ai-wp/shared";

vi.mock("../../../../apps/agent/src/llm/client.js", () => ({
  aiAvailable: vi.fn(),
  completeText: vi.fn(),
}));

import { aiAvailable, completeText } from "../../../../apps/agent/src/llm/client.js";
import {
  DESIGN_PRESETS,
  presetById,
  pickPresetHeuristic,
  deriveSecondaryColor,
  heuristicDesignSystem,
  buildDesignSystem,
} from "../../../../apps/agent/src/engine/designSystem.js";

function makeSpec(overrides: Partial<SiteSpecification> = {}): SiteSpecification {
  const base = emptySiteSpecification("Acme");
  return {
    ...base,
    ...overrides,
    site: { ...base.site, ...(overrides.site ?? {}) },
    design: { ...base.design, ...(overrides.design ?? {}) },
  };
}

/**
 * Independent reference decoder (hex -> HSL), written fresh here rather than
 * imported from src, so the assertions below actually re-derive the color
 * math instead of just re-running the implementation under test on itself.
 */
function hexToHsl(hex: string): [number, number, number] {
  const n = parseInt(hex.replace("#", ""), 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
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

/** Shortest signed distance between two hues on the color wheel, in degrees. */
function hueDistance(a: number, b: number): number {
  const diff = Math.abs(a - b) % 360;
  return diff > 180 ? 360 - diff : diff;
}

describe("engine/designSystem.ts", () => {
  beforeEach(() => {
    vi.mocked(aiAvailable).mockReset().mockReturnValue(false);
    vi.mocked(completeText).mockReset();
  });
  afterEach(() => vi.restoreAllMocks());

  describe("presetById / pickPresetHeuristic", () => {
    it("returns the exact curated preset for a known id", () => {
      expect(presetById("bold")).toEqual(
        expect.objectContaining({ id: "bold", headingFont: "Poppins", bodyFont: "Inter", radius: "pill" }),
      );
    });

    it("falls back to the default (minimal) preset for an unknown id", () => {
      expect(presetById("does-not-exist").id).toBe("minimal");
    });

    it("matches by visual style first", () => {
      expect(pickPresetHeuristic("bold", "blog").id).toBe("bold");
    });

    it("falls back to matching by site type when style doesn't match anything", () => {
      expect(pickPresetHeuristic("nonexistent-style", "restaurant").id).toBe("playful");
    });

    it("falls back to the minimal default when neither style nor type match", () => {
      expect(pickPresetHeuristic("nonexistent-style", "nonexistent-type").id).toBe("minimal");
    });

    it("every DESIGN_PRESETS entry is reachable by at least one of its own tags", () => {
      for (const preset of DESIGN_PRESETS) {
        for (const tag of preset.tags) {
          expect(pickPresetHeuristic(tag, "nonexistent-type").id).toBe(preset.id);
        }
      }
    });
  });

  describe("deriveSecondaryColor math", () => {
    it("produces a valid 6-digit uppercase hex color", () => {
      const hex = deriveSecondaryColor("#3651D4", "light");
      expect(hex).toMatch(/^#[0-9A-F]{6}$/);
    });

    it("rotates the hue ~150 degrees off the primary, independent of mode", () => {
      const primaryHue = hexToHsl("#3651D4")[0];
      for (const mode of ["light", "dark"] as const) {
        const secondary = deriveSecondaryColor("#3651D4", mode);
        const [secHue] = hexToHsl(secondary);
        // hex quantization (8 bits/channel) limits precision -- allow a small tolerance.
        expect(hueDistance(secHue, (primaryHue + 150) % 360)).toBeLessThan(2);
      }
    });

    it("nudges lightness down a bit in light mode and up in dark mode, relative to the primary", () => {
      const [, , primaryL] = hexToHsl("#3651D4");
      const [, , lightSecL] = hexToHsl(deriveSecondaryColor("#3651D4", "light"));
      const [, , darkSecL] = hexToHsl(deriveSecondaryColor("#3651D4", "dark"));

      expect(lightSecL).toBeLessThan(primaryL);
      expect(darkSecL).toBeGreaterThan(primaryL);
      expect(darkSecL).toBeGreaterThan(lightSecL);
    });

    it("clamps saturation to a floor of 45% for a very low-saturation (grayscale) primary", () => {
      const [, secSat] = hexToHsl(deriveSecondaryColor("#808080", "light")); // s=0 before clamping
      expect(secSat).toBeGreaterThanOrEqual(43); // allow ~2pt quantization slack
      expect(secSat).toBeLessThanOrEqual(47);
    });

    it("clamps saturation to a ceiling of 85% for a fully-saturated primary", () => {
      const [, secSat] = hexToHsl(deriveSecondaryColor("#FF0000", "light")); // s=100 before clamping
      expect(secSat).toBeGreaterThanOrEqual(83);
      expect(secSat).toBeLessThanOrEqual(87);
    });

    it("clamps lightness to a floor of 28% in light mode for a very dark primary", () => {
      const [, , secL] = hexToHsl(deriveSecondaryColor("#0A0A12", "light"));
      expect(secL).toBeGreaterThanOrEqual(26);
    });

    it("clamps lightness to a ceiling of 70% in dark mode for a very light primary", () => {
      const [, , secL] = hexToHsl(deriveSecondaryColor("#F5F5F5", "dark"));
      expect(secL).toBeLessThanOrEqual(72);
    });

    it("is deterministic: the same primary+mode always derives the same secondary", () => {
      const a = deriveSecondaryColor("#3651D4", "light");
      const b = deriveSecondaryColor("#3651D4", "light");
      expect(a).toBe(b);
    });

    it("falls back to the default brand blue's math for a malformed hex input", () => {
      // hexToRgb's own fallback for anything that doesn't parse as 6 hex digits.
      expect(deriveSecondaryColor("not-a-hex-color", "light")).toBe(deriveSecondaryColor("#3651D4", "light"));
      expect(deriveSecondaryColor("#zzz", "dark")).toBe(deriveSecondaryColor("#3651D4", "dark"));
    });

    it("expands 3-digit hex shorthand the same way a browser would", () => {
      // #123 -> #112233
      expect(deriveSecondaryColor("#123", "light")).toBe(deriveSecondaryColor("#112233", "light"));
    });
  });

  describe("heuristicDesignSystem", () => {
    it("bundles the matched preset's fonts/radius with a derived secondary color", () => {
      const result = heuristicDesignSystem("bold", "ecommerce", "#3651D4", "dark");
      expect(result.preset).toBe("bold");
      expect(result.heading_font).toBe("Poppins");
      expect(result.body_font).toBe("Inter");
      expect(result.radius).toBe("pill");
      expect(result.secondary_color).toBe(deriveSecondaryColor("#3651D4", "dark"));
    });
  });

  describe("buildDesignSystem: heuristic path (no AI provider configured)", () => {
    it("returns the pure heuristic bundle and never calls completeText", async () => {
      vi.mocked(aiAvailable).mockReturnValue(false);
      const spec = makeSpec({ design: { ...emptySiteSpecification().design, style: "playful", primary_color: "#D14F97" } });
      spec.site.type = "restaurant";

      const result = await buildDesignSystem(spec);

      expect(result).toEqual(heuristicDesignSystem("playful", "restaurant", "#D14F97", spec.design.mode));
      expect(completeText).not.toHaveBeenCalled();
    });
  });

  describe("buildDesignSystem: AI-informed override path", () => {
    beforeEach(() => vi.mocked(aiAvailable).mockReturnValue(true));

    it("uses the AI-chosen preset and secondary color when both are valid", async () => {
      vi.mocked(completeText).mockResolvedValue('{"preset": "editorial", "secondary_color": "#00AA44"}');
      const spec = makeSpec();
      const result = await buildDesignSystem(spec);

      expect(result.preset).toBe("editorial");
      expect(result.heading_font).toBe("Playfair Display");
      expect(result.body_font).toBe("Georgia");
      expect(result.radius).toBe("sharp");
      expect(result.secondary_color).toBe("#00AA44");
    });

    it("falls back to the heuristic preset when the AI names one outside the curated list, but keeps its valid secondary color", async () => {
      vi.mocked(completeText).mockResolvedValue('{"preset": "cyberpunk-deluxe", "secondary_color": "#00AA44"}');
      const spec = makeSpec({ design: { ...emptySiteSpecification().design, style: "corporate" } });
      const heuristic = heuristicDesignSystem("corporate", spec.site.type, spec.design.primary_color, spec.design.mode);

      const result = await buildDesignSystem(spec);

      expect(result.preset).toBe(heuristic.preset);
      expect(result.heading_font).toBe(heuristic.heading_font);
      expect(result.secondary_color).toBe("#00AA44"); // this field was still valid
    });

    it("falls back to the heuristic secondary color when the AI's is not a valid hex, but keeps its valid preset", async () => {
      vi.mocked(completeText).mockResolvedValue('{"preset": "bold", "secondary_color": "green-ish"}');
      const spec = makeSpec();
      const heuristic = heuristicDesignSystem(spec.design.style, spec.site.type, spec.design.primary_color, spec.design.mode);

      const result = await buildDesignSystem(spec);

      expect(result.preset).toBe("bold");
      expect(result.secondary_color).toBe(heuristic.secondary_color);
    });

    it("falls back entirely to the heuristic bundle when completeText returns null (no provider reply)", async () => {
      vi.mocked(completeText).mockResolvedValue(null);
      const spec = makeSpec();
      const result = await buildDesignSystem(spec);
      expect(result).toEqual(heuristicDesignSystem(spec.design.style, spec.site.type, spec.design.primary_color, spec.design.mode));
    });

    it("falls back entirely to the heuristic bundle when completeText returns unparseable JSON", async () => {
      vi.mocked(completeText).mockResolvedValue("Sure! Here's my pick: bold, with a nice green.");
      const spec = makeSpec();
      const result = await buildDesignSystem(spec);
      expect(result).toEqual(heuristicDesignSystem(spec.design.style, spec.site.type, spec.design.primary_color, spec.design.mode));
    });
  });
});
