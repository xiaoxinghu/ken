# A ken root

A knowledge base, one git repo, with the repos it needs checked out inside it. Start at the
front page, README.md. Sessions start here, at the root, where the hooks and deny rules are:
`ken status` lists the repos and layers at the start, so there is no need to list folders.

## Knowledge

- A section is a folder at the top with a README.md listing its pages, one line each. Make
  one when a topic needs it, and add its line under `## Sections` in README.md.
- A page is a Markdown file in a section, never at the top, linked from the section's README.md.
- A layer is a team's shared section, linked by `ken layer add <key>`: change it in its repo.
- Names starting with `.`, and AGENTS.md, CLAUDE.md, log.md and README.md, are not sections.
- After changing pages, run `ken lint` (`@unclex/ken-lint`, installed beside `ken`), then
  commit: the root is synced by git and nothing else.

## Code

- `.repos/<host>/<owner>/<repo>/` is a clone on its default branch, and
  `.repos/<host>/<owner>/<repo>.<branch>/` a worktree beside it, `/` in the branch as `-`.
- `.repos/index.yaml` lists every repo; `ken get <key>` one not cloned before reading it.
- Name code as `<key>:<path>#<symbol>`, never by a line number or an absolute path.
- `.bin/` holds `ken-<name>` scripts, run as `ken <name>`. `.agents/` holds the hooks every
  harness shares; `.claude/`, `.codex/` and `.pi/` point into it.

## Commands

- `ken path code <key> [<branch>]`: a repo's clone or worktree; `ken path <file>`: the
  README.md chain down to a file. `ken which`: the key and branch of the current folder.
- `ken get <key> [-b <branch>]`: clone the repo, or make the branch's worktree, and print its
  path. `ken repos [<key>]`: every repo the index lists, and what is cloned.
- Everything else is git, run against the path `ken path` prints. `ken help` for the rest.

## Traps

- Claude Code reads AGENTS.md only while no CLAUDE.md is in the folder or above it, so this
  root's CLAUDE.md hides a clone's AGENTS.md: give the clone `CLAUDE.md -> AGENTS.md`, or
  set `instructionFiles: claude-md-and-agents-md` in Claude Code's user settings.
- Auto-memory is one per git repo: every session here shares it. Knowledge goes in a page.
