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

Best for: Batch processing, rate-limited APIs, periodic syncs

### Eager Mode

Execute immediately on first call, then queue a trailing call with the latest arguments if more calls come in.

```
Call 1 ──▶ Execute immediately + start 5s timer ──┐
           ↓ 1s later                              │
Call 2 ──▶ Queue trailing (update args)           │
           ↓ 2s later                              │
Call 3 ──▶ Queue trailing (update to latest args) │
           ↓ timer ends                            │
           Execute with Call 3's args ◀────────────┘
```

Best for: Real-time collaboration, AI responses (immediate feedback + final state)

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
  ctx,                           // Mutation context
  "namespace",                   // Logical grouping
  "key",                         // Unique identifier within namespace
  internal.myModule.myFunction,  // Function reference to call
  { arg1: "value" },             // Arguments for the function
  { delay: 3000, mode: "fixed" } // Optional: override defaults
);

// result: { executed: boolean, scheduledFor: number }
```

### status()

Check the status of a pending debounced call.

```ts
const status = await debouncer.status(ctx, "namespace", "key");

// status: null (if no pending call) or:
// {
//   pending: true,
//   scheduledFor: 1234567890,  // Unix timestamp
//   retriggerCount: 3,         // Number of times schedule was called
//   mode: "sliding",
//   hasTrailingCall: false     // (eager mode) whether trailing execution is queued
// }
```

### cancel()

Cancel a pending debounced call.

```ts
const cancelled = await debouncer.cancel(ctx, "namespace", "key");
// cancelled: true if a call was cancelled, false if nothing was pending
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

    // result.executed is true for the first message (immediate execution)
    // Subsequent messages will queue a trailing execution
  },
});
```

### Fixed Interval Batch Processing

```ts
const debouncer = new Debouncer(components.debouncer, {
  delay: 30000,   // Process every 30 seconds
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
npm i
npm run dev
```

Run tests:

```sh
npm test
```

## License

Apache-2.0

Found a bug? Feature request? [File it here](https://github.com/ikhrustalev/convex-debouncer/issues).
