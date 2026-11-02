# ken

Read `docs/prd.md` before changing behaviour, and change it in the same PR when the
behaviour changes: it says what is true now, and git is its history. `docs/files.md` is
the grammar of the two files the kernel reads and writes.

Keep the code as small as possible: implement the smallest solution that fully satisfies
the request, no speculative features or abstractions. Every message the CLIs print is a
next step for an agent that sees nothing else: what is the case, why it matters, what to
run.

## The kernel: `ken`

- One POSIX `sh` file at the root, readable top to bottom, under the line cap its tests
  assert. Its only dependency is git ≥ 2.48; its files are read with `awk` and `sed`.
- `shellcheck -s sh ken` clean (part of `pnpm lint`). Tabs.
- The hazards comment at its top is the rules: an exit inside `$(...)` ends only the
  subshell (`x=$(f) || exit 1`); `A && B || C` is not if-then-else; no `sed -i`, `stat`,
  `readlink -f`; no `local`. Add a hazard there when you design around a new one.
- Tests are vitest, `test/ken.test.ts` per command and `test/workspace.test.ts` end to
  end, running the script under `sh` and `dash` against temp dirs and local bare repos,
  never the network.

## The extensions: `packages/ken-task`, `packages/ken-lint`

- pnpm for packages; node runs TypeScript directly (type stripping). No build step. Tabs.
- Their tests still assume the retired TypeScript kernel and are excluded in
  `vitest.config.ts` until they are ported to `.ken` and the script.

## Checks

- `pnpm test` (vitest), `pnpm typecheck`, `pnpm lint` (biome and shellcheck): run all
  three from the root before finishing a change.
- Add meaningful tests: ask "what does this test guard?" before writing one.
