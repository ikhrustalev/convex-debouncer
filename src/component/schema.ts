import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export const modeValidator = v.union(
  v.literal("eager"),
  v.literal("fixed"),
  v.literal("sliding"),
);

export default defineSchema({
  debouncedCalls: defineTable({
    // Identification
    namespace: v.string(),
    key: v.string(),

    // Configuration
    mode: modeValidator,
    delay: v.number(), // milliseconds

    // Scheduling state
    scheduledFor: v.number(), // Unix timestamp when execution is scheduled
    scheduledFunctionId: v.optional(v.id("_scheduled_functions")),

    // Target function
    functionPath: v.string(),
    functionArgs: v.any(),

    // Tracking
    retriggerCount: v.number(), // how many times schedule was called

    // Eager mode specific
    leadingExecutedAt: v.optional(v.number()), // when immediate execution happened
    hasTrailingCall: v.boolean(), // whether a trailing call is pending
  }).index("by_namespace_and_key", ["namespace", "key"]),
});
