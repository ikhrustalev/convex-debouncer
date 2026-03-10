import {
  createFunctionHandle,
  type FunctionReference,
  type GenericDataModel,
  type GenericMutationCtx,
  type GenericQueryCtx,
} from "convex/server";

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
   * Whether the function was executed immediately (eager mode first call).
   */
  executed: boolean;

  /**
   * Unix timestamp when the (trailing) execution is scheduled.
   */
  scheduledFor: number;
}

/**
 * The component API type for the debouncer.
 * This is a minimal type that matches what the component exports.
 */
export interface DebouncerComponentApi {
  lib: {
    schedule: FunctionReference<
      "mutation",
      "internal",
      {
        namespace: string;
        key: string;
        mode: DebouncerMode;
        delay: number;
        functionPath: string;
        functionHandle: string;
        functionArgs: unknown;
      },
      { executed: boolean; scheduledFor: number }
    >;
    status: FunctionReference<
      "query",
      "internal",
      { namespace: string; key: string },
      DebouncerStatus | null
    >;
    cancel: FunctionReference<
      "mutation",
      "internal",
      { namespace: string; key: string },
      boolean
    >;
  };
}

type MutationCtx = GenericMutationCtx<GenericDataModel>;
type QueryCtx = GenericQueryCtx<GenericDataModel>;

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
   * @returns Result indicating if immediate execution happened and when scheduled execution will occur
   */
  async schedule<Args extends Record<string, unknown>>(
    ctx: MutationCtx,
    namespace: string,
    key: string,
    functionRef: FunctionReference<"mutation" | "action", "internal", Args>,
    args: Args,
    options?: Partial<DebouncerOptions>,
  ): Promise<ScheduleResult> {
    const delay = options?.delay ?? this.defaultDelay;
    const mode = options?.mode ?? this.defaultMode;

    // Get the function path from the function reference (for debugging)
    const functionPath = getFunctionPath(functionRef);

    // Create a function handle that can be used across component boundaries.
    // This allows the component's scheduled execute mutation to invoke
    // the target function in the parent app's context.
    const functionHandle = await createFunctionHandle(functionRef);

    const result = await ctx.runMutation(this.component.lib.schedule, {
      namespace,
      key,
      mode,
      delay,
      functionPath,
      functionHandle,
      functionArgs: args,
    });

    // For eager mode, if this is the first call, execute immediately
    // via scheduler to support both mutations and actions uniformly.
    if (result.executed && mode === "eager") {
      await (ctx.scheduler.runAfter as CallableFunction)(0, functionHandle, args);
    }

    return result;
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
    ctx: QueryCtx | MutationCtx,
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
    ctx: MutationCtx,
    namespace: string,
    key: string,
  ): Promise<boolean> {
    return await ctx.runMutation(this.component.lib.cancel, {
      namespace,
      key,
    });
  }
}

// Symbol used by Convex to store function name on FunctionReference
const functionNameSymbol = Symbol.for("functionName");

/**
 * Extract the function path from a FunctionReference.
 * Uses the internal functionName symbol that Convex uses.
 */
function getFunctionPath(
  functionRef: FunctionReference<"mutation" | "action", "internal">,
): string {
  // Legacy path: function reference is already a string
  if (typeof functionRef === "string") {
    return functionRef;
  }

  // Access the function name via the Convex symbol
  const ref = functionRef as unknown as Record<symbol, string>;
  const name = ref[functionNameSymbol];
  if (name) {
    return name;
  }

  // Fallback: try to extract from string representation
  const str = String(functionRef);
  if (str && str !== "[object Object]") {
    return str;
  }

  throw new Error(
    "Could not extract function path from function reference. " +
      "Make sure you're passing a function reference from `internal` or `api`.",
  );
}

// Re-export types for convenience
export type { FunctionReference } from "convex/server";
