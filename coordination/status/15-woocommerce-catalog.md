---
state: in-progress
owner: 15-woocommerce-catalog
started: 2026-09-07T00:00:00Z
summary: Generating a sample WooCommerce product catalog (products/categories + placeholder images) right after WooCommerce install/config in the build pipeline.
---

## Plan

- `apps/agent/src/engine/productCatalog.ts` (new): heuristic + AI-provider
  catalog generation (2-4 categories, 6-12 products total), same two-mode
  pattern as `engine/copywriter.ts`.
- `apps/agent/src/tools/woocommerce.ts` (new): WP-CLI wrappers
  (`wp wc product_cat create`, `wp wc product create`) matching
  `tools/wordpress.ts`'s `wp()` shelling-out convention, plus a
  dependency-free placeholder PNG generator (raw zlib deflate, no image lib)
  shipped into the wpcli container via `composeCp` and attached with
  `wp media import ... --featured_image`.
- New `ToolName` `generate_product_catalog` (packages/shared), permission
  `write`, dispatched through `tools/dispatcher.ts` exactly like
  `install_plugin` -- one audited call does the whole multi-step WP-CLI
  sequence (categories, products, images), not a side channel.
- `engine/orchestrator.ts`: minimal wiring -- right after the WooCommerce
  plugin install/config loop (still before `GENERATING`), generate the
  catalog and dispatch it through `callTool`. This is the only touched file
  outside this task's owned files.
- Tests: `tests/unit/agent/tools/woocommerce.test.ts` (WP-CLI command shape,
  mocking `@agent/docker/compose.js`, following `wordpress.test.ts`/
  `childtheme.test.ts` conventions) and
  `tests/unit/agent/engine/productCatalog.test.ts` (heuristic vs AI-provider
  path, mocking `llm/client.js`, following `copywriter.test.ts`).

## Decisions

(filled in as work proceeds)
