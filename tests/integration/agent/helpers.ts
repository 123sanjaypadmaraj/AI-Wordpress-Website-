import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { vi } from "vitest";
import request from "supertest";
import type { Express } from "express";
import type { Message, Project } from "@ai-wp/shared";

/**
 * Shared test infra for tests/integration/agent/*.test.ts -- builds a real
 * Express app (apps/agent/src/app.ts) wired to the real routes, dispatcher,
 * and engine/*.ts modules, with only the actual I/O boundaries mocked:
 *
 *  - @agent/db/store.js: an in-memory Map-backed fake with the exact same
 *    surface as db/store.ts. Not listed in docs/TESTING.md's "mock at this
 *    boundary" section (that's about Docker/WP-CLI specifically), but the
 *    real store.ts persists to a JSON file on disk (apps/agent/data/*.json)
 *    with no way to redirect that path -- mocking it here keeps these tests
 *    hermetic (no writes to the real repo checkout) and fast, while every
 *    route still calls the exact same store.getProject/saveProject/etc.
 *    surface it always has. See coordination/status/06-integration-routes.md.
 *  - @agent/docker/compose.js: every real Docker/WP-CLI call funnels through
 *    here (docs/TESTING.md) -- replaced with an in-memory fake WordPress
 *    site (see makeFakeWpCli below) so create/update/delete/list-page tool
 *    calls behave realistically enough for the content-tab and state-machine
 *    tests to make real assertions against, without Docker.
 *  - @agent/tools/screenshot.js and @agent/engine/testRunner.js: these two
 *    launch Playwright/Chromium *directly* against project.docker.previewUrl
 *    -- not through docker/compose.js -- so mocking compose.ts alone still
 *    leaves a real headless-browser launch against a URL nothing is actually
 *    serving. Mocked so the full build pipeline can run in-process.
 *  - @agent/middleware/rateLimit.js: replaced with pass-through middleware.
 *    The real limiters (20 chat messages/min, 30 project creates/15min) are
 *    meant for abuse protection, not to bound how many requests one test
 *    file's full-lifecycle scenario makes against the exact same in-process
 *    IP -- see Decisions in the status file.
 *
 * Everything else (routes/*.ts, tools/dispatcher.ts, tools/wordpress.ts,
 * tools/plugins.ts, tools/checkpoint.ts, tools/childtheme.ts, every
 * engine/*.ts module, the orchestrator) is the REAL module -- this is what
 * makes these integration tests of the HTTP + state-machine + dispatcher
 * layer, not unit tests with everything stubbed out.
 */

// ---------------------------------------------------------------------------
// Env: force a deterministic, fully-offline run for every test in this
// directory. Set before anything under apps/agent/src is imported (this
// module must be imported first in every test file, before any static
// import of ./helpers.js's exports triggers the app's module graph to load).
// ---------------------------------------------------------------------------
export const AGENT_KEY = "test-agent-key-06";
process.env.AGENT_API_KEY = AGENT_KEY;
process.env.WEB_ORIGIN = "http://localhost:3000";
process.env.SKILL_SOURCE = "curated"; // no live WordPress.org plugin search
process.env.THEME_SOURCE = "catalog"; // no live WordPress.org theme search
delete process.env.ANTHROPIC_API_KEY;
delete process.env.GEMINI_API_KEY;
delete process.env.GROQ_API_KEY;
delete process.env.AI_PROVIDER;
delete process.env.DATABASE_URL;

// ---------------------------------------------------------------------------
// Fake store (@agent/db/store.js)
// ---------------------------------------------------------------------------
const storeState = vi.hoisted(() => ({
  projects: new Map<string, Project>(),
  messages: new Map<string, Message[]>(),
}));

vi.mock("@agent/db/store.js", () => ({
  store: {
    listProjects: () =>
      [...storeState.projects.values()].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()),
    getProject: (id: string) => storeState.projects.get(id),
    saveProject: (p: Project) => {
      p.updatedAt = new Date().toISOString();
      storeState.projects.set(p.id, p);
      return p;
    },
    deleteProject: (id: string) => {
      storeState.projects.delete(id);
      storeState.messages.delete(id);
    },
    listMessages: (id: string) => storeState.messages.get(id) ?? [],
    appendMessage: (m: Message) => {
      const arr = storeState.messages.get(m.projectId) ?? [];
      arr.push(m);
      storeState.messages.set(m.projectId, arr);
    },
  },
  initStore: vi.fn().mockResolvedValue(undefined),
}));

