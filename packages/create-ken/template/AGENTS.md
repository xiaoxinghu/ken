# A ken root

This is a ken root, a knowledge base. Its CLI is `ken`: `ken help` lists the commands, with
examples, and when `ken` is not a command, `npm install -g @unclex/ken` installs it.
`ken status` is the overview the session-start hook printed. README.md, the front page, says
what the root is for.

- A section is a top-level folder with a README.md listing its pages, Markdown files, one line
  each; a new section's line goes under `## Sections` in README.md. No page sits at the top.
- Name code the way `ken path` reads it, `<key>:<path>#<symbol>`, never by line number or
  absolute path.
- Run `ken lint` after changing pages, then commit when the root is in git.
- After an ingest, an answered question, a page or a task, run `ken log <kind> <subject> <what>`
  before the commit. `ken status` shows the recent lines; grep `log.md` for older ones, never
  read it whole.
- A log line ending in `s=<id>` names its session's digest: when the line is not enough,
  `ken session <id>` prints its last entries and `ken session <id> <range>` others;
  `grep -il <pattern> .sessions/*.jsonl` finds the sessions that mention something.
- A checkout in `.repos/` needs `CLAUDE.md -> AGENTS.md`, which `ken get` makes in a fresh one:
  this root's `CLAUDE.md` hides a checkout's AGENTS.md from Claude Code.
- A skill goes in `.agents/skills/<name>/SKILL.md`; with the first one, make the link
  `.claude/skills -> ../.agents/skills` for Claude Code.
- Auto-memory is shared by every session at this root: knowledge goes in a page.
