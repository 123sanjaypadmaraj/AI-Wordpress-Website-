import { emptySiteSpecification, type Project, type ProjectState } from "@ai-wp/shared";

// Shared test fixture for the big `Project` aggregate -- every field filled
// in with a sensible default so each test only needs to override what it's
// actually asserting on.
export function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: "proj-1",
    name: "Robotics Club Site",
    status: "READY" as ProjectState,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    slots: {
      websiteType: null,
      audience: null,
      pages: null,
      features: null,
      visualStyle: null,
      colorPreference: null,
      ecommercePayment: null,
      seo: null,
      accessibility: null,
      integrations: null,
      discoveredSkills: null,
    },
    spec: emptySiteSpecification("Robotics Club Site"),
    themeRecommendations: [],
    docker: {
      projectId: "proj-1",
      status: "none",
      wpPort: null,
      containerPrefix: "proj-1",
      previewUrl: null,
      adminUrl: null,
      createdAt: null,
      lastError: null,
    },
    log: [],
    auditLog: [],
    checkpoints: [],
    backups: [],
    ...overrides,
  };
}
