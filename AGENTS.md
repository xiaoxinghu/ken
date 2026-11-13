# ken

Read `docs/prd.md` before changing behaviour, and change it in the same PR when the
behaviour changes: it says what is true now, and git is its history. `docs/files.md` is
the grammar of the two files ken reads and writes; `docs/extensions.md` is the contract of
every command outside the core.

Keep the code as small as possible: implement the smallest solution that fully satisfies
the request, no speculative features or abstractions. Every message the CLIs print is a
next step for an agent that sees nothing else: what is the case, why it matters, what to
run.

## Built beside the old ken

ken is being rewritten in TypeScript, and the owner's root still runs the old one from
this repo's main checkout, through links: `~/.local/bin/ken` to the file `ken`, `ken-task`
and `ken-lint` to their `src/cli.ts`. So the new ken is built beside the old one: nothing
moves or deletes `ken`, `templates/`, `test/`, or the entry files of `packages/ken-task`
and `packages/ken-lint`, and those two keep working under the old kernel, until the root
is migrated and the old ken removed in a change of its own.

## Layout

- `packages/ken-core`, `@unclex/ken-core`: the primitives and the dispatch. Small, meant to
  stay put; it knows no standard command.
- `packages/ken`, `@unclex/ken`, bin `ken`: what a person installs, the core plus the
  standard commands `status`, `log`, `digest`, `session`, `task`, `lint`, each in the form
  of an extension (`docs/extensions.md`).
- `packages/ken-task`, `packages/ken-lint`: `ken task` and `ken lint`, bundled by `ken`.
- `packages/create-ken`, `create-ken`: the files of a root for an agent harness
  (`docs/templates.md`).
- The old ken, until removed: `ken`, the POSIX `sh` kernel, `templates/agents`, published
  as the branch `template/agents` by `.github/workflows/templates.yml`, and their tests in
  `test/`. Fix them only to keep the owner's root working, by their own rules: the hazards
  comment at the top of `ken`, `shellcheck -s sh` clean, tests run under `sh` and `dash`.

## TypeScript

- Node 24 or newer and Bun run the source directly: no build to develop, test or run from a
  clone. Only syntax Node strips: no `enum`, no `namespace`, no parameter properties, no
  `import =`; `erasableSyntaxOnly` in `tsconfig.json`. Imports name the `.ts` file.
- pnpm for packages, biome for format and lint. Tabs.
- An extension, bundled or not, never imports the core: it calls `ken` and reads the two
  files, with the root from `KEN_ROOT`, which dispatch sets.
- The core's one dependency beyond the runtime is git 2.48 or newer. JSON is read with
  `JSON.parse`, never a tool that may be missing.
- Tests are vitest, in each package, against temp folders and local bare repos, never the
  network; a smoke test runs the CLI under `bun` when it is on `PATH`, skipped with a note
  when not.

## Checks

- `pnpm test` (vitest), `pnpm typecheck`, `pnpm lint` (biome and shellcheck): run all
  three from the root before finishing a change.
- Add meaningful tests: ask "what does this test guard?" before writing one.
