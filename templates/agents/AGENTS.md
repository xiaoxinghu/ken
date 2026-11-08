# A ken root

The CLI is `ken`, and `.bin/ken` here is a copy: run that when `ken` is not a command. `ken help`
says what it does, with examples: the repos this root uses, cloned on demand, their paths, its
layers, and the commands in `.bin/`. `ken status` is the overview the session-start hook
printed. README.md, the front page, says what the root is for.

- A section is a top-level folder with a README.md listing its pages, Markdown files, one line
  each; a new section's line goes under `## Sections` in README.md.
- A layer is a section linked from another root's clone: change it in that repo.
- Name code the way `ken path` reads it, `<key>:<path>#<symbol>`, never by line number or
  absolute path.
- Run `ken lint` after changing pages, then commit when the root is in git.
- After an ingest, an answered question, a page, task, promote or layer change, run
  `ken log <kind> <subject> <what>` before the commit. `ken status` shows the recent lines; grep
  `log.md` for older ones, never read it whole.
- A log line ending in `s=<id>` names its session's digest: when the line is not enough,
  `ken session <id>` prints its last entries, `ken session <id> <range>` others, and
  `ken session grep <pattern>` searches them all; never list or read `.sessions/`.
- A checkout needs `CLAUDE.md -> AGENTS.md`, which `ken get` makes in a fresh one:
  `$KEN_SRC/CLAUDE.md`, this root's rules, hides a clone's AGENTS.md from Claude Code.
- Auto-memory is shared by every session at this root: knowledge goes in a page.
