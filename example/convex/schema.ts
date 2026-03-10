import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  // Track function executions for e2e testing
  executionLog: defineTable({
    functionName: v.string(),
    args: v.any(),
    executedAt: v.number(),
  }),
});
