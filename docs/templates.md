# Templates and harness files

A template is a root to start from, with the kernel it was made with at `.bin/ken`
([PRD](prd.md), decision 19). There is no scaffolding tool: anything that needs to know a
rule is a kernel primitive, and the rest is `git clone`.

A template is a folder of this repo, `templates/<name>/`, so it is edited, tested and
reviewed with the kernel it copies, and also a branch, `template/<name>`, holding that
folder alone with its history: the workflow `.github/workflows/templates.yml` splits it
off with `git subtree split` on every push to `main`, replaces the folder's `.bin/ken` link
to the repo's kernel by a copy of it, force-pushes the branch, and deletes a branch whose
folder is gone. The branches are generated: never commit to one. `test/templates.test.ts`
holds each template to the rules below and installs it the way the workflow publishes it.
There is one, `agents`.

Starting from it is one clone and the kernel it brings, nothing installed first (`jq`, for
the session digests below, is the one tool it uses beyond `sh` and git, and it works without):

```
git clone -b template/agents --single-branch https://github.com/xiaoxinghu/ken ~/ken
~/ken/.bin/ken init
git -C ~/ken remote remove origin
```

then the first commit. `init` fills in what the template left out and overwrites nothing, so
a root made from an older template picks up a newer one by diffing against a fresh clone of
the branch, the agent being the merge tool. Starting from nothing is `ken init ~/ken`: `.ken`,
an empty index and a `.bin/`, which is all a layer needs to be one; `init` writes no page and
no `AGENTS.md`. A template's `.ken` carries `template.name`, a key `ken` keeps.

`ken init` is the default for everyone: a root, or a layer, needs nothing more, and a person
with no agent needs no template. `agents` is the opt-in for a knowledge base kept with an
agent harness: `ken init` plus `README.md`, `AGENTS.md` and `CLAUDE.md -> AGENTS.md`, the
harness files below, hooks, deny rules and `.bin/ken-status`, the session-start script,
`.bin/ken-log`, which appends a line to the root's `log.md` ([PRD](prd.md), the knowledge
base), `.bin/ken-digest` and `.bin/ken-session`, which keep and read the digest of the session
behind a line (below), a `.gitattributes` with `log.md merge=union`, so two machines' appends merge without a
conflict, and `.envrc`. It assumes nothing about what the root is for, not even software. Its
`AGENTS.md` is twenty-one lines: where the CLI is, how to make a section and a page, when to
`ken log`, how to reach a line's session, and nothing `ken help` already says; an agent grows the root from there, `ken help` and the messages. A layer starts
the same way, any root is one, and under a root its harness files sit unused, the root's hooks
and deny rules being the ones that run (PRD decision 21), until it is cloned alone.

## Where the CLI is

A fresh root has nothing visible but `README.md` and `AGENTS.md`, and `ken` is on no PATH
but the one the person who installed it set up. So the agent learns where the CLI is from
the one file every harness reads: the first paragraph of the template's `AGENTS.md` names
`.bin/ken`, says to run it as that when `ken` is not a command, and points at `ken help`.
That alone works in every harness, with no hook and no trust prompt.

The `agents` template goes further where a harness has a way. Its session-start hook runs
`.bin/ken status`, whose stdout every harness puts before the model: the repos and layers,
the settings, the ready tasks, the last 10 lines of `log.md` with the time now, and the
sentence that names the CLI. In Claude Code the hook
also appends an `export PATH=<root>/.bin:$PATH` line to the file `CLAUDE_ENV_FILE` names,
which Claude Code sources before each shell command, so `ken` is a command for the rest of
the session. The script itself calls `ken` by name: dispatch puts the running kernel's
folder first on `PATH` for every `ken-<name>` it runs (decision 10), so a root's hook works
on a machine where nothing was installed. Codex and pi get the context and the `AGENTS.md`
sentence; neither has a documented way to extend the shell's PATH from the project, and an
agent told `.bin/ken` needs none.

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
.claude/skills -> ../.agents/skills   one link, made with the first skill, so Claude Code sees every skill a layer
                               brings (to verify: Claude Code documents a link per skill, not of the folder)
