# Built on top

What the kernel ([PRD](prd.md)) leaves to scripts, skills and hooks. None of it is in any
package here. Scripts live in `.bin/` of a root or a layer and reach `ken` as `ken <name>`
(decision 10); skills hold judgment and call scripts and primitives for every fact; hooks
are one line each and call commands. Skills are tested with golden questions: ten to twenty
real past questions with known answers, run through a fresh session at the root and scored,
rerun after a docs, skill or model change.

## The flows

- **Ingest a repo**: clone lazily if needed; read its README, manifests, top-level tree and
  `AGENTS.md`; write `desc`, `kind`, `tags` through `ken index set`; `ken log ingest <key>`.
  If the repo lacks a README or does not say how to run, the follow-up is a task on that repo.
- **Ingest a source**: read it; write a page in the right section naming the repos it
  concerns by key; add its line to the section README, and to the front page only if a
  section was added; revise related pages; `ken log ingest <path>`. The source is cited, not
  copied.
- **Query**: front page, section, page, code; cite; file a good answer back;
  `ken log query <path>`.
- **Promote**: a settled note moves from a task to a page, or from the root to a layer;
  `ken log promote <path>`.

## The pieces

| Piece                                                                  | Built from                                                                                                                                                                                                                                  |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ken-status`, run by the session-start hook as `.bin/ken status`       | `repos`, `.ken`, `ken task ready`, the last 10 lines of `log.md` sorted: one screen so the agent never lists folders. A repo it shows as not cloned is the agent's to `ken get` before reading in it: no hook clones behind a tool.         |
| `ken-log`, as `ken log <kind> <subject> <what>`                        | `date` and `>>`: one line on the root's `log.md`, stamped with local time and offset, the kind checked against the closed list, a subject with a space or multi-line text refused.                                                          |
| `ken-digest`, as `ken digest [<transcript>]`, run by `ken log`         | one `jq` program over a Claude Code, pi or Codex transcript: `.sessions/<id>.md` written whole, prompts, replies and `- <tool> <head of input>`, no tool results; the line gets ` s=<id>`. Without `jq`, a message, and the line is logged. |
| `ken-session`, as `ken session <id>` and `ken session grep <pattern>`  | `cat` and `grep` over `.sessions/`: the story behind a log line's `s=<id>`.                                                                                                                                                                 |
| deny rules in the root's `.claude/settings.json`, Claude Code only     | `.repos/**/node_modules/**`, `dist`, `.next`, `coverage`, lockfiles.                                                                                                                                                                        |
| `ken-doctor`                                                           | `repos` plus `gh` for remote states (listed but not on the remote is a typo or a deleted repo), the lint, the strays `repos` names, clones with `AGENTS.md` and no `CLAUDE.md`, layers behind upstream.                                     |
| `ken-pull`                                                             | entries for unlisted clones, `desc` from `gh repo view`, through `index set`; repairs the one race, two agents cloning in the same second.                                                                                                  |
| `ken-grep`                                                             | `rg` over cloned repos in scope, paths passed explicitly; names the uncloned.                                                                                                                                                               |
| `ken-promote`                                                          | `git mv` into a worktree of the layer, the entry deleted from the index here, `cd` there and `index set`.                                                                                                                                   |
| `ken-jira`                                                             | Jira issue picker into `get <key> -b <issue>`; no task file involved.                                                                                                                                                                       |
| worktree setup                                                         | files to copy from the clone and a setup command for a new worktree, run by the task tool after `get -b` returns (decision 12).                                                                                                             |
| skills: `start-task`, `where-is`, `ingest`, `kb`, `capture`, `promote` | the flows above. A team's playbooks are skills in its layer.                                                                                                                                                                                |

The harness files that run these, hooks, adapters and deny rules, are the `agents`
template's: see [templates](templates.md). Tasks are [`ken-task`](ken-task.md); the lint is
[`ken-lint`](ken-lint.md).
