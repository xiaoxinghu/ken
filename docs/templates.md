# Templates and harness files

A root for an agent harness starts from `create-ken`, run as `npm create ken <dir>`
([PRD](prd.md), decision 19). The core knows no harness, so the files that make a root work
with one are this package's, not `ken init`'s. `ken init` alone is the default for a person
with no agent: `.ken`, an empty index and `.gitignore`, which is all a root needs to be one.

## What `create-ken` does

1. Copies its template into `<dir>`, default the current folder, never overwriting, saying
   each file it made and each it left alone.
2. Runs `ken init <dir>` through `@unclex/ken`, its dependency at the same version, and adds
   `template.name=agents` to `.ken`, a key `ken` keeps.
3. Says what to do next: the install line when `ken` is not on `PATH`, `git init` when the
   folder is not in git, the first commit.

A rerun adds what is missing, so a root picks up a file a newer template added. A file that
differs from the template is left alone and named, for its owner or an agent to compare:
that is the update path, and since every file is constant, a root that never edited one has
nothing to merge. The package's tests hold the template to the rules here.

## The files

```
README.md                      the front page, with `## Sections`
AGENTS.md                      < 40 lines, every harness; Claude Code only while no CLAUDE.md is above it
CLAUDE.md -> AGENTS.md         made at run time: an npm package carries no link
.agents/hooks.json             the session-start hook, in Claude Code's schema; Codex reads it as it is
.claude/settings.json          the same hook: a settings file holds other keys, such as permissions.deny
.codex/hooks.json -> ../.agents/hooks.json   made at run time, as CLAUDE.md is
.pi/extensions/ken-hooks.ts    a shim: reads hooks.json, runs its SessionStart hooks on session_start
.gitattributes                 log.md merge=union
.gitignore                     .env, CLAUDE.local.md, node_modules; kept in the package under another
                               name, since npm leaves a .gitignore out, and written as .gitignore
