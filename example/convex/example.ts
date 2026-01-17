import { internalMutation, mutation, query } from "./_generated/server.js";
import { components, internal } from "./_generated/api.js";
import {
  Debouncer,
  type DebouncerComponentApi,
  type ScheduleResult,
} from "@ikhrustalev/convex-debouncer";
import { v } from "convex/values";

// Type assertion needed because generated types may be stale during development.
// After running `npx convex dev`, the types will be correctly inferred.
const debouncerComponent = components.debouncer as unknown as DebouncerComponentApi;

// Create a Debouncer instance with default configuration
// This can be used across multiple mutations in your app
const debouncer = new Debouncer(debouncerComponent, {
  delay: 5000, // 5 second delay
  mode: "sliding", // Reset timer on each call
});

// Alternative configurations for different use cases:
const eagerDebouncer = new Debouncer(debouncerComponent, {
  delay: 10000, // 10 second cooldown
  mode: "eager", // Execute immediately, then queue trailing if needed
});

const fixedDebouncer = new Debouncer(debouncerComponent, {
  delay: 3000, // 3 second fixed delay
  mode: "fixed", // Timer stays fixed from first call
});

// ============================================================================
// Example: Debouncing expensive metrics computation
// ============================================================================

/**
 * Called when a property is updated. Instead of computing metrics immediately,
 * we debounce to avoid expensive recalculation on every keystroke.
 */
export const onPropertyUpdate = mutation({
  args: {
    propertyId: v.string(),
    newData: v.object({
      price: v.optional(v.number()),
      sqft: v.optional(v.number()),
      bedrooms: v.optional(v.number()),
    }),
  },
  returns: v.object({
    executed: v.boolean(),
    scheduledFor: v.number(),
  }),
  handler: async (ctx, args): Promise<ScheduleResult> => {
    // Debounce the metrics computation
    // With sliding mode, rapid updates will keep pushing the execution time
    const result: ScheduleResult = await debouncer.schedule(
      ctx,
      "property-metrics", // namespace
      args.propertyId, // key - unique per property
      internal.example.computePropertyMetrics, // function to call
      { propertyId: args.propertyId }, // args for that function
    );

    return result;
  },
});

/**
 * The actual expensive computation (this gets called after debounce delay)
 */
export const computePropertyMetrics = internalMutation({
  args: {
    propertyId: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    // Simulate expensive computation
    console.log(`Computing metrics for property: ${args.propertyId}`);

    // In a real app, you might:
    // - Calculate market comparisons
    // - Run valuation models
    // - Update analytics dashboards
    // - etc.

    return null;
  },
});

// ============================================================================
// Example: Eager mode for real-time AI responses
// ============================================================================

/**
 * When user sends a message, we want to:
 * 1. Immediately trigger a response (so user gets feedback)
 * 2. If they send more messages quickly, ensure we process the final state
 */
export const onUserMessage = mutation({
  args: {
    conversationId: v.string(),
    message: v.string(),
  },
  returns: v.object({
    executed: v.boolean(),
    scheduledFor: v.number(),
  }),
  handler: async (ctx, args): Promise<ScheduleResult> => {
    // With eager mode:
    // - First message: executed immediately (result.executed = true)
    // - Subsequent messages within delay: queued for trailing execution
    const result: ScheduleResult = await eagerDebouncer.schedule(
      ctx,
      "ai-responses",
      args.conversationId,
      internal.example.generateAIResponse,
      { conversationId: args.conversationId },
    );

    return result;
  },
});

export const generateAIResponse = internalMutation({
  args: {
    conversationId: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    console.log(`Generating AI response for conversation: ${args.conversationId}`);
    return null;
  },
});

// ============================================================================
// Example: Fixed mode for batch processing
// ============================================================================

/**
 * Queue items for batch processing. Fixed mode ensures we process
 * at regular intervals regardless of how many items are added.
 */
export const queueForBatchProcessing = mutation({
  args: {
    batchId: v.string(),
    itemId: v.string(),
  },
  returns: v.object({
    executed: v.boolean(),
    scheduledFor: v.number(),
  }),
  handler: async (ctx, args): Promise<ScheduleResult> => {
    // With fixed mode:
    // - First item: sets the timer
    // - Additional items: absorbed, timer unchanged
    // - After delay: processes with latest state
    const result: ScheduleResult = await fixedDebouncer.schedule(
      ctx,
      "batch-processing",
      args.batchId,
      internal.example.processBatch,
      { batchId: args.batchId },
    );

    return result;
  },
});

export const processBatch = internalMutation({
  args: {
    batchId: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    console.log(`Processing batch: ${args.batchId}`);
    return null;
  },
});

// ============================================================================
// Status and Cancellation
// ============================================================================

/**
 * Check the status of a pending debounced call
 */
export const getDebounceStatus = query({
  args: {
    namespace: v.string(),
    key: v.string(),
  },
  returns: v.union(
    v.null(),
    v.object({
      pending: v.boolean(),
      scheduledFor: v.number(),
      retriggerCount: v.number(),
      mode: v.union(v.literal("eager"), v.literal("fixed"), v.literal("sliding")),
      hasTrailingCall: v.boolean(),
    }),
  ),
  handler: async (ctx, args) => {
    return await debouncer.status(ctx, args.namespace, args.key);
  },
});

/**
 * Cancel a pending debounced call
 */
export const cancelDebounce = mutation({
  args: {
    namespace: v.string(),
    key: v.string(),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    return await debouncer.cancel(ctx, args.namespace, args.key);
  },
});
