import {
  createFunctionHandle,
  getFunctionName,
  type FunctionReference,
  type GenericDataModel,
  type GenericMutationCtx,
  type GenericQueryCtx,
} from "convex/server";
import type { ComponentApi } from "../component/_generated/component.js";

/**
 * Debouncing modes:
 * - "eager": Execute immediately on first call, then schedule trailing call with latest args if subsequent calls come in
 * - "fixed": Schedule after delay, absorb subsequent calls and update args (timer stays fixed)
 * - "sliding": Schedule after delay, reset timer on each subsequent call
 */
export type DebouncerMode = "eager" | "fixed" | "sliding";

/**
 * Options for creating a Debouncer instance.
 */
export interface DebouncerOptions {
  /**
   * Delay in milliseconds before executing the debounced function.
   * For eager mode, this is the cooldown period after immediate execution.
   */
  delay: number;

  /**
   * Debouncing mode.
   * @default "sliding"
   */
  mode?: DebouncerMode;
}

/**
 * Status of a pending debounced call.
 */
export interface DebouncerStatus {
  pending: boolean;
  scheduledFor: number;
  retriggerCount: number;
  mode: DebouncerMode;
  hasTrailingCall: boolean;
}

/**
 * Result of scheduling a debounced call.
 */
export interface ScheduleResult {
  /**
   * True when this call started an eager leading run. The target is scheduled
   * to run right after the current mutation commits; it has not run yet.
   */
  executed: boolean;

  /**
   * Unix timestamp when the (trailing) execution is scheduled.
   */
  scheduledFor: number;
}

/**
 * The debouncer component's API, i.e. the type of `components.debouncer`.
 */
export type DebouncerComponentApi = ComponentApi;

// Narrow ctx types so any app's typed ctx is accepted.
type RunQueryCtx = {
  runQuery: GenericQueryCtx<GenericDataModel>["runQuery"];
};
type RunMutationCtx = {
  runMutation: GenericMutationCtx<GenericDataModel>["runMutation"];
};

/**
 * A server-side debouncer for Convex functions.
 *
 * @example
 * ```ts
 * import { Debouncer } from "@ikhrustalev/convex-debouncer";
 * import { components } from "./_generated/api";
 *
 * const debouncer = new Debouncer(components.debouncer, {
 *   delay: 15 * 60 * 1000,
 *   mode: "sliding",
 * });
 *
 * // In your mutation
 * await debouncer.schedule(
 *   ctx,
 *   "property-metrics",
 *   propertyId,
 *   internal.metrics.compute,
 *   { propertyId }
 * );
 * ```
 */
export class Debouncer {
  private component: DebouncerComponentApi;
  private defaultDelay: number;
  private defaultMode: DebouncerMode;

  /**
   * Create a new Debouncer instance.
   *
   * @param component - The debouncer component API (e.g., `components.debouncer`)
   * @param options - Default options for debouncing
   */
  constructor(component: DebouncerComponentApi, options: DebouncerOptions) {
    this.component = component;
    this.defaultDelay = options.delay;
    this.defaultMode = options.mode ?? "sliding";
  }

  /**
   * Schedule a debounced function call.
   *
   * @param ctx - The mutation context
   * @param namespace - A logical grouping for debounced calls (e.g., "property-metrics")
   * @param key - A unique identifier within the namespace (e.g., propertyId)
   * @param functionRef - The mutation or action to call (e.g., `internal.metrics.compute`)
   * @param args - Arguments to pass to the function
   * @param options - Override default delay/mode for this call
   * @returns Whether a leading run was scheduled, and when the next timer fires
   */
  async schedule<Args extends Record<string, unknown>>(
    ctx: RunMutationCtx,
    namespace: string,
    key: string,
    functionRef: FunctionReference<
      "mutation" | "action",
      "public" | "internal",
      Args
    >,
    args: Args,
    options?: Partial<DebouncerOptions>,
  ): Promise<ScheduleResult> {
    const delay = options?.delay ?? this.defaultDelay;
    const mode = options?.mode ?? this.defaultMode;

    // The handle lets the component invoke the target across the component
    // boundary. The path is stored for debugging only.
    const functionHandle = await createFunctionHandle(functionRef);
    return await ctx.runMutation(this.component.lib.schedule, {
      namespace,
      key,
      mode,
      delay,
      functionPath: describeFunction(functionRef, functionHandle),
      functionHandle,
      functionArgs: args,
    });
  }

  /**
   * Get the status of a pending debounced call.
   *
   * @param ctx - The query or mutation context
   * @param namespace - The namespace of the debounced call
   * @param key - The key of the debounced call
   * @returns Status object or null if no pending call exists
   */
  async status(
    ctx: RunQueryCtx,
    namespace: string,
    key: string,
  ): Promise<DebouncerStatus | null> {
    return await ctx.runQuery(this.component.lib.status, {
      namespace,
      key,
    });
  }

  /**
   * Cancel a pending debounced call.
   *
   * @param ctx - The mutation context
   * @param namespace - The namespace of the debounced call
   * @param key - The key of the debounced call
   * @returns True if a call was cancelled, false if no pending call existed
   */
  async cancel(
    ctx: RunMutationCtx,
    namespace: string,
    key: string,
  ): Promise<boolean> {
    return await ctx.runMutation(this.component.lib.cancel, {
      namespace,
      key,
    });
  }
}

function describeFunction(
  functionRef: FunctionReference<"mutation" | "action", "public" | "internal">,
  functionHandle: string,
): string {
  try {
    return getFunctionName(functionRef);
  } catch {
    // References into other components have no plain name.
    return functionHandle;
  }
}

// Re-export types for convenience
export type { FunctionReference } from "convex/server";
