# ken

Read `docs/prd.md` before changing behaviour, and change it in the same PR when the
behaviour changes: it says what is true now, and git is its history.

Keep the code as small as possible: implement the smallest solution that fully satisfies
the request, no speculative features or abstractions. Every message the CLIs print is a
next step for an agent that sees nothing else: what is the case, why it matters, what to
run.

## Tools

- pnpm for packages; node runs TypeScript directly (type stripping). No build step.
- vitest for tests (`pnpm test`), `pnpm typecheck`, `pnpm lint` (biome). Tabs.
- add meaningful tests, ask "what does this test guard?" before writing tests
- Run all three from the root before finishing a code change.