// ---------------------------------------------------------------------------
// Fake docker/compose.js -- a tiny in-memory WordPress standing in for real
// WP-CLI/Docker. Modeled just enough to make wordpress.ts's actual page
// create/update/delete/list/get logic (tools/wordpress.ts is NOT mocked)
// behave like a real site would.
// ---------------------------------------------------------------------------
interface FakePage {
  id: number;
  title: string;
  slug: string;
  status: string;
  content: string;
}
interface FakeSite {
  pages: Map<number, FakePage>;
  nextId: number;
}

let scratchRoot = "";
const sites = new Map<string, FakeSite>();

function siteFor(projectId: string): FakeSite {
  let site = sites.get(projectId);
  if (!site) {
    site = { pages: new Map(), nextId: 100 };
    sites.set(projectId, site);
  }
  return site;
}

function argValue(args: string[], prefix: string): string | undefined {
  const hit = args.find((a) => a.startsWith(prefix));
  return hit?.slice(prefix.length);
}

/** vi.fn() so tests can assert call counts/args (e.g. "exactly one dispatcher call"). */
const execWpCliMock = vi.fn(async (projectId: string, args: string[]) => {
  const site = siteFor(projectId);
  const [cmd, sub] = args;

  if (cmd === "post" && sub === "create") {
    const id = site.nextId++;
    const page: FakePage = {
      id,
      title: argValue(args, "--post_title=") ?? "",
      slug: argValue(args, "--post_name=") ?? "",
      status: argValue(args, "--post_status=") ?? "publish",
      content: "",
    };
    site.pages.set(id, page);
    return { stdout: String(id), stderr: "" };
  }

  if (cmd === "post" && sub === "update") {
    const id = Number(args[2]);
    const page = site.pages.get(id);
    if (page) {
      const title = argValue(args, "--post_title=");
      const content = argValue(args, "--post_content=");
      if (title !== undefined) page.title = title;
      if (content !== undefined) page.content = content;
    }
    return { stdout: "", stderr: "" };
  }

  if (cmd === "post" && sub === "delete") {
    site.pages.delete(Number(args[2]));
    return { stdout: "", stderr: "" };
  }

  if (cmd === "post" && sub === "list") {
    if (args.includes("--post_type=wpcf7_contact_form")) return { stdout: "", stderr: "" };
    const nameArg = argValue(args, "--name=");
    if (nameArg !== undefined) {
      const page = [...site.pages.values()].find((p) => p.slug === nameArg);
      return { stdout: page ? String(page.id) : "", stderr: "" };
    }
    if (args.includes("--format=json")) {
      const rows = [...site.pages.values()]
        .sort((a, b) => a.title.localeCompare(b.title))
        .map((p) => ({ ID: String(p.id), post_title: p.title, post_name: p.slug, post_status: p.status }));
      return { stdout: JSON.stringify(rows), stderr: "" };
    }
    return { stdout: "", stderr: "" };
  }

  if (cmd === "post" && sub === "get") {
    const id = Number(args[2]);
    const page = site.pages.get(id);
    if (!page) return { stdout: "", stderr: "" };
    return {
      stdout: JSON.stringify({
        ID: String(page.id),
        post_title: page.title,
        post_name: page.slug,
        post_status: page.status,
        post_content: page.content,
      }),
      stderr: "",
    };
  }

  if (cmd === "menu") {
    // "menu item list <name> --fields=... --format=csv": always report no
    // existing associations (header row only) -- callers add-post
    // idempotently regardless, and nothing in this test suite asserts on
    // real menu structure.
    if (args[1] === "item" && args[2] === "list") return { stdout: "object_id\n", stderr: "" };
    return { stdout: "", stderr: "" };
  }

  // core install/is-installed, option update, theme install/activate,
  // plugin install/activate/is-active, eval, db export/import -- all a
  // generic success with empty output.
  return { stdout: "", stderr: "" };
});