.envrc                         the top of the direnv chain (Environment, below)
```

It assumes nothing about what the root is for, not even software. No `.bin/`: the commands
it relies on, `ken status`, `ken log`, `ken digest`, `ken session`, are the standard ones,
bundled with ken ([PRD](prd.md), decision 11), and a root's `.bin/` is for what the root
writes itself. Its `AGENTS.md` says where the CLI is, how to make a section and a page,
when to `ken log`, how to reach a line's session, and nothing `ken help` already says; an
agent grows the root from there, `ken help` and the messages.

## Where the CLI is

`ken` is installed once per machine, on `PATH`. A fresh root shows nothing but `README.md`
and `AGENTS.md`, so the agent learns about the CLI from the one file every harness reads:
the first paragraph of the template's `AGENTS.md` says this is a ken root, the CLI is `ken`,
`ken help` lists the commands, and, when `ken` is not a command, the line that installs it,
`npm install -g @unclex/ken`. That alone works in every harness, with no hook and no trust
prompt.

The template goes further where a harness has a way. Its session-start hook runs `ken
status`, whose stdout every harness puts before the model: the repos, the settings, the
ready tasks, the last 10 lines of `log.md` with the time now, and the sentence that names
the CLI. In Claude Code, `ken status` also appends to the file `CLAUDE_ENV_FILE` names,
which Claude Code sources before each shell command, an `export PATH=<root>/.bin:$PATH`, so
the root's own tools run by name, and the session's two variables (Session digests, below).
It exports no `KEN_ROOT`: a checkout is under the root, so `ken` finds it from anywhere in
a session (PRD, decision 9). Codex and pi get the context and the `AGENTS.md` sentence;
neither has a documented way to extend the shell's `PATH` from the project.

## Harness files

Two of the four surfaces a harness reads have a standard every harness checked honours
(Claude Code, Codex and pi; OpenCode, Gemini CLI, Cursor and Copilot CLI on most of it):
`AGENTS.md` for instructions and `.agents/skills/<name>/SKILL.md` for skills, the Agent
Skills specification. Hooks have a de facto one: Codex reads Claude Code's hooks schema and
stdin/stdout contract unchanged, Cursor and Copilot read `.claude/settings.json` hooks
directly, and pi has no hook file, only TypeScript extensions. Deny rules and `PATH` have
nothing shared. So the template keeps one source for each shared surface and one thin
adapter per harness, each pointing at the shared file. A root's skills go in
`.agents/skills/<name>/`, which Codex and pi read, with `.claude/skills ->
../.agents/skills` made with the first one for Claude Code (to verify: Claude Code documents
a link per skill, not of the folder).

**The hook is one constant line**, the same in every root and every harness:

```
if command -v ken >/dev/null 2>&1; then ken status; else echo 'This is a ken root, and ken is not installed: run npm install -g @unclex/ken, then start a new session.'; fi
```

A hook runs from the folder the session started in, and `ken` finds the root from there,
from a checkout under `.repos/` too. When `ken` is missing the line prints the install line
as the session's context and exits 0, since a session-start command that fails can stop a
harness from starting a session at all. What `status` does is the installed ken's, so it
changes with an upgrade and the hook files never do; Codex and pi pin hooks by hash, so a
hook that never changes is never re-trusted. Codex and pi load a project's hooks, skills
and extensions only after a trust prompt, which the first-run message says; Codex then asks
again for the hooks. pi has no way to put a `session_start` handler's output before the
model, so the shim sends the `SessionStart` output with the first prompt. A deny rule is
Claude Code's alone. Hooks and skills reach commands as `ken <name>`.

**Sessions start at the root**, or in a checkout under it. At the root are the hooks, skills
and deny rules, and it is the only layout a harness that walks down from the git root
understands. A session in a checkout loads the root's `AGENTS.md` by the path, the root
being above it (PRD, decision 6), in Claude Code and pi; Codex reads `AGENTS.md` only from
the checkout's own git root down, so there the root's rules come from the user-level
`~/.codex/AGENTS.md` or not at all. Its hooks and deny rules come from a launcher that starts
it with the root's settings named, `claude --settings <root>/.claude/settings.json` or `pi
-e <root>/.pi/extensions/ken-hooks.ts`, since a harness reads those only from the folder a
session starts in. Two documented traps: Claude Code reads `AGENTS.md` natively only while
no `CLAUDE.md` exists in the working directory or above it, so the root's `CLAUDE.md` hides
a checkout's `AGENTS.md` unless the checkout has `CLAUDE.md -> AGENTS.md`, which `ken get`
gives a fresh one, or the user sets `instructionFiles` to `claude-md-and-agents-md` in
their user settings, under the builtin plugin's options
(`pluginConfigs."cc-plugin-agents-md@builtin".options`; project settings ignore it); and
auto-memory is keyed on the git repo, so every session at the root shares one memory.

## Session digests

The session-start hook's stdin carries `session_id` and `transcript_path` in Claude Code and
Codex. `ken status` exports them as `KEN_SESSION` and `KEN_SESSION_TRANSCRIPT` through
`CLAUDE_ENV_FILE`; with no env file, as in Codex, it writes them to a pointer,
`~/.local/state/ken/<root as a path with / as ->`, which `ken log` reads when the environment
has none. The pointer is machine-local state, so it is out of the root, where a file sync
would carry one machine's session to another (PRD, decision 8); two such sessions of one
root share it. pi's shim sends neither yet, so its hook removes the pointer, and a pi
session gets no digest unless `ken digest <transcript>` is run by hand. `ken log` then runs
`ken digest`, which rewrites `.sessions/<id>.jsonl` from the transcript and is idempotent,
so the digest is current at every line and lands in the same commit; a session that logs
nothing gets none, and the tail after its last line is not kept. Claude Code's file keeps a
rewound branch, so its digest does too, in file order; pi's is the path from the last entry
back to the root, a `branch_summary` on it a `compaction` entry; a compaction is one in
each, its `summary` the harness's note and never the model's summary, since a digest is what
happened.

The digest is a log read by a program, so it is one JSON object per line: a header,
`{"kind":"session","session":…,"harness":…,"started":…,"cwd":…}`, then entries, `id` their
ordinal from 1, `at` the transcript's time or the one before it, and `kind`: `user` with
`text`; `assistant` with `text`, `toolCalls` of `{id, name, input}`, `input` the call's
arguments as JSON cut at 120 characters, and `error` for a failed response; `compaction`
with `summary`. Claude Code writes a reply as one transcript entry per content block sharing
`message.id`, merged into one; a Codex tool call joins the reply before it. The shape is the
ghost's in github.com/justfiles/justfiles, `justfiles:packages/ghost/mirror.ts#MirroredEntry`,
whose mirror took this content policy, and `ken session` renders it as the ghost's
transcript tool shows it: a header line, then the last 20 entries, or a `<range>`, `12`,
`12-30` or `1-`, as `#n HH:MM user: …`, `#n HH:MM assistant: …` and one `#n HH:MM → <name>
<input>` per tool call, in local time with a day line where the day changes. A search of
every digest is grep's, over the files, `grep -il <pattern> .sessions/*.jsonl`: one entry per
line, its text JSON-escaped, so ken holds no search of its own. One format for two tools; a
shared library waits for a third writer. A `.sessions/<id>.md` from before is printed whole.

The transcripts are JSON lines, read with `JSON.parse`, so nothing beyond ken is needed. A
line that is not JSON, one still being written, is skipped. Size and retention are decided
when they bite, as for `log.md`.

## Environment

Environment is direnv's job, in the person's terminal. The root `.envrc` is the top of the
chain: direnv loads the nearest `.envrc` above the current folder, so a checkout under
`.repos/` without one of its own gets the root's, and one with its own reaches the root's
with `source_up_if_exists`. `direnv allow` once at the root, and a `[whitelist] prefix` of
the root's `.repos` in `direnv.toml` removes the per-worktree `direnv allow` for checkouts
with their own. The root `.envrc` points socket-creating tools at `$TMPDIR`
(`OVERMIND_SOCKET`, `PGHOST`, ssh `ControlPath`), because a Unix socket path is limited to
104 bytes on macOS and the longest worktree path is near 90. An agent harness reads env at
startup, its shell runs no direnv and keeps no `export` between commands, so setup commands
and skills run `direnv exec . <cmd>` when a repo needs its own environment; what every
command of a session needs, such as `PATH`, goes through the hook and `CLAUDE_ENV_FILE`
above.
