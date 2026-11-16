import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { initConvexTest } from "./setup.test";
import { api, internal } from "./_generated/api";

describe("debouncer e2e", () => {
  beforeEach(async () => {
    vi.useFakeTimers();
  });

  afterEach(async () => {
    vi.useRealTimers();
  });

  // Helper to get execution log
  async function getLogs(t: ReturnType<typeof initConvexTest>) {
    return await t.query(api.example.getExecutionLog, {});
  }

  // Helper to get debounce status
  async function getStatus(
    t: ReturnType<typeof initConvexTest>,
    namespace: string,
    key: string,
  ) {
    return await t.query(api.example.getDebounceStatus, { namespace, key });
  }

  // Helper to flush all scheduled functions
  async function flush(t: ReturnType<typeof initConvexTest>) {
    await t.finishAllScheduledFunctions(vi.runAllTimers);
  }

  // Advance the clock, then run everything that is due without firing
  // later timers. Targets are scheduled at 0ms from `execute`, so they need
  // an extra tick.
  async function advance(t: ReturnType<typeof initConvexTest>, ms: number) {
    vi.advanceTimersByTime(ms);
    for (let i = 0; i < 3; i++) {
      await t.finishInProgressScheduledFunctions();
      vi.advanceTimersByTime(0);
    }
  }

  // ==========================================================================
  // Sliding mode (delay: 5000ms)
  // ==========================================================================
  describe("sliding mode", () => {
    test("executes target function after delay", async () => {
      const t = initConvexTest();

      await t.mutation(api.example.e2eTriggerSliding, {
        key: "k1",
        value: "v1",
      });

      // Not yet executed
      expect(await getLogs(t)).toHaveLength(0);

      // Flush scheduled functions
      vi.advanceTimersByTime(6000);
      await flush(t);

      // Target function should have been called
      const logs = await getLogs(t);
      expect(logs).toHaveLength(1);
      expect(logs[0].args).toEqual({ key: "k1", value: "v1" });

      // Debounce record cleaned up
      expect(await getStatus(t, "e2e-sliding", "k1")).toBeNull();
    });

    test("multiple calls reset timer, only latest args are used", async () => {
      const t = initConvexTest();

      await t.mutation(api.example.e2eTriggerSliding, {
        key: "k1",
        value: "first",
      });

      vi.advanceTimersByTime(3000); // 3s into 5s delay

      await t.mutation(api.example.e2eTriggerSliding, {
        key: "k1",
        value: "second",
      });

      // 6s after the first call: the original 5s timer would have fired.
      await advance(t, 3000);
      expect(await getLogs(t)).toHaveLength(0);

      // 5s after the second call.
      await advance(t, 2100);

      const logs = await getLogs(t);
      expect(logs).toHaveLength(1);
      expect(logs[0].args).toEqual({ key: "k1", value: "second" });
    });

    test("different keys debounce independently", async () => {
      const t = initConvexTest();

      await t.mutation(api.example.e2eTriggerSliding, {
        key: "a",
        value: "val-a",
      });
      await t.mutation(api.example.e2eTriggerSliding, {
        key: "b",
        value: "val-b",
      });

      vi.advanceTimersByTime(6000);
      await flush(t);

      const logs = await getLogs(t);
      expect(logs).toHaveLength(2);

      const keys = logs.map((l) => l.args.key).sort();
      expect(keys).toEqual(["a", "b"]);
    });

    test("does not execute before delay elapses", async () => {
      const t = initConvexTest();

      await t.mutation(api.example.e2eTriggerSliding, {
        key: "k1",
        value: "v1",
      });

      vi.advanceTimersByTime(2000); // Only 2s of 5s delay

      // Should still be pending
      const status = await getStatus(t, "e2e-sliding", "k1");
      expect(status?.pending).toBe(true);
      expect(await getLogs(t)).toHaveLength(0);
    });
  });

  // ==========================================================================
  // Fixed mode (delay: 3000ms)
  // ==========================================================================
  describe("fixed mode", () => {
    test("executes target function after delay", async () => {
      const t = initConvexTest();

      await t.mutation(api.example.e2eTriggerFixed, {
        key: "k1",
        value: "v1",
      });

      expect(await getLogs(t)).toHaveLength(0);

      vi.advanceTimersByTime(4000);
      await flush(t);

      const logs = await getLogs(t);
      expect(logs).toHaveLength(1);
      expect(logs[0].args).toEqual({ key: "k1", value: "v1" });

      expect(await getStatus(t, "e2e-fixed", "k1")).toBeNull();
    });

    test("multiple calls keep original timer but use latest args", async () => {
      const t = initConvexTest();

      const result1 = await t.mutation(api.example.e2eTriggerFixed, {
        key: "k1",
        value: "first",
      });

      vi.advanceTimersByTime(1000);

      const result2 = await t.mutation(api.example.e2eTriggerFixed, {
        key: "k1",
        value: "second",
      });

      // Timer should NOT have been reset
      expect(result2.scheduledFor).toBe(result1.scheduledFor);

      vi.advanceTimersByTime(3000);
      await flush(t);

      // Should use latest args
      const logs = await getLogs(t);
      expect(logs).toHaveLength(1);
      expect(logs[0].args).toEqual({ key: "k1", value: "second" });
    });
  });

  // ==========================================================================
  // Eager mode (delay: 10000ms)
  // ==========================================================================
  describe("eager mode", () => {
    test("first call executes immediately", async () => {
      const t = initConvexTest();

      const result = await t.mutation(api.example.e2eTriggerEager, {
        key: "k1",
        value: "immediate",
      });

      expect(result.executed).toBe(true);

      // Eager execution is via scheduler.runAfter(0, ...), flush to execute
      vi.advanceTimersByTime(0);
      await flush(t);

      const logs = await getLogs(t);
      expect(logs).toHaveLength(1);
      expect(logs[0].args).toEqual({ key: "k1", value: "immediate" });
    });

    test("no trailing call if no subsequent calls come in", async () => {
      const t = initConvexTest();

      await t.mutation(api.example.e2eTriggerEager, {
        key: "k1",
        value: "only-call",
      });

      // Wait for cooldown to expire
      vi.advanceTimersByTime(11000);
      await flush(t);

      // Should only have the immediate execution, no trailing
      const logs = await getLogs(t);
      expect(logs).toHaveLength(1);
      expect(logs[0].args).toEqual({ key: "k1", value: "only-call" });

      // Record should be cleaned up
      expect(await getStatus(t, "e2e-eager", "k1")).toBeNull();
    });

    test("trailing call executes after delay with latest args", async () => {
      const t = initConvexTest();

      // First call - immediate
      await t.mutation(api.example.e2eTriggerEager, {
        key: "k1",
        value: "first",
      });

      // Flush only the immediate execution (0-delay), not the trailing timer
      vi.advanceTimersByTime(0);
      await t.finishInProgressScheduledFunctions();

      // Second call within cooldown - queued as trailing
      await t.mutation(api.example.e2eTriggerEager, {
        key: "k1",
        value: "second",
      });

      // Third call - updates trailing args
      await t.mutation(api.example.e2eTriggerEager, {
        key: "k1",
        value: "third",
      });

      // Should have 1 execution so far (the immediate one)
      expect(await getLogs(t)).toHaveLength(1);

      // Wait for trailing call
      vi.advanceTimersByTime(11000);
      await flush(t);

      // Should now have 2 executions: immediate + trailing
      const logs = await getLogs(t);
      expect(logs).toHaveLength(2);
      expect(logs[0].args).toEqual({ key: "k1", value: "first" }); // immediate
      expect(logs[1].args).toEqual({ key: "k1", value: "third" }); // trailing with latest args
    });
  });

  // ==========================================================================
  // Cancellation
  // ==========================================================================
  describe("cancellation", () => {
    test("cancelled call does not execute", async () => {
      const t = initConvexTest();

      await t.mutation(api.example.e2eTriggerSliding, {
        key: "k1",
        value: "should-not-run",
      });

      // Cancel before delay
      const cancelled = await t.mutation(api.example.cancelDebounce, {
        namespace: "e2e-sliding",
        key: "k1",
      });
      expect(cancelled).toBe(true);

      // Advance past delay and flush
      vi.advanceTimersByTime(6000);
      await flush(t);

      // Should NOT have executed
      expect(await getLogs(t)).toHaveLength(0);
      expect(await getStatus(t, "e2e-sliding", "k1")).toBeNull();
    });

    test("cancelling non-existent key returns false", async () => {
      const t = initConvexTest();

      const cancelled = await t.mutation(api.example.cancelDebounce, {
        namespace: "e2e-sliding",
        key: "nonexistent",
      });
      expect(cancelled).toBe(false);
    });
  });

  // ==========================================================================
  // Re-scheduling after completion
  // ==========================================================================
  describe("re-scheduling", () => {
    test("can schedule again after previous execution completes", async () => {
      const t = initConvexTest();

      // First round
      await t.mutation(api.example.e2eTriggerSliding, {
        key: "k1",
        value: "round-1",
      });
      vi.advanceTimersByTime(6000);
      await flush(t);

      // Second round
      await t.mutation(api.example.e2eTriggerSliding, {
        key: "k1",
        value: "round-2",
      });
      vi.advanceTimersByTime(6000);
      await flush(t);

      const logs = await getLogs(t);
      expect(logs).toHaveLength(2);
      expect(logs[0].args.value).toBe("round-1");
      expect(logs[1].args.value).toBe("round-2");
    });
  });

  // ==========================================================================
  // Action support
  // ==========================================================================
  describe("action support", () => {
    test("sliding mode - action target executes after delay", async () => {
      const t = initConvexTest();

      await t.mutation(api.example.e2eTriggerSlidingAction, {
        key: "k1",
        value: "action-v1",
      });

      expect(await getLogs(t)).toHaveLength(0);

      vi.advanceTimersByTime(6000);
      await flush(t);

      const logs = await getLogs(t);
      expect(logs).toHaveLength(1);
      expect(logs[0].functionName).toBe("e2eActionTarget");
      expect(logs[0].args).toEqual({ key: "k1", value: "action-v1" });

      expect(await getStatus(t, "e2e-sliding-action", "k1")).toBeNull();
    });

    test("eager mode - action target executes immediately via scheduler", async () => {
      const t = initConvexTest();

      const result = await t.mutation(api.example.e2eTriggerEagerAction, {
        key: "k1",
        value: "eager-action",
      });

      expect(result.executed).toBe(true);

      // Eager execution is via scheduler.runAfter(0, ...), so need to flush
      vi.advanceTimersByTime(0);
      await flush(t);

      const logs = await getLogs(t);
      expect(logs).toHaveLength(1);
      expect(logs[0].functionName).toBe("e2eActionTarget");
      expect(logs[0].args).toEqual({ key: "k1", value: "eager-action" });
    });

    test("eager mode - action trailing call executes with latest args", async () => {
      const t = initConvexTest();

      // First call - immediate
      await t.mutation(api.example.e2eTriggerEagerAction, {
        key: "k1",
        value: "first",
      });

      // Run only the leading call; the cooldown timer stays pending.
      vi.advanceTimersByTime(0);
      await t.finishInProgressScheduledFunctions();
      expect((await getStatus(t, "e2e-eager-action", "k1"))?.pending).toBe(
        false,
      );

      // Second call - trailing
      const second = await t.mutation(api.example.e2eTriggerEagerAction, {
        key: "k1",
        value: "second",
      });

      expect(second.executed).toBe(false);
      expect(await getLogs(t)).toHaveLength(1);

      // Flush trailing call
      vi.advanceTimersByTime(11000);
      await flush(t);

      const logs = await getLogs(t);
      expect(logs).toHaveLength(2);
      expect(logs[0].args.value).toBe("first");
      expect(logs[1].args.value).toBe("second");
    });
  });

  // ==========================================================================
  // Edge cases
  // ==========================================================================
  describe("edge cases", () => {
    const base = { namespace: "edge", key: "k1" } as const;

    test("eager cooldown restarts after a trailing run", async () => {
      const t = initConvexTest();
      const call = (value: string) =>
        t.mutation(api.example.e2eTrigger, {
          ...base,
          value,
          target: "mutation",
          mode: "eager",
          delay: 10000,
        });

      expect((await call("leading")).executed).toBe(true);
      await advance(t, 0);

      await advance(t, 9900);
      await call("trailing");

      // Trailing run fires at 10s and starts a new cooldown.
      await advance(t, 100);
      expect((await getLogs(t)).map((l) => l.args.value)).toEqual([
        "leading",
        "trailing",
      ]);

      // A call right after the trailing run must not fire immediately.
      await advance(t, 100);
      expect((await call("next")).executed).toBe(false);
      await advance(t, 0);
      expect(await getLogs(t)).toHaveLength(2);

      await advance(t, 10000);
      expect((await getLogs(t)).map((l) => l.args.value)).toEqual([
        "leading",
        "trailing",
        "next",
      ]);
    });

    test("a different mode on retrigger does not drop the call", async () => {
      const t = initConvexTest();
      await t.mutation(api.example.e2eTrigger, {
        ...base,
        value: "leading",
        target: "mutation",
        mode: "eager",
        delay: 10000,
      });
      await t.finishInProgressScheduledFunctions();

      // Same key, sliding override. The eager row governs until it fires.
      await t.mutation(api.example.e2eTrigger, {
        ...base,
        value: "latest",
        target: "mutation",
        mode: "sliding",
        delay: 10000,
      });
      await flush(t);

      expect((await getLogs(t)).map((l) => l.args.value)).toEqual([
        "leading",
        "latest",
      ]);
    });

    test("retrigger with a different target runs the latest target", async () => {
      const t = initConvexTest();
      await t.mutation(api.example.e2eTrigger, {
        ...base,
        value: "first",
        target: "mutation",
      });
      await t.mutation(api.example.e2eTrigger, {
        ...base,
        value: "second",
        target: "action",
      });
      await flush(t);

      const logs = await getLogs(t);
      expect(logs).toHaveLength(1);
      expect(logs[0]).toMatchObject({
        functionName: "e2eActionTarget",
        args: { key: "k1", value: "second" },
      });
    });

    test("schedules from an action ctx", async () => {
      const t = initConvexTest();
      const status = await t.action(internal.example.e2eTriggerFromAction, {
        key: "k1",
        value: "from-action",
      });
      expect(status).toMatchObject({ pending: true, mode: "sliding" });

      await flush(t);
      expect((await getLogs(t)).map((l) => l.args.value)).toEqual([
        "from-action",
      ]);
    });

    test("rejects an invalid delay", async () => {
      const t = initConvexTest();
      for (const delay of [-1, Number.POSITIVE_INFINITY]) {
        await expect(
          t.mutation(api.example.e2eTrigger, {
            ...base,
            value: "v",
            target: "mutation",
            delay,
          }),
        ).rejects.toThrow(/non-negative finite number/);
      }
    });
  });
});
