# Debugging tests

Run the project's tests under a real debugger: breakpoints in your own `.ts` files, stepping, call stack, variables and watches. It works like Eclipse's "Debug As → JUnit Test" and is built on vitest and the Node inspector.

## Use it

1. Open a test file (for example `test/payment.test.ts`) and click the gutter next to a line number, or press **F9** on the line. A red dot marks the breakpoint. Right-click → *Toggle breakpoint* works too.
2. Press **F5** (or *Run → Debug tests in this file*, or right-click the file in the Explorer → *Debug tests in this file*, or the *Debug* buttons in the Tests view; *Debug this test* runs only the selected test).
3. When the run reaches a breakpoint the editor opens at that line (yellow arrow and highlighted line) and the **Tests view** shows the state: the debugger lives inside it, next to the results, so there is one place for running, debugging and reading results.

| Key | Action |
| --- | --- |
| F5 | Start (on a test file) / Continue |
| F10 | Step over |
| F11 | Step into |
| Shift+F11 | Step out |
| Shift+F5 | Stop |
| F9 | Toggle breakpoint on the cursor line |

While a session is open the Tests view shows the controls (continue, step over / into / out, restart, stop), the call stack (click a frame to jump to it), the variables of the selected frame (click the arrows to expand objects) and watch expressions (re-evaluated at every stop). Always available there: the list of breakpoints, an option to pause when an exception is thrown (only for code in your project, not the libraries' own caught errors), and the test output. Every test and file row has a bug button to debug just that one.

## Good to know

- Breakpoints are remembered per project and follow their lines while you edit. A breakpoint on a line without code moves to the next line that has code; the Debug view shows where it really stops.
- Test and hook timeouts are switched off while debugging, otherwise a test paused for a few seconds would fail with "Test timed out".
- Stepping skips library code (`node_modules` and Node internals).
- The Tests view is a normal dockable view: left by default so the editor stays next to it; its dock controls can move it to the right or open it as a wide tab, and *Reset panel layout* puts it back.

## How it works

`packages/ide-server/src/debug.ts` starts `vitest run --inspect-brk` (single worker, no file parallelism) and attaches to the worker over the Chrome DevTools Protocol. Vitest runs transformed code, so every script's inline source map is read and breakpoints and stack frames are translated between your original file and the code V8 runs. Breakpoints are placed just before each script runs (instrumentation breakpoint), so even top-level code is stopped on. The IDE talks to it through `/api/debug/events` (server-sent events) and `/api/debug/command`.

Needs vitest installed in the project (the HardKas templates ship it) and the project's own Node dependencies (`npm install`).