const composeCpMock = vi.fn(async (_projectId: string, source: string, dest: string) => {
  // Mirror checkpoint.test.ts's convention: copying OUT of the container (a
  // "wpcli:..." source, plain local dest) produces a real file on disk so
  // restoreCheckpoint's `existsSync()` gate is exercised for real; copying
  // IN (or a directory copy, e.g. the child-theme tool) is a no-op.
  if (source.startsWith("wpcli:") && !dest.startsWith("wpcli:")) {
    writeFileSync(dest, "-- fake sql dump --");
  }
  return { stdout: "", stderr: "" };
});

vi.mock("@agent/docker/compose.js", () => ({
  projectDir: vi.fn((projectId: string) => join(scratchRoot, "projects", projectId)),
  execWpCli: execWpCliMock,
  composeCp: composeCpMock,
  compose: vi.fn().mockResolvedValue({ stdout: "", stderr: "" }),
  readProjectSecret: vi.fn((_projectId: string, key: string) => {
    if (key === "WP_ADMIN_USER") return "admin";
    if (key === "WP_ADMIN_PASSWORD") return "fake-admin-password";
    if (key === "WP_ADMIN_EMAIL") return "admin@example.local";
    return null;
  }),
  createWordPressEnvironment: vi.fn(async (project: Project) => ({
    log: ["Rendered docker-compose.yml (fake)", "Containers started and healthy (fake)"],
    docker: {
      projectId: project.id,
      status: "running" as const,
      wpPort: 8100,
      containerPrefix: `aiwp-${project.id.slice(0, 8)}`,
      previewUrl: "http://localhost:8100",
      adminUrl: "http://localhost:8100/wp-admin",
      createdAt: new Date().toISOString(),
      lastError: null,
    },
  })),
  stopEnvironment: vi.fn().mockResolvedValue(undefined),
  startEnvironment: vi.fn().mockResolvedValue(undefined),
  restartEnvironment: vi.fn().mockResolvedValue(undefined),
  destroyEnvironment: vi.fn().mockResolvedValue(undefined),
}));

// ---------------------------------------------------------------------------
// tools/screenshot.js and engine/testRunner.js -- real Playwright/Chromium
// launches against project.docker.previewUrl, not routed through
// docker/compose.js at all. Mocked so the full build pipeline (which calls
// both during VISUAL_REVIEW/TESTING) never needs a real browser or a real
// site actually listening on that port.
// ---------------------------------------------------------------------------
vi.mock("@agent/tools/screenshot.js", () => ({
  captureScreenshot: vi.fn().mockResolvedValue({
    file: "/tmp/fake-screenshot.png",
    relativePath: "fake-screenshot.png",
    bytes: 50_000, // comfortably above critic.ts's BLANK_PAGE_BYTES_THRESHOLD
  }),
  screenshotDir: vi.fn((projectId: string) => join(scratchRoot, "projects", projectId, "screenshots")),
  readScreenshot: vi.fn(() => Buffer.from("fake-png-bytes")),
}));

vi.mock("@agent/engine/testRunner.js", () => ({
  runSmokeSuite: vi.fn().mockResolvedValue({
    passed: true,
    findings: [{ level: "info", message: "Homepage loads (200 OK) [faked for integration tests]" }],
  }),
}));

