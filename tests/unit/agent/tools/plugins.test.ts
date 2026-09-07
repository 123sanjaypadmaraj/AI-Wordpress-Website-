import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Project } from "@ai-wp/shared";

/**
 * tools/plugins.ts sits directly behind the trusted plugin allowlist
 * (PLG-01/SEC-06) -- these tests treat that boundary as load-bearing: an
 * unknown slug must never reach WP-CLI, and each configured plugin must get
 * the exact wp-cli config commands its configurator promises. Mocks at the
 * `@agent/docker/compose.js` boundary per docs/TESTING.md, since
 * `installAndConfigurePlugin` calls through `tools/wordpress.ts`'s thin
 * wrappers (installPlugin/activatePlugin/updateOption/wpEval), which all
 * bottom out in `execWpCli`.
 */
vi.mock("@agent/docker/compose.js", () => ({
  execWpCli: vi.fn().mockResolvedValue({ stdout: "", stderr: "" }),
  readProjectSecret: vi.fn(),
}));

import { execWpCli } from "@agent/docker/compose.js";
import {
  ALLOWED_PLUGINS,
  FEATURE_PLUGIN_MAP,
  installAndConfigurePlugin,
  isAllowedPlugin,
  pluginsForSpec,
} from "@agent/tools/plugins.js";

const execWpCliMock = vi.mocked(execWpCli);

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: "proj-1",
    name: "Test Site",
    status: "PLUGINS_INSTALLING",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    slots: {} as Project["slots"],
    spec: {
      site: { name: "Acme", type: "business", industry: "retail", audience: [] },
      pages: [],
      features: [],
      design: {
        style: "minimal",
        mode: "light",
        primary_color: "#3651D4",
        secondary_color: "#1E8E5A",
        heading_font: "Inter",
        body_font: "Inter",
        radius: "soft",
        preset: "minimal",
      },
      theme: { selected: "astra", use_child_theme: true },
      ecommerce: { payment: null },
      seo: false,
      accessibility: false,
      integrations: [],
      discoveredSkills: [],
    },
    themeRecommendations: [],
    docker: {
      projectId: "proj-1",
      status: "running",
      wpPort: 8123,
      containerPrefix: "aiwp-proj-1",
      previewUrl: "http://localhost:8123",
      adminUrl: "http://localhost:8123/wp-admin",
      createdAt: "2026-01-01T00:00:00.000Z",
      lastError: null,
    },
    log: [],
    auditLog: [],
    checkpoints: [],
    backups: [],
    ...overrides,
  } as Project;
}

beforeEach(() => {
  vi.clearAllMocks();
  execWpCliMock.mockResolvedValue({ stdout: "", stderr: "" });
});

describe("isAllowedPlugin (PLG-01 allowlist)", () => {
  it("allows every plugin in the curated ALLOWED_PLUGINS catalog", () => {
    for (const plugin of ALLOWED_PLUGINS) {
      expect(isAllowedPlugin(plugin.slug)).toBe(true);
    }
  });

  it("rejects an arbitrary/unknown plugin slug", () => {
    expect(isAllowedPlugin("some-random-untrusted-plugin")).toBe(false);
    expect(isAllowedPlugin("evil-plugin")).toBe(false);
  });

  it("rejects slug variations crafted to look like an allowed one", () => {
    expect(isAllowedPlugin("woocommerce-evil")).toBe(false);
    expect(isAllowedPlugin("WooCommerce")).toBe(false); // case-sensitive, no normalization
    expect(isAllowedPlugin(" woocommerce")).toBe(false); // no trimming
  });
});

