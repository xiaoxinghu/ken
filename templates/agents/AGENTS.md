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
- Run `ken lint` after changing pages, then commit: git is the only sync.
- After an ingest, an answered question, a page, task, promote or layer change, run
  `ken log <kind> <subject> <what>` before the commit. `ken status` shows the recent lines; grep
  `log.md` for older ones, never read it whole.
- A log line ending in `s=<id>` names its session's digest: run `ken session <id>` when the line
  is not enough, `ken session grep <pattern>` to search them; never list or read `.sessions/`.
- A clone gets `CLAUDE.md -> AGENTS.md`: this root's CLAUDE.md hides a clone's AGENTS.md from
  Claude Code.
- Auto-memory is shared by every session at this root: knowledge goes in a page.