.agents/hooks.json             one hooks object in Claude Code's schema; Codex reads it as it is
.bin/ken-status                the script the session-start hook runs
.bin/ken-log                   `ken log`, which appends to log.md, digesting the session first
.bin/ken-digest                `ken digest`, the session's transcript to .sessions/<id>.md
.bin/ken-session               `ken session`, which prints or greps the digests
.gitattributes                 log.md merge=union
.claude/settings.json          hooks (a copy of the object: a settings file holds other keys) and permissions.deny
.codex/hooks.json -> ../.agents/hooks.json
.pi/extensions/ken-hooks.ts    a shim: reads hooks.json, runs its SessionStart hooks on session_start
```

The hook line is `.bin/ken status`: the kernel is always at `.bin/ken` (decision 19), every
harness runs a hook with the root as its working directory, and the command resolves through
decision 10, so the script behind `status` can move from the root's `.bin/` to a layer's or
to a package on `PATH` and update by `git pull` or an upgrade, while the hook files never
change; Codex and pi pin hooks by hash, so a hook file that never changes is never
re-trusted. The adapters change rarely; when they do, a diff against the template branch
carries the change into an existing root. Codex and pi load a project's hooks, skills and
extensions only after a trust prompt, which the first-run message says; Codex then asks again
for the hooks. pi has no way to put a `session_start` handler's output before the model, so
the shim sends the `SessionStart` output with the first prompt. A deny rule is Claude Code's
alone. Hooks and skills reach scripts as `ken <name>`.

A layer contributes commands and skills, never hooks or deny rules (PRD decision 21): the
root's one hook line calls `.bin/ken status`, and what a layer wants run at session start is
a command that script calls.

**Sessions start at the root**: that is where the hooks, skills and deny rules live, and the
only layout a harness that walks down from the git root understands. A session that must
start in a clone gets the root's skills and hooks as a plugin enabled at user scope. Two
documented traps: Claude Code reads `AGENTS.md` natively only while no `CLAUDE.md` exists in
the working directory or above it, so an ancestor `CLAUDE.md` hides a clone's `AGENTS.md`
unless the clone has `CLAUDE.md -> AGENTS.md`, or the user sets `instructionFiles` to
`claude-md-and-agents-md` in their user settings, under the builtin plugin's options
(`pluginConfigs."cc-plugin-agents-md@builtin".options`; project settings ignore it); and
auto-memory is keyed on the git repo, so every session at the root shares one memory.

## Session digests

The session-start hook's stdin carries `session_id` and `transcript_path` in Claude Code and
Codex. `ken status` exports them as `KEN_SESSION` and `KEN_SESSION_TRANSCRIPT` through
`CLAUDE_ENV_FILE`; with no env file, as in Codex, it writes them to `.ken-session`, git-ignored,
which `ken log` reads when the environment has none; two plain sessions in one folder share
that file, which flow avoids with a worktree per task. pi's shim sends neither yet, so its
hook removes the file, and a pi session gets no digest unless `ken digest <transcript>` is run
by hand. `ken log` then runs
`ken digest`, which rewrites `.sessions/<id>.md` from the transcript and is idempotent, so the
digest is current at every line and lands in the same commit; a session that logs nothing gets
none, and the tail after its last line is not kept. Claude Code's file keeps a rewound branch,
so its digest does too, in file order; pi's is the path from the last entry back to the root,
a `branch_summary` on it one line; a compaction is one line in each. The transcripts are JSON
lines, and the script is `sh` around one `jq` program, the one dependency the template adds
beyond the kernel's (PRD decision 18): macOS, the Linux distributions and the CI runners ship
it, and without it `ken digest` says what to install and `ken log` logs the line anyway. A line
that is not JSON, one still being written, is skipped. Size and retention are decided when they
bite, as for `log.md`.

## Environment

Environment is direnv's job, in the person's terminal. The root `.envrc` is the top of a
chain: `.repos/<host>/<owner>/.envrc` with `source_up_if_exists` and `dotenv_if_exists`, so a
worktree without an `.envrc` of its own inherits the owner's and the root's. A
`[whitelist] prefix = ["~/ken"]` in `direnv.toml` removes per-worktree `direnv allow`. The
root `.envrc` points socket-creating tools at `$TMPDIR` (`OVERMIND_SOCKET`, `PGHOST`, ssh
`ControlPath`), because a Unix socket path is limited to 104 bytes on macOS and the longest
worktree path here is near 90. An agent harness reads env at startup, its shell runs no
direnv and keeps no `export` between commands, so setup commands and skills run
`direnv exec . <cmd>` when a repo needs its own environment; what every command of a
session needs, such as `PATH`, goes through the hook and `CLAUDE_ENV_FILE` above.
