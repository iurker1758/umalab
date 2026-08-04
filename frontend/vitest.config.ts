import { defineConfig } from "vitest/config";

// A separate file rather than a `test` block in vite.config.ts, and that is
// the whole content of the decision: vitest loads vite.config.ts when this is
// absent, which would pull in the React and PWA plugins to run arithmetic.
// Nothing here renders, so nothing here needs them.
export default defineConfig({
  test: {
    // Pure modules only (DECISIONS.md #30) — no DOM, so `node` rather than
    // jsdom. The two loaders that touch localStorage stub it themselves, in
    // ten lines, which is cheaper than a DOM implementation for the whole run.
    environment: "node",
    // Scoped to the source tree so `npm run test` can never reach e2e/. The
    // suite there needs Postgres, uvicorn and a dev server, and a runner that
    // silently picked it up would turn a two-second command into the slow one
    // people skip.
    //
    // `.tsx` is in the glob even though component tests are out of scope: one
    // written anyway then fails loudly on `document is not defined`, which
    // says what the rule is. Left out, it would be collected by nothing and
    // report a green run over a file that never executed.
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
