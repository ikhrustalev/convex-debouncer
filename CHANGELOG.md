# Changelog

## 0.2.0

- Tested against Convex 1.50 and convex-test 0.0.71.
- Fix: a retrigger with a different mode no longer drops the call. The first
  call's mode governs the key until it goes idle.
- Fix: a retrigger now replaces the target function as well as its args.
- Fix: a key whose scheduled run failed or was canceled no longer stays stuck.
  `status` and `cancel` treat it as idle, and the next call schedules it afresh.
- Fix: in eager mode, a trailing run starts a new cooldown, so runs are queued
  at most once per delay window.
- The eager leading call is now scheduled inside the component mutation, in the
  same transaction as the cooldown state.
- `status().pending` is false for an eager cooldown with nothing queued.
- `delay` must be a non-negative finite number.
- Client methods accept any app's typed query, mutation or action `ctx` (no
  casts needed), and `schedule()` accepts public function references too.
- `DebouncerComponentApi` is now the generated component API type.
- Removed the unused `getCallDetails` component query, the nonexistent `./react`
  export and the `react` peer dependency.
- Switched development to pnpm.

## 0.1.2

- Support actions as debounced targets.
- Normalize the repository field in package.json.

## 0.1.1

- Actually invoke the target function, via a function handle, so it works across
  the component boundary.

## 0.1.0

- Initial release.