// ---------------------------------------------------------------------------
// middleware/rateLimit.js -- pass-through. The real limiters are meant to
// bound abuse from a single external caller; a single test file's
// full-lifecycle scenario legitimately makes more requests from the same
// loopback address than the real per-minute/per-15-minute budgets allow.
// Rate-limiting itself isn't part of this task's HTTP+state-machine scope.
// ---------------------------------------------------------------------------
vi.mock("@agent/middleware/rateLimit.js", () => ({
  projectCreateLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
  chatMessageLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

// vi.mock calls above are hoisted to the top of this module by Vitest, so
// this dynamic import (deliberately NOT a static one) runs after they're
// registered -- same pattern tests/unit/agent/tools/dispatcher.test.ts uses.
const { createApp } = await import("../../../apps/agent/src/app.js");

/** Fresh Express app per call -- cheap (no listen/store I/O), used per test file. */
export function buildApp(): Express {
  return createApp();
}

/** Wipes all in-memory fake state between tests -- call from beforeEach. */
export function resetWorld() {
  storeState.projects.clear();
  storeState.messages.clear();
  sites.clear();
  execWpCliMock.mockClear();
  composeCpMock.mockClear();
  if (scratchRoot) rmSync(scratchRoot, { recursive: true, force: true });
  scratchRoot = mkdtempSync(join(tmpdir(), "aiwp-integration-test-"));
}

export function cleanupWorld() {
  if (scratchRoot) rmSync(scratchRoot, { recursive: true, force: true });
}

export { execWpCliMock, composeCpMock };

/** Every route but /health requires this header -- see middleware/auth.ts. */
export function authHeader(): Record<string, string> {
  return { "X-Agent-Key": AGENT_KEY };
}

// ---------------------------------------------------------------------------
// Higher-level scenario helpers shared across projects/messages/themes/
// content.test.ts -- driving a project through the requirement-gathering
// conversation and the build pipeline via real HTTP calls, so every test
// file that needs a READY project (to test edits, undo, or the content tab)
// does it the same, real way instead of reaching into store internals.
// ---------------------------------------------------------------------------

export async function createProject(app: Express, name = "Test Site"): Promise<Project> {
  const res = await request(app).post("/projects").set(authHeader()).send({ name });
  if (res.status !== 201) throw new Error(`createProject failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body as Project;
}

export async function getProject(app: Express, id: string): Promise<Project> {
  const res = await request(app).get(`/projects/${id}`).set(authHeader());
  if (res.status !== 200) throw new Error(`getProject failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body as Project;
}

export async function sendMessage(app: Express, id: string, text: string) {
  const res = await request(app).post(`/projects/${id}/messages`).set(authHeader()).send({ text });
  return res;
}

/**
 * Answers the heuristic requirement-gathering conversation (engine/
 * requirements.ts's NEXT_QUESTIONS) with a fixed, deterministic script that
 * reaches THEME_SELECTION in exactly 4 turns without ever touching the
 * ecommerce-payment follow-up (conditional on an ecommerce site/feature,
 * which this script deliberately avoids to keep the path short):
 *
 *   1. one message packed with keywords that fill websiteType (via the
 *      direct-answer fallback -- "business" isn't itself a WEBSITE_TYPES
 *      keyword, so it lands via applyDirectAnswer matching the "Business"
 *      choice), audience, visualStyle, and colorPreference all at once
 *      (heuristicExtract scans the whole message for every slot's keyword
 *      table regardless of which single slot is "pending" that turn).
 *   2. "none of these" -> features: []
 *   3. "looks good" -> pages: [] (no extra pages beyond the type defaults)
 *   4. "skip" -> integrations: [] (ecommercePayment's `when` is false since
 *      websiteType isn't ecommerce and features doesn't include it, so it's
 *      never asked)
 */
export async function driveToThemeSelection(app: Express, id: string): Promise<Project> {
  await sendMessage(app, id, "We run a business website for our customers, minimal style, blue accent color.");
  await sendMessage(app, id, "None of these");
  await sendMessage(app, id, "Looks good");
  const res = await sendMessage(app, id, "skip");
  return res.body.project as Project;
}

export async function selectTheme(app: Express, id: string, slug = "twentytwentyfour") {
  const res = await request(app).post(`/projects/${id}/themes/select`).set(authHeader()).send({ slug });
  if (res.status !== 202) throw new Error(`selectTheme failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body as Project;
}

/** Polls GET /projects/:id until `status` is one of `targets`, or times out. */
export async function waitForStatus(
  app: Express,
  id: string,
  targets: string[],
  opts: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<Project> {
  const timeoutMs = opts.timeoutMs ?? 10_000;
  const intervalMs = opts.intervalMs ?? 20;
  const deadline = Date.now() + timeoutMs;
  let last: Project | undefined;
  while (Date.now() < deadline) {
    last = await getProject(app, id);
    if (targets.includes(last.status)) return last;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(
    `waitForStatus timed out after ${timeoutMs}ms waiting for one of [${targets.join(", ")}], last status was "${last?.status}"`,
  );
}

/** Full happy path: create -> requirements -> theme select -> READY. */
export async function buildProjectToReady(app: Express, name = "Test Site"): Promise<Project> {
  const project = await createProject(app, name);
  await driveToThemeSelection(app, project.id);
  await selectTheme(app, project.id);
  return waitForStatus(app, project.id, ["READY", "ERROR"]);
}
