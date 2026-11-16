/// <reference types="vite/client" />

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api } from "./_generated/api.js";
import { initConvexTest } from "./setup.test.js";

describe("debouncer component", () => {
  beforeEach(async () => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("schedule", () => {
    test("creates a new debounced call with sliding mode", async () => {
      const t = initConvexTest();

      const result = await t.mutation(api.lib.schedule, {
        namespace: "test",
        key: "key1",
        mode: "sliding",
        delay: 1000,
        functionPath: "internal.test.compute",
        functionHandle: "function://;internal.test.compute",
        functionArgs: { id: "123" },
      });

      expect(result.executed).toBe(false);
      expect(result.scheduledFor).toBeGreaterThan(Date.now());

      // Verify status
      const status = await t.query(api.lib.status, {
        namespace: "test",
        key: "key1",
      });
      expect(status).not.toBeNull();
      expect(status?.pending).toBe(true);
      expect(status?.retriggerCount).toBe(1);
      expect(status?.mode).toBe("sliding");
    });

    test("creates a new debounced call with fixed mode", async () => {
      const t = initConvexTest();

      const result = await t.mutation(api.lib.schedule, {
        namespace: "test",
        key: "key1",
        mode: "fixed",
        delay: 1000,
        functionPath: "internal.test.compute",
        functionHandle: "function://;internal.test.compute",
        functionArgs: { id: "123" },
      });

      expect(result.executed).toBe(false);
      expect(result.scheduledFor).toBeGreaterThan(Date.now());
    });

    test("creates a new debounced call with eager mode", async () => {
      const t = initConvexTest();

      const result = await t.mutation(api.lib.schedule, {
        namespace: "test",
        key: "key1",
        mode: "eager",
        delay: 1000,
        functionPath: "internal.test.compute",
        functionHandle: "function://;internal.test.compute",
        functionArgs: { id: "123" },
      });

      // Eager mode signals immediate execution
      expect(result.executed).toBe(true);
      expect(result.scheduledFor).toBeGreaterThan(Date.now());

      // Status should show no trailing call yet
      const status = await t.query(api.lib.status, {
        namespace: "test",
        key: "key1",
      });
      expect(status?.hasTrailingCall).toBe(false);
    });
  });

  describe("sliding mode behavior", () => {
    test("resets timer on subsequent calls", async () => {
      const t = initConvexTest();

      // First call
      const result1 = await t.mutation(api.lib.schedule, {
        namespace: "test",
        key: "key1",
        mode: "sliding",
        delay: 1000,
        functionPath: "internal.test.compute",
        functionHandle: "function://;internal.test.compute",
        functionArgs: { value: 1 },
      });

      const firstScheduledFor = result1.scheduledFor;

      // Advance time by 500ms
      vi.advanceTimersByTime(500);

      // Second call should reset the timer
      const result2 = await t.mutation(api.lib.schedule, {
        namespace: "test",
        key: "key1",
        mode: "sliding",
        delay: 1000,
        functionPath: "internal.test.compute",
        functionHandle: "function://;internal.test.compute",
        functionArgs: { value: 2 },
      });

      // New scheduled time should be later than original
      expect(result2.scheduledFor).toBeGreaterThan(firstScheduledFor);

      // Check retrigger count
      const status = await t.query(api.lib.status, {
        namespace: "test",
        key: "key1",
      });
      expect(status?.retriggerCount).toBe(2);
    });
  });

  describe("fixed mode behavior", () => {
    test("keeps timer fixed on subsequent calls", async () => {
      const t = initConvexTest();

      // First call
      const result1 = await t.mutation(api.lib.schedule, {
        namespace: "test",
        key: "key1",
        mode: "fixed",
        delay: 1000,
        functionPath: "internal.test.compute",
        functionHandle: "function://;internal.test.compute",
        functionArgs: { value: 1 },
      });

      const firstScheduledFor = result1.scheduledFor;

      // Advance time by 500ms
      vi.advanceTimersByTime(500);

      // Second call should keep the same timer
      const result2 = await t.mutation(api.lib.schedule, {
        namespace: "test",
        key: "key1",
        mode: "fixed",
        delay: 1000,
        functionPath: "internal.test.compute",
        functionHandle: "function://;internal.test.compute",
        functionArgs: { value: 2 },
      });

      // Scheduled time should remain the same
      expect(result2.scheduledFor).toBe(firstScheduledFor);

      // Check retrigger count
      const status = await t.query(api.lib.status, {
        namespace: "test",
        key: "key1",
      });
      expect(status?.retriggerCount).toBe(2);
    });
  });

  describe("eager mode behavior", () => {
    test("first call signals immediate execution, subsequent calls queue trailing", async () => {
      const t = initConvexTest();

      // First call - should execute immediately
      const result1 = await t.mutation(api.lib.schedule, {
        namespace: "test",
        key: "key1",
        mode: "eager",
        delay: 1000,
        functionPath: "internal.test.compute",
        functionHandle: "function://;internal.test.compute",
        functionArgs: { value: 1 },
      });

      expect(result1.executed).toBe(true);

      // Second call within timer - should queue trailing
      const result2 = await t.mutation(api.lib.schedule, {
        namespace: "test",
        key: "key1",
        mode: "eager",
        delay: 1000,
        functionPath: "internal.test.compute",
        functionHandle: "function://;internal.test.compute",
        functionArgs: { value: 2 },
      });

      expect(result2.executed).toBe(false);

      // Check trailing call is queued
      const status = await t.query(api.lib.status, {
        namespace: "test",
        key: "key1",
      });
      expect(status?.hasTrailingCall).toBe(true);
      expect(status?.retriggerCount).toBe(2);
    });

    test("third call updates args for trailing execution", async () => {
      const t = initConvexTest();

      // First call
      await t.mutation(api.lib.schedule, {
        namespace: "test",
        key: "key1",
        mode: "eager",
        delay: 1000,
        functionPath: "internal.test.compute",
        functionHandle: "function://;internal.test.compute",
        functionArgs: { value: 1 },
      });

      // Second call
      await t.mutation(api.lib.schedule, {
        namespace: "test",
        key: "key1",
        mode: "eager",
        delay: 1000,
        functionPath: "internal.test.compute",
        functionHandle: "function://;internal.test.compute",
        functionArgs: { value: 2 },
      });

      // Third call with different args
      await t.mutation(api.lib.schedule, {
        namespace: "test",
        key: "key1",
        mode: "eager",
        delay: 1000,
        functionPath: "internal.test.compute",
        functionHandle: "function://;internal.test.compute",
        functionArgs: { value: 3 },
      });

      // Verify latest args are stored
      const row = await t.run((ctx) => ctx.db.query("debouncedCalls").first());
      expect(row?.functionArgs).toEqual({ value: 3 });

      const status = await t.query(api.lib.status, {
        namespace: "test",
        key: "key1",
      });
      expect(status?.retriggerCount).toBe(3);
    });
  });

  describe("status", () => {
    test("returns null for non-existent call", async () => {
      const t = initConvexTest();

      const status = await t.query(api.lib.status, {
        namespace: "test",
        key: "nonexistent",
      });

      expect(status).toBeNull();
    });

    test("returns correct status for pending call", async () => {
      const t = initConvexTest();

      await t.mutation(api.lib.schedule, {
        namespace: "test",
        key: "key1",
        mode: "sliding",
        delay: 1000,
        functionPath: "internal.test.compute",
        functionHandle: "function://;internal.test.compute",
        functionArgs: { id: "123" },
      });

      const status = await t.query(api.lib.status, {
        namespace: "test",
        key: "key1",
      });

      expect(status).not.toBeNull();
      expect(status?.pending).toBe(true);
      expect(status?.retriggerCount).toBe(1);
      expect(status?.mode).toBe("sliding");
    });
  });

  describe("cancel", () => {
    test("cancels a pending call", async () => {
      const t = initConvexTest();

      await t.mutation(api.lib.schedule, {
        namespace: "test",
        key: "key1",
        mode: "sliding",
        delay: 1000,
        functionPath: "internal.test.compute",
        functionHandle: "function://;internal.test.compute",
        functionArgs: { id: "123" },
      });

      const cancelled = await t.mutation(api.lib.cancel, {
        namespace: "test",
        key: "key1",
      });

      expect(cancelled).toBe(true);

      // Verify it's gone
      const status = await t.query(api.lib.status, {
        namespace: "test",
        key: "key1",
      });
      expect(status).toBeNull();
    });

    test("returns false for non-existent call", async () => {
      const t = initConvexTest();

      const cancelled = await t.mutation(api.lib.cancel, {
        namespace: "test",
        key: "nonexistent",
      });

      expect(cancelled).toBe(false);
    });
  });

  describe("execute", () => {
    test("cleans up after execution for fixed/sliding modes", async () => {
      const t = initConvexTest();

      await t.mutation(api.lib.schedule, {
        namespace: "test",
        key: "key1",
        mode: "fixed",
        delay: 100,
        functionPath: "internal.test.compute",
        functionHandle: "function://;internal.test.compute",
        functionArgs: { id: "123" },
      });

      // Advance time past the delay and run scheduled functions
      vi.advanceTimersByTime(200);
      await t.finishAllScheduledFunctions(vi.runAllTimers);

      // Status should be null after execution
      const status = await t.query(api.lib.status, {
        namespace: "test",
        key: "key1",
      });
      expect(status).toBeNull();
    });

    test("eager mode without trailing call does not execute", async () => {
      const t = initConvexTest();

      await t.mutation(api.lib.schedule, {
        namespace: "test",
        key: "key1",
        mode: "eager",
        delay: 100,
        functionPath: "internal.test.compute",
        functionHandle: "function://;internal.test.compute",
        functionArgs: { id: "123" },
      });

      // No subsequent calls, so hasTrailingCall is false

      // Advance time past the delay and run scheduled functions
      vi.advanceTimersByTime(200);
      await t.finishAllScheduledFunctions(vi.runAllTimers);

      // Should be cleaned up
      const status = await t.query(api.lib.status, {
        namespace: "test",
        key: "key1",
      });
      expect(status).toBeNull();
    });

    // The target's args are checked end to end in example/convex/example.test.ts.
    test("eager mode cleans up after the trailing run and its cooldown", async () => {
      const t = initConvexTest();

      // First call
      await t.mutation(api.lib.schedule, {
        namespace: "test",
        key: "key1",
        mode: "eager",
        delay: 100,
        functionPath: "internal.test.compute",
        functionHandle: "function://;internal.test.compute",
        functionArgs: { value: 1 },
      });

      // Second call - queues trailing
      await t.mutation(api.lib.schedule, {
        namespace: "test",
        key: "key1",
        mode: "eager",
        delay: 100,
        functionPath: "internal.test.compute",
        functionHandle: "function://;internal.test.compute",
        functionArgs: { value: 2 },
      });

      // Verify trailing call is pending
      const statusBefore = await t.query(api.lib.status, {
        namespace: "test",
        key: "key1",
      });
      expect(statusBefore?.hasTrailingCall).toBe(true);

      // Advance time past the delay and run scheduled functions
      vi.advanceTimersByTime(200);
      await t.finishAllScheduledFunctions(vi.runAllTimers);

      // Trailing run, then a new cooldown with nothing queued, then cleanup.
      const statusAfter = await t.query(api.lib.status, {
        namespace: "test",
        key: "key1",
      });
      expect(statusAfter).toBeNull();
    });
  });

  describe("namespacing", () => {
    test("different namespaces are independent", async () => {
      const t = initConvexTest();

      await t.mutation(api.lib.schedule, {
        namespace: "metrics",
        key: "key1",
        mode: "sliding",
        delay: 1000,
        functionPath: "internal.metrics.compute",
        functionHandle: "function://;internal.metrics.compute",
        functionArgs: { id: "123" },
      });

      await t.mutation(api.lib.schedule, {
        namespace: "notifications",
        key: "key1",
        mode: "fixed",
        delay: 2000,
        functionPath: "internal.notifications.send",
        functionHandle: "function://;internal.notifications.send",
        functionArgs: { userId: "456" },
      });

      const metricsStatus = await t.query(api.lib.status, {
        namespace: "metrics",
        key: "key1",
      });
      const notificationsStatus = await t.query(api.lib.status, {
        namespace: "notifications",
        key: "key1",
      });

      expect(metricsStatus?.mode).toBe("sliding");
      expect(notificationsStatus?.mode).toBe("fixed");
    });

    test("different keys in same namespace are independent", async () => {
      const t = initConvexTest();

      await t.mutation(api.lib.schedule, {
        namespace: "metrics",
        key: "property-1",
        mode: "sliding",
        delay: 1000,
        functionPath: "internal.metrics.compute",
        functionHandle: "function://;internal.metrics.compute",
        functionArgs: { propertyId: "1" },
      });

      await t.mutation(api.lib.schedule, {
        namespace: "metrics",
        key: "property-2",
        mode: "sliding",
        delay: 1000,
        functionPath: "internal.metrics.compute",
        functionHandle: "function://;internal.metrics.compute",
        functionArgs: { propertyId: "2" },
      });

      const status1 = await t.query(api.lib.status, {
        namespace: "metrics",
        key: "property-1",
      });
      const status2 = await t.query(api.lib.status, {
        namespace: "metrics",
        key: "property-2",
      });

      expect(status1).not.toBeNull();
      expect(status2).not.toBeNull();

      // Cancel one, other should remain
      await t.mutation(api.lib.cancel, {
        namespace: "metrics",
        key: "property-1",
      });

      const status1After = await t.query(api.lib.status, {
        namespace: "metrics",
        key: "property-1",
      });
      const status2After = await t.query(api.lib.status, {
        namespace: "metrics",
        key: "property-2",
      });

      expect(status1After).toBeNull();
      expect(status2After).not.toBeNull();
    });
  });

  describe("recovery and validation", () => {
    const call = (functionArgs: Record<string, unknown>) => ({
      namespace: "test",
      key: "key1",
      mode: "fixed" as const,
      delay: 1000,
      functionPath: "internal.test.compute",
      functionHandle: "function://;internal.test.compute",
      functionArgs,
    });

    test("eager key in cooldown with nothing queued is not pending", async () => {
      const t = initConvexTest();
      await t.mutation(api.lib.schedule, { ...call({}), mode: "eager" });

      const status = await t.query(api.lib.status, {
        namespace: "test",
        key: "key1",
      });
      expect(status).toMatchObject({ pending: false, hasTrailingCall: false });
    });

    test("a key whose timer died is scheduled afresh", async () => {
      const t = initConvexTest();
      const first = await t.mutation(api.lib.schedule, call({ value: 1 }));

      // Simulate a failed or externally canceled `execute`.
      await t.run(async (ctx) => {
        const row = await ctx.db.query("debouncedCalls").first();
        await ctx.scheduler.cancel(row!.scheduledFunctionId!);
      });

      vi.advanceTimersByTime(500);
      const second = await t.mutation(api.lib.schedule, call({ value: 2 }));
      expect(second.scheduledFor).toBe(first.scheduledFor + 500);

      const status = await t.query(api.lib.status, {
        namespace: "test",
        key: "key1",
      });
      expect(status?.retriggerCount).toBe(1);
    });
  });
});
