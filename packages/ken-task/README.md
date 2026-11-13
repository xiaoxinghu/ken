# @unclex/ken-task

Plain-text tasks in one folder of a ken root, one file per task, the file's path as its
identity, a branch and worktree per task. Bundled in `@unclex/ken`, which runs it as `ken
task <command>`, with `KEN_ROOT` set to the root. Reads `task.folder` from the root's `.ken`, is
built on `ken which`, `ken path code` and `ken get -b`, and runs git for the rest. See `docs/ken-task.md` at the repo root.
