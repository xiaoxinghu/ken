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

Install: `npm install -g @unclex/ken`, then `npm create ken ~/ken` for a root with the files
an agent harness needs, or `ken init ~/ken` for a bare one. It runs on Node 24 or newer or
Bun, from the source, and needs git 2.48 or newer. Each package holds its tests: `pnpm test`.

The design is [`docs/prd.md`](docs/prd.md), with [`docs/files.md`](docs/files.md) for the
two files ken reads and writes, [`docs/extensions.md`](docs/extensions.md) for the contract
of every command outside the core, and [`docs/templates.md`](docs/templates.md) for what
`create-ken` writes. What is built on it: [`docs/ken-task.md`](docs/ken-task.md),
[`docs/ken-lint.md`](docs/ken-lint.md), [`docs/built-on-top.md`](docs/built-on-top.md).
