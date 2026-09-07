import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Project } from "@ai-wp/shared";

/**
 * tools/wordpress.ts is the thin WP-CLI wrapper every other tool/route in
 * the system builds on -- a wrong flag here silently breaks real sites, so
 * these tests assert the *exact* argv shape passed to `execWpCli`, not just
 * "it was called". Per docs/TESTING.md: mock `@agent/docker/compose.js`'s
 * exports, never `node:child_process` directly.
 */
vi.mock("@agent/docker/compose.js", () => ({
  execWpCli: vi.fn(),
  readProjectSecret: vi.fn(),
}));

import { execWpCli, readProjectSecret } from "@agent/docker/compose.js";
import {
  activatePlugin,
  activateTheme,
  addCustomCss,
  createMenu,
  createPage,
  deletePage,
  getContactFormId,
  getPage,
  getPageIdBySlug,
  getSiteStatus,
  installPlugin,
  installTheme,
  installWordPressCore,
  isPluginActive,
  listPages,
  removeMenuItemForPage,
  setHomepage,
  updateOption,
  updatePage,
  wpEval,
} from "@agent/tools/wordpress.js";

const execWpCliMock = vi.mocked(execWpCli);
const readProjectSecretMock = vi.mocked(readProjectSecret);

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: "proj-1",
    name: "Test Site",
    status: "WORDPRESS_READY",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    slots: {} as Project["slots"],
    spec: {
      site: { name: "Acme Bakery", type: "business", industry: "food", audience: [] },
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

function stdout(text: string) {
  return { stdout: text, stderr: "" };
}

beforeEach(() => {
  vi.clearAllMocks();
  execWpCliMock.mockResolvedValue(stdout(""));
});

describe("installWordPressCore", () => {
  it("throws if no generated admin password exists for the project", async () => {
    readProjectSecretMock.mockReturnValue(null);
    await expect(installWordPressCore(makeProject())).rejects.toThrow(
      /missing generated admin password/i,
    );
    expect(execWpCliMock).not.toHaveBeenCalled();
  });

  it("runs `wp core install` with the exact generated credentials and site url", async () => {
    readProjectSecretMock.mockImplementation((_id, key) => {
      if (key === "WP_ADMIN_USER") return "admin";
      if (key === "WP_ADMIN_PASSWORD") return "s3cr3t-pw";
      if (key === "WP_ADMIN_EMAIL") return "admin@example.local";
      return null;
    });
    execWpCliMock.mockResolvedValueOnce(stdout("")); // core is-installed check
    execWpCliMock.mockResolvedValueOnce(stdout("")); // core install
    execWpCliMock.mockResolvedValueOnce(stdout("")); // permalink option
    execWpCliMock.mockResolvedValueOnce(stdout("")); // timezone option

    const project = makeProject();
    await installWordPressCore(project);

    expect(execWpCliMock).toHaveBeenNthCalledWith(1, "proj-1", ["core", "is-installed", "--quiet"]);
    expect(execWpCliMock).toHaveBeenNthCalledWith(2, "proj-1", [
      "core",
      "install",
      "--url=http://localhost:8123",
      "--title=Acme Bakery",
      "--admin_user=admin",
      "--admin_password=s3cr3t-pw",
      "--admin_email=admin@example.local",
      "--skip-email",
    ]);
    expect(execWpCliMock).toHaveBeenNthCalledWith(3, "proj-1", [
      "option",
      "update",
      "permalink_structure",
      "/%postname%/",
    ]);
    expect(execWpCliMock).toHaveBeenNthCalledWith(4, "proj-1", ["option", "update", "timezone_string", "UTC"]);
  });

  it("tolerates the is-installed check itself failing (still proceeds to install)", async () => {
    readProjectSecretMock.mockImplementation((_id, key) => (key === "WP_ADMIN_PASSWORD" ? "pw" : null));
    execWpCliMock.mockRejectedValueOnce(new Error("not installed yet"));
    await installWordPressCore(makeProject());
    expect(execWpCliMock).toHaveBeenNthCalledWith(2, "proj-1", expect.arrayContaining(["core", "install"]));
  });
});

describe("theme install/activate", () => {
  it("installTheme installs and activates in one WP-CLI call", async () => {
    await installTheme(makeProject(), "astra");
    expect(execWpCliMock).toHaveBeenCalledWith("proj-1", ["theme", "install", "astra", "--activate"]);
  });

  it("activateTheme only activates, never re-installs", async () => {
    await activateTheme(makeProject(), "astra");
    expect(execWpCliMock).toHaveBeenCalledWith("proj-1", ["theme", "activate", "astra"]);
  });

  it("does not smuggle extra flags for an arbitrary slug (argv shape stays fixed)", async () => {
    await installTheme(makeProject(), "some-other-theme; rm -rf /");
    // The slug is passed as a single argv element, never shell-interpolated
    // into a string -- execFile's argv array is what prevents injection.
    expect(execWpCliMock).toHaveBeenCalledWith("proj-1", [
      "theme",
      "install",
      "some-other-theme; rm -rf /",
      "--activate",
    ]);
    expect(execWpCliMock.mock.calls[0][1]).toHaveLength(4);
  });
});

describe("plugin install/activate", () => {
  it("installPlugin installs and activates in one call", async () => {
    await installPlugin(makeProject(), "woocommerce");
    expect(execWpCliMock).toHaveBeenCalledWith("proj-1", ["plugin", "install", "woocommerce", "--activate"]);
  });

  it("activatePlugin only activates", async () => {
    await activatePlugin(makeProject(), "woocommerce");
    expect(execWpCliMock).toHaveBeenCalledWith("proj-1", ["plugin", "activate", "woocommerce"]);
  });

  it("isPluginActive resolves true when the WP-CLI check succeeds", async () => {
    execWpCliMock.mockResolvedValueOnce(stdout(""));
    await expect(isPluginActive(makeProject(), "woocommerce")).resolves.toBe(true);
    expect(execWpCliMock).toHaveBeenCalledWith("proj-1", ["plugin", "is-active", "woocommerce"]);
  });

  it("isPluginActive resolves false (not throw) when the WP-CLI check rejects", async () => {
    execWpCliMock.mockRejectedValueOnce(new Error("plugin not found"));
    await expect(isPluginActive(makeProject(), "missing-plugin")).resolves.toBe(false);
  });
});

describe("updateOption / wpEval", () => {
  it("updateOption runs `wp option update <key> <value>`", async () => {
    await updateOption(makeProject(), "blog_public", "1");
    expect(execWpCliMock).toHaveBeenCalledWith("proj-1", ["option", "update", "blog_public", "1"]);
  });

  it("wpEval runs the raw PHP snippet through `wp eval`", async () => {
    await wpEval(makeProject(), "echo 1;");
    expect(execWpCliMock).toHaveBeenCalledWith("proj-1", ["eval", "echo 1;"]);
  });
});

describe("createPage", () => {
  it("creates the page with the exact WP-CLI flags and returns the parsed post id", async () => {
    execWpCliMock.mockResolvedValueOnce(stdout("42\n")); // post create --porcelain
    execWpCliMock.mockResolvedValueOnce(stdout("")); // post update (content)

    const id = await createPage(makeProject(), {
      title: "About Us",
      slug: "about-us",
      content: "<!-- wp:paragraph --><p>Hi</p><!-- /wp:paragraph -->",
    });

    expect(id).toBe(42);
    expect(execWpCliMock).toHaveBeenNthCalledWith(1, "proj-1", [
      "post",
      "create",
      "--post_type=page",
      "--post_title=About Us",
      "--post_name=about-us",
      "--post_status=publish",
      "--porcelain",
    ]);
    expect(execWpCliMock).toHaveBeenNthCalledWith(2, "proj-1", [
      "post",
      "update",
      "42",
      "--post_content=<!-- wp:paragraph --><p>Hi</p><!-- /wp:paragraph -->",
    ]);
  });

  it("skips the follow-up content update entirely when content is empty", async () => {
    execWpCliMock.mockResolvedValueOnce(stdout("7"));
    const id = await createPage(makeProject(), { title: "Blank", slug: "blank", content: "" });
    expect(id).toBe(7);
    expect(execWpCliMock).toHaveBeenCalledTimes(1);
  });
});

describe("setHomepage", () => {
  it("sets show_on_front + page_on_front as two distinct option updates", async () => {
    await setHomepage(makeProject(), 42);
    expect(execWpCliMock).toHaveBeenNthCalledWith(1, "proj-1", ["option", "update", "show_on_front", "page"]);
    expect(execWpCliMock).toHaveBeenNthCalledWith(2, "proj-1", ["option", "update", "page_on_front", "42"]);
  });
});

describe("getPageIdBySlug", () => {
  it("parses the first ID from `wp post list`", async () => {
    execWpCliMock.mockResolvedValueOnce(stdout("15\n"));
    await expect(getPageIdBySlug(makeProject(), "about")).resolves.toBe(15);
    expect(execWpCliMock).toHaveBeenCalledWith("proj-1", [
      "post",
      "list",
      "--post_type=page",
      "--name=about",
      "--field=ID",
      "--post_status=publish,draft,future",
    ]);
  });

  it("returns null (not throw) when the lookup fails", async () => {
    execWpCliMock.mockRejectedValueOnce(new Error("wp-cli exploded"));
    await expect(getPageIdBySlug(makeProject(), "missing")).resolves.toBeNull();
  });

  it("returns null for empty/garbage output", async () => {
    execWpCliMock.mockResolvedValueOnce(stdout(""));
    await expect(getPageIdBySlug(makeProject(), "missing")).resolves.toBeNull();
  });
});

describe("updatePage", () => {
  it("includes only the flags for fields actually provided", async () => {
    await updatePage(makeProject(), 9, { title: "New Title" });
    expect(execWpCliMock).toHaveBeenCalledWith("proj-1", ["post", "update", "9", "--post_title=New Title"]);
  });

  it("includes both flags when both fields are provided", async () => {
    await updatePage(makeProject(), 9, { title: "T", content: "<p>C</p>" });
    expect(execWpCliMock).toHaveBeenCalledWith("proj-1", [
      "post",
      "update",
      "9",
      "--post_title=T",
      "--post_content=<p>C</p>",
    ]);
  });

  it("makes no WP-CLI call at all when no fields are given", async () => {
    await updatePage(makeProject(), 9, {});
    expect(execWpCliMock).not.toHaveBeenCalled();
  });
});

describe("deletePage", () => {
  it("force-deletes the given post id", async () => {
    await deletePage(makeProject(), 9);
    expect(execWpCliMock).toHaveBeenCalledWith("proj-1", ["post", "delete", "9", "--force"]);
  });
});

describe("listPages / getPage", () => {
  it("listPages maps the JSON rows into CmsPageSummary shape", async () => {
    execWpCliMock.mockResolvedValueOnce(
      stdout(
        JSON.stringify([
          { ID: "1", post_title: "Home", post_name: "home", post_status: "publish" },
          { ID: "2", post_title: "About", post_name: "about", post_status: "draft" },
        ]),
      ),
    );
    await expect(listPages(makeProject())).resolves.toEqual([
      { id: 1, title: "Home", slug: "home", status: "publish" },
      { id: 2, title: "About", slug: "about", status: "draft" },
    ]);
    expect(execWpCliMock).toHaveBeenCalledWith("proj-1", [
      "post",
      "list",
      "--post_type=page",
      "--post_status=publish,draft,future,private",
      "--fields=ID,post_title,post_name,post_status",
      "--format=json",
      "--orderby=title",
      "--order=ASC",
    ]);
  });

  it("listPages degrades to an empty array on malformed JSON, never throws", async () => {
    execWpCliMock.mockResolvedValueOnce(stdout("not json"));
    await expect(listPages(makeProject())).resolves.toEqual([]);
  });

  it("listPages degrades to an empty array when the WP-CLI call itself fails", async () => {
    execWpCliMock.mockRejectedValueOnce(new Error("boom"));
    await expect(listPages(makeProject())).resolves.toEqual([]);
  });

  it("getPage returns the full detail shape including content", async () => {
    execWpCliMock.mockResolvedValueOnce(
      stdout(
        JSON.stringify({
          ID: "1",
          post_title: "Home",
          post_name: "home",
          post_status: "publish",
          post_content: "<p>Hi</p>",
        }),
      ),
    );
    await expect(getPage(makeProject(), 1)).resolves.toEqual({
      id: 1,
      title: "Home",
      slug: "home",
      status: "publish",
      content: "<p>Hi</p>",
    });
  });

  it("getPage returns null for a missing page (empty stdout) without throwing", async () => {
    execWpCliMock.mockResolvedValueOnce(stdout(""));
    await expect(getPage(makeProject(), 999)).resolves.toBeNull();
  });

  it("getPage returns null on malformed JSON", async () => {
    execWpCliMock.mockResolvedValueOnce(stdout("{not json"));
    await expect(getPage(makeProject(), 1)).resolves.toBeNull();
  });
});

describe("createMenu (nav menu assignment)", () => {
  it("creates the menu, adds only pages not already on it, and assigns the primary location", async () => {
    execWpCliMock.mockImplementation(((_id: string, args: string[]) => {
      if (args[0] === "menu" && args[1] === "create") return Promise.resolve(stdout(""));
      if (args[0] === "menu" && args[1] === "item" && args[2] === "list") {
        // Existing menu already has object_id 5 on it (the "about" page).
        return Promise.resolve(stdout("object_id\n5\n"));
      }
      if (args[0] === "post" && args[1] === "list") {
        // getPageIdBySlug lookups, keyed by which slug's --name= flag was passed.
        const nameFlag = args.find((a) => a.startsWith("--name="));
        if (nameFlag === "--name=home") return Promise.resolve(stdout("4"));
        if (nameFlag === "--name=about") return Promise.resolve(stdout("5"));
        return Promise.resolve(stdout(""));
      }
      return Promise.resolve(stdout(""));
    }) as typeof execWpCli);

    await createMenu(makeProject(), "primary-menu", ["home", "about"]);

    const calls = execWpCliMock.mock.calls.map((c) => c[1]);
    expect(calls).toContainEqual(["menu", "create", "primary-menu"]);
    // "home" (id 4) isn't on the menu yet -> gets added.
    expect(calls).toContainEqual(["menu", "item", "add-post", "primary-menu", "4"]);
    // "about" (id 5) is already on the menu -> must NOT be added again.
    expect(calls).not.toContainEqual(["menu", "item", "add-post", "primary-menu", "5"]);
    expect(calls).toContainEqual(["menu", "location", "assign", "primary-menu", "primary"]);
  });

  it("tolerates `menu create` failing on a re-run (idempotent-ish) without throwing", async () => {
    execWpCliMock.mockImplementation(((_id: string, args: string[]) => {
      if (args[0] === "menu" && args[1] === "create") return Promise.reject(new Error("menu already exists"));
      return Promise.resolve(stdout(""));
    }) as typeof execWpCli);
    await expect(createMenu(makeProject(), "primary-menu", [])).resolves.toBeUndefined();
  });
});

describe("removeMenuItemForPage", () => {
  it("deletes the menu item row whose object_id matches the page id", async () => {
    execWpCliMock.mockResolvedValueOnce(stdout("db_id,object_id\n101,4\n102,5\n"));
    execWpCliMock.mockResolvedValueOnce(stdout(""));

    await removeMenuItemForPage(makeProject(), "primary-menu", 5);

    expect(execWpCliMock).toHaveBeenNthCalledWith(1, "proj-1", [
      "menu",
      "item",
      "list",
      "primary-menu",
      "--fields=db_id,object_id",
      "--format=csv",
    ]);
    // object_id 5 (the page being removed) is on row "102,5" -> db_id 102.
    expect(execWpCliMock).toHaveBeenNthCalledWith(2, "proj-1", ["menu", "item", "delete", "102"]);
  });

  it("does nothing when no row matches the page id", async () => {
    execWpCliMock.mockResolvedValueOnce(stdout("db_id,object_id\n101,4\n"));
    await removeMenuItemForPage(makeProject(), "primary-menu", 999);
    expect(execWpCliMock).toHaveBeenCalledTimes(1); // only the list call
  });
});

describe("addCustomCss", () => {
  it("escapes each single quote to the sh-safe quote-backslash-quote-quote sequence, so CSS content can't break out of the PHP string literal", async () => {
    await addCustomCss(makeProject(), "a { content: 'quoted'; }");
    const QUOTE_ESCAPE = "'" + "\\" + "'" + "'"; // ' \ ' '
    const expectedEncoded = "a { content: " + QUOTE_ESCAPE + "quoted" + QUOTE_ESCAPE + "; }";
    expect(execWpCliMock).toHaveBeenCalledWith("proj-1", ["eval", `wp_update_custom_css_post('${expectedEncoded}');`]);
  });

  it("passes plain CSS through untouched when there is nothing to escape", async () => {
    await addCustomCss(makeProject(), "body { color: red; }");
    expect(execWpCliMock).toHaveBeenCalledWith("proj-1", [
      "eval",
      "wp_update_custom_css_post('body { color: red; }');",
    ]);
  });
});

describe("getContactFormId", () => {
  it("looks up Contact Form 7's default form by post type", async () => {
    execWpCliMock.mockResolvedValueOnce(stdout("3"));
    await expect(getContactFormId(makeProject())).resolves.toBe(3);
    expect(execWpCliMock).toHaveBeenCalledWith("proj-1", [
      "post",
      "list",
      "--post_type=wpcf7_contact_form",
      "--field=ID",
      "--posts_per_page=1",
      "--orderby=ID",
      "--order=ASC",
    ]);
  });

  it("returns null when Contact Form 7 has no default form yet", async () => {
    execWpCliMock.mockResolvedValueOnce(stdout(""));
    await expect(getContactFormId(makeProject())).resolves.toBeNull();
  });
});

describe("getSiteStatus", () => {
  it("returns the trimmed WP core version", async () => {
    execWpCliMock.mockResolvedValueOnce(stdout("6.7.1\n"));
    await expect(getSiteStatus(makeProject())).resolves.toEqual({ coreVersion: "6.7.1" });
    expect(execWpCliMock).toHaveBeenCalledWith("proj-1", ["core", "version"]);
  });
});
