# @unclex/ken-core

The core of ken: a root's two files, `.ken` and `.repos.index`, finding the root, and the
primitives every other command builds on. A person installs `@unclex/ken`, which bundles it
with the standard commands; this package knows none of them.

It exports `main`, which runs ken with the arguments after `ken` and returns the exit
status. `src/cli.ts` runs it with only the core commands, from a clone, with no build:

```sh
node packages/ken-core/src/cli.ts init
bun packages/ken-core/src/cli.ts path root
```

What it does is "The core" in `docs/prd.md` at the repo root; the files' grammar is
`docs/files.md`.
