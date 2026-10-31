# ken

Your ken: the range of what you know and can reach.

One workspace root, version-controlled, that is a knowledge base. Every git checkout
lives inside it under a hidden `.repos/` folder at `<host>/<owner>/<repo>`, with a
worktree per branch beside the clone. Shared knowledge arrives as layers: other roots of
the same shape, cloned in and linked at the top as sections. A kernel CLI enforces the
few fixed rules; everything else is scripts and skills built on it.

| Package            | Command          | What                                                  |
| ------------------ | ---------------- | ----------------------------------------------------- |
| `@unclex/ken`      | `ken`            | the kernel: layout, index, layers, dispatch           |
| `@unclex/ken-task` | `ken task`       | plain-text tasks in denote names, a worktree per task |
| `create-ken`       | `npm create ken` | scaffold a root from a template; any root is a layer  |

The design is `docs/prd.md`. Nothing is implemented yet.
