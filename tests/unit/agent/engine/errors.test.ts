import { describe, expect, it, vi } from "vitest";
import { classifyError, withRetry } from "@agent/engine/errors.js";

/**
 * Harness proof-of-life for apps/agent (session 01-test-harness): exercises
 * one pure, offline module from engine/ end to end -- classification logic
 * plus the retry loop built on top of it -- including `vi.useFakeTimers()`
 * for the retry backoff, which sessions 04/05 will also need for their own
 * retry-logic assertions (see docs/TESTING.md).
 *
 * This file mirrors apps/agent/src/engine/errors.ts, per the convention in
 * docs/TESTING.md. It intentionally does NOT touch engine/layout.ts,
 * dispatcher.ts, or any tools/ module -- those are owned by sessions 02-06.
 */
describe("classifyError", () => {
  it("classifies known Docker/WP-CLI transient failures as transient", () => {
    expect(classifyError(new Error("connect ECONNREFUSED 127.0.0.1:8100"))).toBe("transient");
    expect(classifyError(new Error("container wpcli is unhealthy"))).toBe("transient");
  });

  it("classifies known fatal failures as fatal", () => {
    expect(classifyError(new Error("Cannot connect to the Docker daemon at unix:///var/run/docker.sock"))).toBe(
      "fatal",
    );
    expect(classifyError(new Error("Theme 'evil-theme' is not in the trusted theme allowlist"))).toBe("fatal");
  });

  it("defaults unrecognized errors to transient (cheap to retry)", () => {
    expect(classifyError(new Error("something totally unexpected happened"))).toBe("transient");
  });

  it("handles non-Error throwables via String() coercion", () => {
    expect(classifyError("ETIMEDOUT")).toBe("transient");
  });
});

describe("withRetry", () => {
  it("returns the result immediately on first success, without retrying", async () => {
    const fn = vi.fn().mockResolvedValue("ok");
    await expect(withRetry(fn)).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries a transient failure up to the bound, then succeeds", async () => {
    vi.useFakeTimers();
    try {
      const fn = vi
        .fn()
        .mockRejectedValueOnce(new Error("ECONNRESET"))
        .mockRejectedValueOnce(new Error("ECONNRESET"))
        .mockResolvedValueOnce("recovered");

      const promise = withRetry(fn, { retries: 2, baseDelayMs: 10 });
      await vi.runAllTimersAsync();

      await expect(promise).resolves.toBe("recovered");
      expect(fn).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it("gives up after the retry bound and surfaces the final error", async () => {
    vi.useFakeTimers();
    try {
      const err = new Error("ECONNRESET");
      const fn = vi.fn().mockRejectedValue(err);
      const onRetry = vi.fn();

      const promise = withRetry(fn, { retries: 2, baseDelayMs: 10, onRetry });
      const assertion = expect(promise).rejects.toBe(err);
      await vi.runAllTimersAsync();
      await assertion;

      // 1 initial attempt + 2 retries = 3 calls, never more.
      expect(fn).toHaveBeenCalledTimes(3);
      expect(onRetry).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("never retries a fatal error, even with retries budget remaining", async () => {
    const err = new Error("docker: command not found");
    const fn = vi.fn().mockRejectedValue(err);

    await expect(withRetry(fn, { retries: 5 })).rejects.toBe(err);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
