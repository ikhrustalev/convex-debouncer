# Convex Debouncer

[![npm version](https://badge.fury.io/js/@ikhrustalev%2Fconvex-debouncer.svg)](https://badge.fury.io/js/@ikhrustalev%2Fconvex-debouncer)

A server-side debouncing component for Convex. Debounce expensive operations like LLM calls, metrics computation, or any heavy processing that should only run after a period of inactivity.

## Why use this?

When users rapidly trigger expensive operations (like typing in a chat that triggers AI responses, or updating data that requires recomputation), you often want to:

1. **Wait for a pause** before processing (avoid wasted computation)
2. **Guarantee the latest state** is processed (don't lose the final update)
3. **Provide immediate feedback** in some cases (don't make users wait)

This component provides three debouncing modes to handle these scenarios.

## Installation

```bash
npm install @ikhrustalev/convex-debouncer
```

Create a `convex.config.ts` file in your app's `convex/` folder and install the component:

```ts
// convex/convex.config.ts
import { defineApp } from "convex/server";
import debouncer from "@ikhrustalev/convex-debouncer/convex.config.js";

const app = defineApp();
app.use(debouncer);

export default app;
```

## Usage

```ts
import { Debouncer } from "@ikhrustalev/convex-debouncer";
import { components, internal } from "./_generated/api";

// Create a Debouncer instance with default configuration
const debouncer = new Debouncer(components.debouncer, {
  delay: 5000,      // 5 second delay
  mode: "sliding",  // Options: "eager" | "fixed" | "sliding"
});

// In your mutation
export const onPropertyUpdate = mutation({
  args: { propertyId: v.string(), data: v.any() },
  handler: async (ctx, args) => {
    // Schedule a debounced metrics computation
    await debouncer.schedule(
      ctx,
      "property-metrics",        // namespace
      args.propertyId,           // key (unique within namespace)
      internal.metrics.compute,  // function to call
      { propertyId: args.propertyId }  // arguments
    );
  },
});
```

## Debouncing Modes

### Sliding Mode (default)

Each call resets the timer. The function only executes after the delay passes with no new calls.

```
Call 1 ──▶ Start 5s timer
           ↓ 2s later
Call 2 ──▶ Reset timer to 5s
           ↓ 5s later (no calls)
           Execute with Call 2's args
```

Best for: Search-as-you-type, auto-save, real-time validation

### Fixed Mode

Timer stays fixed from the first call. Subsequent calls update the arguments but don't extend the timer.

```
Call 1 ──▶ Start 5s timer ──────────────┐
           ↓ 2s later                   │
Call 2 ──▶ Update args (timer unchanged)│
           ↓ 3s later                   │
           Execute with Call 2's args ◀─┘
```

Best for: Batch processing, rate-limited APIs. It runs once per burst, not on a repeating schedule.

### Eager Mode

Execute immediately on first call, then queue a trailing call with the latest arguments if more calls come in. The target runs at most once per delay window: a trailing run starts a new cooldown, and calls during it queue another trailing run.

```
Call 1 ──▶ Execute immediately + start 5s cooldown ──┐
           ↓ 1s later                                 │
Call 2 ──▶ Queue trailing (update args)              │
           ↓ 2s later                                 │
Call 3 ──▶ Queue trailing (update to latest args)    │
           ↓ cooldown ends                            │
           Execute with Call 3's args ◀───────────────┘
           + start a new 5s cooldown
```

Best for: Real-time collaboration, AI responses (immediate feedback + final state)

### Retriggers

The first call for a namespace and key sets its mode. Until that call fires, later calls follow that mode, even if they pass a different `mode`. Every retrigger replaces both the target function and its arguments, so the latest call always wins.

## API Reference

### Constructor

```ts
const debouncer = new Debouncer(components.debouncer, {
  delay: 5000,       // Delay in milliseconds
  mode: "sliding",   // "eager" | "fixed" | "sliding"
});
```

### schedule()

Schedule a debounced function call.

```ts
const result = await debouncer.schedule(
  ctx,                           // Mutation or action context
  "namespace",                   // Logical grouping
  "key",                         // Unique identifier within namespace
  internal.myModule.myFunction,  // Mutation or action to call (internal or public)
  { arg1: "value" },             // Arguments for the function
  { delay: 3000, mode: "fixed" } // Optional: override defaults
);

// result: { executed: boolean, scheduledFor: number }
```

`executed` is true when this call started an eager leading run. The target is scheduled to run as soon as the current mutation commits. `scheduledFor` is when the key's timer fires next. `delay` must be a non-negative finite number.

### status()

Check the status of a debounced key.

```ts
const status = await debouncer.status(ctx, "namespace", "key");

// status: null (if the key is idle) or:
// {
//   pending: true,             // false for an eager cooldown with nothing queued
//   scheduledFor: 1234567890,  // Unix timestamp
//   retriggerCount: 3,         // Number of times schedule was called
//   mode: "sliding",
//   hasTrailingCall: false     // (eager mode) whether trailing execution is queued
// }
```

### cancel()

Cancel a debounced key. This drops any queued call and ends an eager cooldown.

```ts
const cancelled = await debouncer.cancel(ctx, "namespace", "key");
// cancelled: true if the key was active, false if it was idle
```

## Examples

### Debouncing Metrics Computation

```ts
const debouncer = new Debouncer(components.debouncer, {
  delay: 5000,
  mode: "sliding",
});

export const onDataChange = mutation({
  args: { entityId: v.string() },
  handler: async (ctx, args) => {
    // Multiple rapid changes will only trigger one computation
    await debouncer.schedule(
      ctx,
      "metrics",
      args.entityId,
      internal.metrics.recompute,
      { entityId: args.entityId }
    );
  },
});
```

### Eager AI Responses

```ts
const debouncer = new Debouncer(components.debouncer, {
  delay: 10000,
  mode: "eager",  // Respond immediately, then ensure we process final state
});

export const onUserMessage = mutation({
  args: { conversationId: v.string(), message: v.string() },
  handler: async (ctx, args) => {
    const result = await debouncer.schedule(
      ctx,
      "ai-responses",
      args.conversationId,
      internal.ai.generateResponse,
      { conversationId: args.conversationId }
    );

    // result.executed is true for the first message (leading run)
    // Messages during the cooldown queue one trailing run
  },
});
```

### Batch Processing

```ts
const debouncer = new Debouncer(components.debouncer, {
  delay: 30000,   // Process 30 seconds after the first item
  mode: "fixed",  // Timer doesn't extend
});

export const queueItem = mutation({
  args: { batchId: v.string(), itemId: v.string() },
  handler: async (ctx, args) => {
    // First item starts the timer, subsequent items just update
    await debouncer.schedule(
      ctx,
      "batches",
      args.batchId,
      internal.batch.process,
      { batchId: args.batchId }
    );
  },
});
```

## Development

```sh
pnpm install
pnpm run dev
```

Run tests:

```sh
pnpm test
```

## License

Apache-2.0

Found a bug? Feature request? [File it here](https://github.com/ikhrustalev/convex-debouncer/issues).
