import { v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server.js";
import { internal } from "./_generated/api.js";
import { modeValidator } from "./schema.js";

/**
 * Schedule a debounced function call.
 * Depending on the mode:
 * - eager: Execute immediately on first call, queue trailing call if subsequent calls come in
 * - fixed: Schedule after delay, absorb subsequent calls and update args
 * - sliding: Schedule after delay, reset timer on each call
 */
export const schedule = mutation({
  args: {
    namespace: v.string(),
    key: v.string(),
    mode: modeValidator,
    delay: v.number(),
    functionPath: v.string(),
    functionArgs: v.any(),
  },
  returns: v.object({
    executed: v.boolean(),
    scheduledFor: v.number(),
  }),
  handler: async (ctx, args) => {
    const now = Date.now();

    // Check for existing debounced call
    const existing = await ctx.db
      .query("debouncedCalls")
      .withIndex("by_namespace_and_key", (q) =>
        q.eq("namespace", args.namespace).eq("key", args.key),
      )
      .unique();

    if (existing) {
      // Update existing call based on mode
      const retriggerCount = existing.retriggerCount + 1;

      if (args.mode === "eager") {
        // Eager mode: leading execution already happened, mark trailing call
        await ctx.db.patch(existing._id, {
          functionArgs: args.functionArgs,
          retriggerCount,
          hasTrailingCall: true,
        });
        return {
          executed: false,
          scheduledFor: existing.scheduledFor,
        };
      } else if (args.mode === "fixed") {
        // Fixed mode: keep original timer, update args
        await ctx.db.patch(existing._id, {
          functionArgs: args.functionArgs,
          retriggerCount,
        });
        return {
          executed: false,
          scheduledFor: existing.scheduledFor,
        };
      } else {
        // Sliding mode: cancel old timer, schedule new one
        if (existing.scheduledFunctionId) {
          await ctx.scheduler.cancel(existing.scheduledFunctionId);
        }
        const scheduledFor = now + args.delay;
        const scheduledFunctionId = await ctx.scheduler.runAfter(
          args.delay,
          internal.lib.execute,
          { callId: existing._id },
        );
        await ctx.db.patch(existing._id, {
          functionArgs: args.functionArgs,
          scheduledFor,
          scheduledFunctionId,
          retriggerCount,
        });
        return {
          executed: false,
          scheduledFor,
        };
      }
    }

    // No existing call - create new one
    const scheduledFor = now + args.delay;

    if (args.mode === "eager") {
      // Eager mode: schedule timer for potential trailing call, but don't execute yet
      // The actual immediate execution happens in the client layer
      const callId = await ctx.db.insert("debouncedCalls", {
        namespace: args.namespace,
        key: args.key,
        mode: args.mode,
        delay: args.delay,
        functionPath: args.functionPath,
        functionArgs: args.functionArgs,
        scheduledFor,
        retriggerCount: 1,
        leadingExecutedAt: now,
        hasTrailingCall: false,
      });

      // Schedule the trailing edge check
      const scheduledFunctionId = await ctx.scheduler.runAfter(
        args.delay,
        internal.lib.execute,
        { callId },
      );
      await ctx.db.patch(callId, { scheduledFunctionId });

      return {
        executed: true, // Signal to client to execute immediately
        scheduledFor,
      };
    } else {
      // Fixed or Sliding mode: schedule for later
      const callId = await ctx.db.insert("debouncedCalls", {
        namespace: args.namespace,
        key: args.key,
        mode: args.mode,
        delay: args.delay,
        functionPath: args.functionPath,
        functionArgs: args.functionArgs,
        scheduledFor,
        retriggerCount: 1,
        hasTrailingCall: false,
      });

      const scheduledFunctionId = await ctx.scheduler.runAfter(
        args.delay,
        internal.lib.execute,
        { callId },
      );
      await ctx.db.patch(callId, { scheduledFunctionId });

      return {
        executed: false,
        scheduledFor,
      };
    }
  },
});

/**
 * Get the status of a debounced call.
 */
export const status = query({
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
      mode: modeValidator,
      hasTrailingCall: v.boolean(),
    }),
  ),
  handler: async (ctx, args) => {
    const call = await ctx.db
      .query("debouncedCalls")
      .withIndex("by_namespace_and_key", (q) =>
        q.eq("namespace", args.namespace).eq("key", args.key),
      )
      .unique();

    if (!call) {
      return null;
    }

    return {
      pending: true,
      scheduledFor: call.scheduledFor,
      retriggerCount: call.retriggerCount,
      mode: call.mode,
      hasTrailingCall: call.hasTrailingCall,
    };
  },
});

/**
 * Cancel a pending debounced call.
 */
export const cancel = mutation({
  args: {
    namespace: v.string(),
    key: v.string(),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const call = await ctx.db
      .query("debouncedCalls")
      .withIndex("by_namespace_and_key", (q) =>
        q.eq("namespace", args.namespace).eq("key", args.key),
      )
      .unique();

    if (!call) {
      return false;
    }

    if (call.scheduledFunctionId) {
      await ctx.scheduler.cancel(call.scheduledFunctionId);
    }

    await ctx.db.delete(call._id);
    return true;
  },
});

/**
 * Internal mutation called by the scheduler to execute the debounced function.
 */
export const execute = internalMutation({
  args: {
    callId: v.id("debouncedCalls"),
  },
  returns: v.object({
    executed: v.boolean(),
    functionPath: v.optional(v.string()),
    functionArgs: v.optional(v.any()),
  }),
  handler: async (ctx, args) => {
    const call = await ctx.db.get(args.callId);

    if (!call) {
      // Call was cancelled
      return { executed: false };
    }

    // For eager mode, only execute if there's a trailing call
    if (call.mode === "eager" && !call.hasTrailingCall) {
      // No trailing call needed, just clean up
      await ctx.db.delete(call._id);
      return { executed: false };
    }

    // Clean up the record
    await ctx.db.delete(call._id);

    // Return the function details for the caller to execute
    // Note: The actual function execution happens in the action layer
    // because mutations can't call arbitrary functions by path
    return {
      executed: true,
      functionPath: call.functionPath,
      functionArgs: call.functionArgs,
    };
  },
});

/**
 * Get the function details for a pending call (used by client to execute).
 */
export const getCallDetails = query({
  args: {
    namespace: v.string(),
    key: v.string(),
  },
  returns: v.union(
    v.null(),
    v.object({
      functionPath: v.string(),
      functionArgs: v.any(),
    }),
  ),
  handler: async (ctx, args) => {
    const call = await ctx.db
      .query("debouncedCalls")
      .withIndex("by_namespace_and_key", (q) =>
        q.eq("namespace", args.namespace).eq("key", args.key),
      )
      .unique();

    if (!call) {
      return null;
    }

    return {
      functionPath: call.functionPath,
      functionArgs: call.functionArgs,
    };
  },
});
