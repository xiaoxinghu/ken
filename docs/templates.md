# Templates and harness files

A template is a root, pushed somewhere, with the kernel it was made with at `.bin/ken`
([PRD](prd.md), decision 19). There is no scaffolding tool: anything that needs to know a
rule is a kernel primitive, and the rest is `git clone`.

Starting from a template is `git clone <template> ~/ken && ~/ken/.bin/ken init`, then
`git remote remove origin` and the first commit. `init` fills in what the template left out
and overwrites nothing, so a root made from an older template picks up a newer one by
diffing against the template's clone, the agent being the merge tool. Starting from nothing
is `ken init ~/ken`: `.ken`, an empty index and a `.bin/`, which is all a layer needs to be
one; `init` writes no page. A template's `.ken` carries `template.name`, a key `ken` keeps.

| Template  | Holds                                                                                                        |
| --------- | ------------------------------------------------------------------------------------------------------------ |
| `minimal` | `ken init` plus `README.md`, `AGENTS.md` and `CLAUDE.md -> AGENTS.md`: no sections, no `log.md`, no `.envrc` |
| `agents`  | `minimal` plus `.envrc`, the harness files below, hooks, deny rules, skills, and the `.bin/` scripts         |

`minimal` is the hello world: it assumes nothing about what the root is for, not even
software. Its `AGENTS.md` says how to make a section and a page; an agent grows the root
from there, `ken help` and the messages. A layer starts the same way: any root is one.

## Harness files

Two of the four surfaces a harness reads have a standard every harness checked honours
(Claude Code, Codex and pi; OpenCode, Gemini CLI, Cursor and Copilot CLI on most of it):
`AGENTS.md` for instructions and `.agents/skills/<name>/SKILL.md` for skills, the Agent
Skills specification. Hooks have a de facto one: Codex reads Claude Code's hooks schema and
stdin/stdout contract unchanged, Cursor and Copilot read `.claude/settings.json` hooks
directly, and pi has no hook file, only TypeScript extensions. Deny rules and `PATH` have
nothing shared. So the `agents` template keeps one source for each shared surface and one
thin adapter per harness, each pointing at the shared file:

```
AGENTS.md                      every harness; Claude Code only while no CLAUDE.md is above it, so the link stays
.agents/skills/<name>/         Codex and pi read it; a direct layer's skills are linked here by ken (PRD decision 21)
.claude/skills -> ../.agents/skills   one link, so Claude Code sees every skill a layer brings (to verify: a folder link)
.agents/hooks.json             one hooks object in Claude Code's schema; Codex reads it as it is
.bin/ken-status                the script the session-start hook runs
.claude/settings.json          hooks (a copy of the object: a settings file holds other keys) and permissions.deny
.codex/hooks.json -> ../.agents/hooks.json
.pi/extensions/ken-hooks.ts    a shim: reads hooks.json, runs its SessionStart hooks on session_start
```

Hook lines name commands, `ken status`, not script paths. A command resolves through
decision 10, so the script behind it can move from the root's `.bin/` to a layer's or to a
package on `PATH` and update by `git pull` or an upgrade, while the hook files never change;
Codex and pi pin hooks by hash, so a hook file that never changes is never re-trusted. The
adapters change rarely; when they do, a diff against the template's clone carries the
change into an existing root. Codex and pi load a project's hooks, skills and extensions
only after a trust prompt, which the first-run message says; Codex then asks again for the
hooks. pi has no way to put a `session_start` handler's output before the model, so the
shim sends the `SessionStart` output with the first prompt. A deny rule is Claude Code's
alone. Nothing in the template puts `.bin/` on `PATH`: hooks and skills reach scripts as
`ken <name>`, so only `ken` must be on the `PATH` of the shell that starts the harness.

A layer contributes commands and skills, never hooks or deny rules (PRD decision 21): the
root's one hook line calls `ken status`, and what a layer wants run at session start is a
command that script calls.

**Sessions start at the root**: that is where the hooks, skills and deny rules live, and the
only layout a harness that walks down from the git root understands. A session that must
start in a clone gets the root's skills and hooks as a plugin enabled at user scope. Two
documented traps: Claude Code reads `AGENTS.md` natively only while no `CLAUDE.md` exists
in the working directory or above it (its default `instructionFiles`), so an ancestor
`CLAUDE.md` hides a clone's `AGENTS.md` unless the clone has `CLAUDE.md -> AGENTS.md` or the
user sets `instructionFiles: claude-md-and-agents-md`; and auto-memory is keyed on the git
repo, so every session at the root shares one memory.

## Environment

Environment is direnv's job. The root `.envrc` is the top of a chain:
`.repos/<host>/<owner>/.envrc` with `source_up_if_exists` and `dotenv_if_exists`, so a
worktree without an `.envrc` of its own inherits the owner's and the root's. A
`[whitelist] prefix = ["~/ken"]` in `direnv.toml` removes per-worktree `direnv allow`. The
root `.envrc` points socket-creating tools at `$TMPDIR` (`OVERMIND_SOCKET`, `PGHOST`, ssh
`ControlPath`), because a Unix socket path is limited to 104 bytes on macOS and the longest
worktree path here is near 90. An agent harness reads env at startup and its shell does not
re-run direnv on `cd`, so setup commands and skills run `direnv exec . <cmd>` when a repo
needs its own environment.
