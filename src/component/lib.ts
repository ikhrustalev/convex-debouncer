import { v } from "convex/values";
import type { FunctionHandle } from "convex/server";
import {
  internalMutation,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server.js";
import { internal } from "./_generated/api.js";
import type { Doc, Id } from "./_generated/dataModel.js";
import { modeValidator } from "./schema.js";

async function findCall(ctx: QueryCtx, namespace: string, key: string) {
  return await ctx.db
    .query("debouncedCalls")
    .withIndex("by_namespace_and_key", (q) =>
      q.eq("namespace", namespace).eq("key", key),
    )
    .unique();
}

/**
 * A row is live while its scheduled `execute` can still run. If that run
 * failed or was canceled outside this component, the row is stale and would
 * otherwise block the key forever.
 */
async function isLive(ctx: MutationCtx, call: Doc<"debouncedCalls">) {
  if (!call.scheduledFunctionId) {
    return false;
  }
  const job = await ctx.db.system.get(call.scheduledFunctionId);
  return job?.state.kind === "pending" || job?.state.kind === "inProgress";
}

async function scheduleExecute(
  ctx: MutationCtx,
  callId: Id<"debouncedCalls">,
  delay: number,
) {
  return await ctx.scheduler.runAfter(delay, internal.lib.execute, { callId });
}

async function runTarget(
  ctx: MutationCtx,
  functionHandle: string,
  functionArgs: Record<string, unknown>,
) {
  const handle = functionHandle as FunctionHandle<"mutation" | "action">;
  await ctx.scheduler.runAfter(0, handle, functionArgs);
}

/**
 * Schedule a debounced function call.
 *
 * The first call for a (namespace, key) creates a row whose mode governs the
 * key until it fires. Later calls always replace the target function and args
 * (latest wins), and then, by the row's mode:
 * - eager: queue a trailing call for the end of the cooldown
 * - fixed: keep the original timer
 * - sliding: reset the timer to `delay` from now
 */
export const schedule = mutation({
  args: {
    namespace: v.string(),
    key: v.string(),
    mode: modeValidator,
    delay: v.number(),
    functionPath: v.string(),
    functionHandle: v.string(),
    functionArgs: v.record(v.string(), v.any()),
  },
  returns: v.object({
    executed: v.boolean(),
    scheduledFor: v.number(),
  }),
  handler: async (ctx, args) => {
    if (!Number.isFinite(args.delay) || args.delay < 0) {
      throw new Error(
        `Debouncer delay must be a non-negative finite number, got ${args.delay}`,
      );
    }
    const now = Date.now();

    let existing = await findCall(ctx, args.namespace, args.key);
    if (existing && !(await isLive(ctx, existing))) {
      await ctx.db.delete(existing._id);
      existing = null;
    }

    if (existing) {
      const latest = {
        functionPath: args.functionPath,
        functionHandle: args.functionHandle,
        functionArgs: args.functionArgs,
        retriggerCount: existing.retriggerCount + 1,
      };

      if (existing.mode === "sliding") {
        if (existing.scheduledFunctionId) {
          await ctx.scheduler.cancel(existing.scheduledFunctionId);
        }
        const scheduledFor = now + args.delay;
        const scheduledFunctionId = await scheduleExecute(
          ctx,
          existing._id,
          args.delay,
        );
        await ctx.db.patch(existing._id, {
          ...latest,
          delay: args.delay,
          scheduledFor,
          scheduledFunctionId,
        });
        return { executed: false, scheduledFor };
      }

      await ctx.db.patch(existing._id, {
        ...latest,
        ...(existing.mode === "eager" ? { hasTrailingCall: true } : {}),
      });
      return { executed: false, scheduledFor: existing.scheduledFor };
    }

    const scheduledFor = now + args.delay;
    const callId = await ctx.db.insert("debouncedCalls", {
      namespace: args.namespace,
      key: args.key,
      mode: args.mode,
      delay: args.delay,
      functionPath: args.functionPath,
      functionHandle: args.functionHandle,
      functionArgs: args.functionArgs,
      scheduledFor,
      retriggerCount: 1,
      hasTrailingCall: false,
      ...(args.mode === "eager" ? { leadingExecutedAt: now } : {}),
    });
    const scheduledFunctionId = await scheduleExecute(ctx, callId, args.delay);
    await ctx.db.patch(callId, { scheduledFunctionId });

    if (args.mode === "eager") {
      // Leading call. Scheduling it here keeps it in the same transaction as
      // the cooldown row.
      await runTarget(ctx, args.functionHandle, args.functionArgs);
    }
    return { executed: args.mode === "eager", scheduledFor };
  },
});

/**
 * Get the status of a debounced key, or null if the key is idle.
 * `pending` is false for an eager key in its cooldown with nothing queued.
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
    const call = await findCall(ctx, args.namespace, args.key);
    if (!call) {
      return null;
    }

    return {
      pending: call.mode !== "eager" || call.hasTrailingCall,
      scheduledFor: call.scheduledFor,
      retriggerCount: call.retriggerCount,
      mode: call.mode,
      hasTrailingCall: call.hasTrailingCall,
    };
  },
});

/**
 * Cancel a debounced key: drop any queued call and end an eager cooldown.
 * Returns false if the key was idle.
 */
export const cancel = mutation({
  args: {
    namespace: v.string(),
    key: v.string(),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const call = await findCall(ctx, args.namespace, args.key);
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
 * Called by the scheduler when a key's timer fires. Runs the target through
 * its function handle, which works across the component boundary.
 */
export const execute = internalMutation({
  args: {
    callId: v.id("debouncedCalls"),
  },
  returns: v.object({
    executed: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const call = await ctx.db.get(args.callId);
    if (!call) {
      return { executed: false };
    }

    if (call.mode === "eager" && !call.hasTrailingCall) {
      // Cooldown ended with no new calls.
      await ctx.db.delete(call._id);
      return { executed: false };
    }

    await runTarget(ctx, call.functionHandle, call.functionArgs);

    if (call.mode === "eager") {
      // The trailing run starts a new cooldown, so the target never runs
      // twice within one delay window.
      const scheduledFunctionId = await scheduleExecute(
        ctx,
        call._id,
        call.delay,
      );
      await ctx.db.patch(call._id, {
        scheduledFor: Date.now() + call.delay,
        scheduledFunctionId,
        hasTrailingCall: false,
        leadingExecutedAt: Date.now(),
      });
    } else {
      await ctx.db.delete(call._id);
    }
    return { executed: true };
  },
});
