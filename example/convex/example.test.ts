import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { initConvexTest } from "./setup.test";
import { api } from "./_generated/api";

describe("debouncer example", () => {
  beforeEach(async () => {
    vi.useFakeTimers();
  });

  afterEach(async () => {
    vi.useRealTimers();
  });

  describe("property metrics (sliding mode)", () => {
    test("schedules metrics computation on property update", async () => {
      const t = initConvexTest();

      const result = await t.mutation(api.example.onPropertyUpdate, {
        propertyId: "prop-123",
        newData: { price: 500000 },
      });

      expect(result.executed).toBe(false);
      expect(result.scheduledFor).toBeGreaterThan(Date.now());

      // Check status
      const status = await t.query(api.example.getDebounceStatus, {
        namespace: "property-metrics",
        key: "prop-123",
      });
      expect(status?.pending).toBe(true);
      expect(status?.mode).toBe("sliding");
    });

    test("multiple updates reset the timer (sliding behavior)", async () => {
      const t = initConvexTest();

      const result1 = await t.mutation(api.example.onPropertyUpdate, {
        propertyId: "prop-123",
        newData: { price: 500000 },
      });

      vi.advanceTimersByTime(2000);

      const result2 = await t.mutation(api.example.onPropertyUpdate, {
        propertyId: "prop-123",
        newData: { price: 510000 },
      });

      // Second call should have later scheduled time (sliding mode)
      expect(result2.scheduledFor).toBeGreaterThan(result1.scheduledFor);

      const status = await t.query(api.example.getDebounceStatus, {
        namespace: "property-metrics",
        key: "prop-123",
      });
      expect(status?.retriggerCount).toBe(2);
    });
  });

  describe("AI responses (eager mode)", () => {
    test("first message triggers immediate execution", async () => {
      const t = initConvexTest();

      const result = await t.mutation(api.example.onUserMessage, {
        conversationId: "conv-456",
        message: "Hello!",
      });

      // Eager mode: first call executes immediately
      expect(result.executed).toBe(true);
    });

    test("subsequent messages queue trailing execution", async () => {
      const t = initConvexTest();

      // First message
      await t.mutation(api.example.onUserMessage, {
        conversationId: "conv-456",
        message: "Hello!",
      });

      // Second message within delay
      const result2 = await t.mutation(api.example.onUserMessage, {
        conversationId: "conv-456",
        message: "How are you?",
      });

      // Second call doesn't execute immediately
      expect(result2.executed).toBe(false);

      const status = await t.query(api.example.getDebounceStatus, {
        namespace: "ai-responses",
        key: "conv-456",
      });
      expect(status?.hasTrailingCall).toBe(true);
      expect(status?.mode).toBe("eager");
    });
  });

  describe("batch processing (fixed mode)", () => {
    test("first item sets timer, subsequent items don't change it", async () => {
      const t = initConvexTest();

      const result1 = await t.mutation(api.example.queueForBatchProcessing, {
        batchId: "batch-789",
        itemId: "item-1",
      });

      vi.advanceTimersByTime(1000);

      const result2 = await t.mutation(api.example.queueForBatchProcessing, {
        batchId: "batch-789",
        itemId: "item-2",
      });

      // Fixed mode: scheduled time should remain the same
      expect(result2.scheduledFor).toBe(result1.scheduledFor);

      const status = await t.query(api.example.getDebounceStatus, {
        namespace: "batch-processing",
        key: "batch-789",
      });
      expect(status?.mode).toBe("fixed");
      expect(status?.retriggerCount).toBe(2);
    });
  });

  describe("cancellation", () => {
    test("can cancel a pending debounce", async () => {
      const t = initConvexTest();

      await t.mutation(api.example.onPropertyUpdate, {
        propertyId: "prop-999",
        newData: { sqft: 2000 },
      });

      // Verify it exists
      const statusBefore = await t.query(api.example.getDebounceStatus, {
        namespace: "property-metrics",
        key: "prop-999",
      });
      expect(statusBefore).not.toBeNull();

      // Cancel it
      const cancelled = await t.mutation(api.example.cancelDebounce, {
        namespace: "property-metrics",
        key: "prop-999",
      });
      expect(cancelled).toBe(true);

      // Verify it's gone
      const statusAfter = await t.query(api.example.getDebounceStatus, {
        namespace: "property-metrics",
        key: "prop-999",
      });
      expect(statusAfter).toBeNull();
    });
  });
});
