# ken

Your ken: the range of what you know and can reach.

One workspace root, version-controlled, that is a knowledge base. Every git checkout
lives inside it under a hidden `.repos/` folder at `<host>/<owner>/<repo>`, with a
worktree per branch beside the clone. Shared knowledge arrives as layers: other roots of
the same shape, cloned in and linked at the top as sections. A kernel CLI enforces the
few fixed rules; everything else is scripts and skills built on it.

| What                              | Command    | Does                                                |
| --------------------------------- | ---------- | --------------------------------------------------- |
| [`ken`](ken), one POSIX `sh` file | `ken`      | the kernel: layout, index, layers, dispatch         |
| `@unclex/ken-task`, `packages/`   | `ken task` | plain-text tasks in one folder, a worktree per task |
| `@unclex/ken-lint`, `packages/`   | `ken lint` | the knowledge-base lint: indexes, links, references |

Install: `sh ken init ~/ken` makes a root holding a copy at `~/ken/.bin/ken`, then
`ln -s ~/ken/.bin/ken ~/.local/bin/ken`. Or start from a template, a root with an `AGENTS.md`
that tells an agent where the CLI is: `git clone -b template/agents --single-branch
https://github.com/xiaoxinghu/ken ~/ken && ~/ken/.bin/ken init`. The template is
[`templates/agents`](templates/agents), the branch `template/agents`. Its only dependency is
git 2.48 or newer. Its
tests are `test/ken.test.ts`, one command at a time, `test/workspace.test.ts`, a layer that
has a layer walked end to end, and `test/templates.test.ts`; the first two run it under `sh`
and `dash`.

The design is [`docs/prd.md`](docs/prd.md), with [`docs/files.md`](docs/files.md) for the
two files the kernel reads and writes, and [`docs/templates.md`](docs/templates.md) for the
roots to start from. What is built on it: [`docs/ken-task.md`](docs/ken-task.md),
[`docs/ken-lint.md`](docs/ken-lint.md), [`docs/built-on-top.md`](docs/built-on-top.md).