describe("FEATURE_PLUGIN_MAP -> pluginsForSpec", () => {
  it("maps each known feature to its trusted plugin slug", () => {
    expect(FEATURE_PLUGIN_MAP.ecommerce).toBe("woocommerce");
    expect(FEATURE_PLUGIN_MAP["contact-form"]).toBe("contact-form-7");
    expect(FEATURE_PLUGIN_MAP.newsletter).toBe("mailpoet");
    expect(FEATURE_PLUGIN_MAP["event-registration"]).toBe("events-manager");
    expect(FEATURE_PLUGIN_MAP.booking).toBe("amelia");
  });

  it("resolves an e-commerce spec to woocommerce plus the always-on defaults", () => {
    const slugs = pluginsForSpec({ features: ["ecommerce"], seo: false, accessibility: false });
    expect(slugs).toEqual(expect.arrayContaining(["woocommerce", "akismet", "wp-super-cache"]));
    expect(slugs).not.toContain("wordpress-seo");
    expect(slugs).not.toContain("wp-accessibility");
  });

  it("adds wordpress-seo when spec.seo is set and wp-accessibility when spec.accessibility is set", () => {
    const slugs = pluginsForSpec({ features: [], seo: true, accessibility: true });
    expect(slugs).toEqual(
      expect.arrayContaining(["wordpress-seo", "wp-accessibility", "akismet", "wp-super-cache"]),
    );
  });

  it("every plugin an arbitrary spec resolves to passes the allowlist filter", () => {
    const slugs = pluginsForSpec({
      features: ["ecommerce", "contact-form", "newsletter", "event-registration", "booking"],
      seo: true,
      accessibility: true,
    });
    for (const slug of slugs) {
      expect(isAllowedPlugin(slug)).toBe(true);
    }
    // No duplicates even though multiple sources can contribute the same slug.
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it("a feature with no map entry contributes no plugin", () => {
    const slugs = pluginsForSpec({ features: ["blog"], seo: false, accessibility: false });
    expect(slugs).toEqual(expect.arrayContaining(["akismet", "wp-super-cache"]));
    expect(slugs).toHaveLength(2);
  });
});

describe("installAndConfigurePlugin -- allowlist enforcement", () => {
  it("rejects a plugin slug outside the trusted allowlist and never calls WP-CLI", async () => {
    await expect(installAndConfigurePlugin(makeProject(), "evil-plugin")).rejects.toThrow(
      /not in the trusted plugin allowlist/i,
    );
    expect(execWpCliMock).not.toHaveBeenCalled();
  });

  it("rejects an adversarial slug constructed to look like a WP-CLI flag", async () => {
    await expect(installAndConfigurePlugin(makeProject(), "--allow-root")).rejects.toThrow(
      /not in the trusted plugin allowlist/i,
    );
    expect(execWpCliMock).not.toHaveBeenCalled();
  });
});

describe("installAndConfigurePlugin -- per-plugin configuration (PLG-03)", () => {
  it("woocommerce: installs, activates, and applies the store defaults via wp-cli option updates", async () => {
    await installAndConfigurePlugin(makeProject(), "woocommerce");
    const calls = execWpCliMock.mock.calls.map((c) => c[1]);
    expect(calls).toContainEqual(["plugin", "install", "woocommerce", "--activate"]);
    expect(calls).toContainEqual(["plugin", "activate", "woocommerce"]);
    expect(calls).toContainEqual(["option", "update", "woocommerce_currency", "USD"]);
    expect(calls).toContainEqual(["option", "update", "woocommerce_store_address", ""]);
    expect(calls).toContainEqual(["option", "update", "woocommerce_default_country", "US"]);
    expect(calls).toContainEqual(["option", "update", "woocommerce_allow_tracking", "no"]);
  });

  it("wordpress-seo (Yoast): installs, activates, and makes the site public for indexing", async () => {
    await installAndConfigurePlugin(makeProject(), "wordpress-seo");
    const calls = execWpCliMock.mock.calls.map((c) => c[1]);
    expect(calls).toContainEqual(["plugin", "install", "wordpress-seo", "--activate"]);
    expect(calls).toContainEqual(["plugin", "activate", "wordpress-seo"]);
    expect(calls).toContainEqual(["option", "update", "blog_public", "1"]);
  });

  it("wp-super-cache (caching): installs, activates, and evaluates the enable-cache PHP snippet", async () => {
    await installAndConfigurePlugin(makeProject(), "wp-super-cache");
    const calls = execWpCliMock.mock.calls.map((c) => c[1]);
    expect(calls).toContainEqual(["plugin", "install", "wp-super-cache", "--activate"]);
    expect(calls).toContainEqual(["plugin", "activate", "wp-super-cache"]);
    const evalCall = calls.find((c) => c[0] === "eval");
    expect(evalCall).toBeDefined();
    expect(evalCall![1]).toContain("wp_super_cache_enabled");
  });

  it("wp-super-cache: a failure in the eval snippet is swallowed, not thrown (best-effort)", async () => {
    execWpCliMock.mockImplementation(((_id: string, args: string[]) => {
      if (args[0] === "eval") return Promise.reject(new Error("php fatal"));
      return Promise.resolve({ stdout: "", stderr: "" });
    }) as typeof execWpCli);
    await expect(installAndConfigurePlugin(makeProject(), "wp-super-cache")).resolves.toBeUndefined();
  });

  it("akismet (spam filtering): installs and activates but issues no config commands (no API key available)", async () => {
    await installAndConfigurePlugin(makeProject(), "akismet");
    const calls = execWpCliMock.mock.calls.map((c) => c[1]);
    expect(calls).toContainEqual(["plugin", "install", "akismet", "--activate"]);
    expect(calls).toContainEqual(["plugin", "activate", "akismet"]);
    expect(calls.filter((c) => c[0] === "option" || c[0] === "eval")).toHaveLength(0);
  });

  it.each(["mailpoet", "events-manager", "wp-accessibility", "contact-form-7", "amelia", "classic-editor"])(
    "%s: installs and activates with no configurator wired up yet -- install/activate only, no stray wp-cli calls",
    async (slug) => {
      await installAndConfigurePlugin(makeProject(), slug);
      const calls = execWpCliMock.mock.calls.map((c) => c[1]);
      expect(calls).toContainEqual(["plugin", "install", slug, "--activate"]);
      expect(calls).toContainEqual(["plugin", "activate", slug]);
      expect(calls).toHaveLength(2);
    },
  );

  it("tolerates `plugin activate` failing after install (treated as idempotent) without throwing", async () => {
    execWpCliMock.mockImplementation(((_id: string, args: string[]) => {
      if (args[0] === "plugin" && args[1] === "activate") return Promise.reject(new Error("already active"));
      return Promise.resolve({ stdout: "", stderr: "" });
    }) as typeof execWpCli);
    await expect(installAndConfigurePlugin(makeProject(), "contact-form-7")).resolves.toBeUndefined();
  });
});
