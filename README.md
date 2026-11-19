# ken

Your ken: the range of what you know and can reach.

One workspace root that is a knowledge base, plain files, in git by default. Every git
checkout the root uses lives inside it, in `.repos/`, at `<host>/<owner>/<repo>`, with a
worktree per branch beside the clone, so a session in any checkout is under the root's
rules. One CLI, installed once per machine, enforces the few fixed rules; everything else is
commands and skills built on it.

| What                                    | Command          | Does                                                       |
| --------------------------------------- | ---------------- | ---------------------------------------------------------- |
| `@unclex/ken-core`, `packages/ken-core` |                  | the core: layout, index, dispatch                          |
| `@unclex/ken`, `packages/ken`           | `ken`            | the core and the standard commands, what a person installs |
| `@unclex/ken-task`, `packages/ken-task` | `ken task`       | plain-text tasks in one folder, a worktree per task        |
| `@unclex/ken-lint`, `packages/ken-lint` | `ken lint`       | the knowledge-base lint: indexes, links, references        |
| `create-ken`, `packages/create-ken`     | `npm create ken` | a root for an agent harness                                |

## Install

```sh
npm install -g @unclex/ken
npm create ken ~/ken     # a root with the files an agent harness needs
ken init ~/ken           # or a bare root, for a person with no agent
```

It runs on Node 24 or newer, or Bun, and needs git 2.48 or newer. Each release's notes are on
[GitHub](https://github.com/xiaoxinghu/ken/releases); upgrade with the same install line, and
take a newer template with `npm create ken` in the root.

## From a clone

The clone runs the TypeScript source with no build, through one link:

```sh
git clone https://github.com/xiaoxinghu/ken && cd ken && pnpm install
ln -sf "$PWD/packages/ken/src/cli.ts" ~/.local/bin/ken
ken version   # @unclex/ken 0.0.0: the source
```

The first `ken` on `PATH` runs, so a machine keeps one: `which -a ken` lists them in order,
and `ken version` says `0.0.0` for the clone, the release's version for an installed one. An
installed ken goes into the `bin` of the Node that ran `npm install -g`; where mise manages
Node, that folder and mise's shims come before `~/.local/bin`, so the installed ken wins over
the link. To go back to the link, `npm uninstall -g @unclex/ken`, then `mise reshim`; to the
installed one, `rm ~/.local/bin/ken`. Tests are in each package: `pnpm test`, `pnpm
typecheck`, `pnpm lint`.

## Documents

The design is [`docs/prd.md`](docs/prd.md), with [`docs/files.md`](docs/files.md) for the
two files ken reads and writes, [`docs/extensions.md`](docs/extensions.md) for the contract
of every command outside the core, and [`docs/templates.md`](docs/templates.md) for what
`create-ken` writes. What is built on it: [`docs/ken-task.md`](docs/ken-task.md),
[`docs/ken-lint.md`](docs/ken-lint.md), [`docs/built-on-top.md`](docs/built-on-top.md).
How a release is made and what a package holds: [`docs/releasing.md`](docs/releasing.md).
MIT, [`LICENSE`](LICENSE).
