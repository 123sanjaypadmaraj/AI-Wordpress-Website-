/**
 * TST-07: error classification + bounded auto-retry.
 *
 * Docker/WP-CLI calls fail for two very different reasons: a *transient*
 * one (an image still pulling, the DB not accepting connections yet, a
 * momentary daemon hiccup) that a retry usually clears, or a *fatal* one
 * (bad compose file, Docker not running at all, WP-CLI rejecting a
 * malformed argument) that will fail identically every time. Retrying the
 * second kind just burns the project's error budget and delays the real
 * failure message reaching the user.
 */

export type ErrorClass = "transient" | "fatal";

const TRANSIENT_PATTERNS = [
  /timed? ?out/i,
  /ETIMEDOUT/,
  /ECONNRESET/,
  /ECONNREFUSED/,
  /connection refused/i,
  /Error response from daemon: driver failed programming external connectivity/i,
  /health.*check.*(pending|starting)/i,
  /container .* is unhealthy/i,
  /database.*not.*ready/i,
  /Temporary failure in name resolution/i,
];

const FATAL_PATTERNS = [
  /cannot connect to the docker daemon/i,
  /docker: command not found/i,
  /no such file or directory.*docker-compose\.yml/i,
  /no free ports/i,
  /is not in the trusted (plugin|theme) allowlist/i,
  /requires confirmation/i,
  /unknown (theme|plugin) slug/i,
];

export function classifyError(err: unknown): ErrorClass {
  const message = err instanceof Error ? err.message : String(err);
  if (FATAL_PATTERNS.some((p) => p.test(message))) return "fatal";
  if (TRANSIENT_PATTERNS.some((p) => p.test(message))) return "transient";
  // Default to transient for unrecognized Docker/WP-CLI failures -- a
  // bounded retry is cheap, and most unclassified errors in this pipeline
  // come from timing (containers/networking), not bad input.
  return "transient";
}

export interface RetryOptions {
  retries?: number;
  baseDelayMs?: number;
  onRetry?: (attempt: number, err: unknown, cls: ErrorClass) => void;
}

export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const retries = opts.retries ?? 2;
  const baseDelayMs = opts.baseDelayMs ?? 1500;
  let attempt = 0;
  while (true) {
    try {
      return await fn();
    } catch (err) {
      const cls = classifyError(err);
      if (cls === "fatal" || attempt >= retries) throw err;
      attempt += 1;
      opts.onRetry?.(attempt, err, cls);
      await new Promise((resolve) => setTimeout(resolve, baseDelayMs * attempt));
    }
  }
}
