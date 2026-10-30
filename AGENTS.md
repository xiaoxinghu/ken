# ken

A workspace root that is a knowledge base, with every git checkout under its hidden
`.repos/` and a kernel CLI that enforces the layout. Read `docs/prd.md` before changing
behaviour, and change it in the same PR when the behaviour changes: it says what is true
now, and git is its history.

Three packages, one pnpm workspace:

- `packages/ken`: `@unclex/ken`, the kernel. Primitives only; the PRD says what is not in it.
- `packages/ken-task`: `@unclex/ken-task`, the denote task system, reached as `ken task`.
  Depends on `ken`; `ken` never depends on it.
- `packages/create-ken`: `create-ken`, `npm create ken`: a template plus `ken init`.

Implement the smallest solution that fully satisfies the request. Avoid speculative
features and abstractions. Every message the CLIs print is a next step for an agent that
sees nothing else: what is the case, why it matters, what to run.

## Tools

- pnpm for packages; node runs TypeScript directly (type stripping). No build step.
- vitest for tests (`pnpm test`), `pnpm typecheck`, `pnpm lint` (biome). Tabs.
- add meaningful tests, ask "what does this test guard?" before writing tests
- Run all three from the root before finishing a code change.
