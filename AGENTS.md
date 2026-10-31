# Working on Flowmap

Read the "Flowmap — Development Plan" doc first. Decisions that are settled there (flows as files in
the product repo, flow vs run documents, deterministic overlay, build order) change only with the
user's agreement.

- Stack: TypeScript npm-workspaces monorepo (chosen by the user). `npm test` builds then runs vitest.
- `packages/core` stays pure: no network, file or clock access. File I/O belongs in `cli`
  (and later `adapters`, `viewer`, `mcp`).
- `packages/viewer` is a static app with no backend. Keep logic that can be pure (paths, search,
  overlay, workspace loading, layout) in `src/lib` with vitest tests in `test/`; components stay thin.
- Run documents follow `docs/run-format.md`; `validateRunSource` in core checks them.
- `examples/order-fulfilment` is the shared fixture for every step; extend it, don't add new examples.
- Each validator rule needs a fixture in `examples/order-fulfilment/flows-broken/` and a row in the
  table in `packages/core/test/validate.test.ts`.
- A step is finished only when its "Done when" criterion is met and covered by tests.
