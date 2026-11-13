# Built on top

What ken ([PRD](prd.md)) leaves to scripts, skills and hooks. None of it is in any package
here: the standard commands, `status`, `log`, `digest`, `session`, `task` and `lint`, are
ken's own (PRD, The standard commands). Scripts live in a root's `.bin/`, or in a package on
`PATH`, and are reached as `ken <name>` ([extensions](extensions.md)); skills hold judgment
and call scripts and primitives for every fact; hooks are one line each and call commands.
Skills are tested with golden questions: ten to twenty real past questions with known
answers, run through a fresh session at the root and scored, rerun after a docs, skill or
model change.

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
- **Promote**: a settled note moves from a task to a page; `ken log promote <path>`. A page
  for a team's root is copied into a worktree of that root's clone and goes in by its PR.

## The pieces

| Piece                                                                  | Built from                                                                                                                                                                      |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| deny rules in the root's `.claude/settings.json`, Claude Code only     | `.repos/**/node_modules/**`, `dist`, `.next`, `coverage`, lockfiles: the checkouts are under the root, so the rules name them by a relative path.                               |
| `ken-doctor`                                                           | `repos` plus `gh` for remote states (listed but not on the remote is a typo or a deleted repo), the lint, the strays `repos` names, clones with `AGENTS.md` and no `CLAUDE.md`. |
| `ken-pull`                                                             | entries for unlisted clones, `desc` from `gh repo view`, through `index set`; repairs the one race, two agents cloning in the same second.                                      |
| `ken-grep`                                                             | `rg` over cloned repos, paths passed explicitly; names the uncloned.                                                                                                            |
| `ken-jira`                                                             | Jira issue picker into `get <key> -b <issue>`; no task file involved.                                                                                                           |
| worktree setup                                                         | files to copy from the clone and a setup command for a new worktree, run by the task tool after `get -b` returns (decision 17).                                                 |
| skills: `start-task`, `where-is`, `ingest`, `kb`, `capture`, `promote` | the flows above. A team's playbooks are skills in its root.                                                                                                                     |

The harness files that run these, hooks, adapters and deny rules, are `create-ken`'s: see [templates](templates.md). Tasks are [`ken-task`](ken-task.md); the lint is
[`ken-lint`](ken-lint.md).
