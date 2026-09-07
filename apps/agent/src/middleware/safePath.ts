import { resolve, sep } from "node:path";

/**
 * Resolves `baseDir` + `userSegment` and returns the absolute path ONLY if
 * it stays inside `baseDir` -- returns null otherwise.
 *
 * Express decodes each route param independently (a literal `%2e%2e%2f` or
 * `..` in `:file`/`:id` survives routing and lands in `req.params` as-is,
 * `%2f` included after decoding), so any handler that does
 * `join(someBaseDir, req.params.whatever)` before touching node:fs is a
 * path-traversal read (or write) waiting for a crafted request. Use this
 * instead of a bare `join()` anywhere a request-controlled path segment
 * reaches the filesystem.
 */
export function resolveSafe(baseDir: string, userSegment: string): string | null {
  const base = resolve(baseDir);
  const target = resolve(base, userSegment);
  if (target !== base && !target.startsWith(base + sep)) return null;
  return target;
}
