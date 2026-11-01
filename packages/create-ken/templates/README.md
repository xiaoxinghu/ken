# Templates

One folder per template, copied verbatim into the new directory before `ken init` runs.
Nothing here is a rule: a template is an opinion about what a fresh root should hold.

- `minimal`: no folder. The root is what `ken init` makes, plus `CLAUDE.md -> AGENTS.md`,
  and assumes nothing about what it is for; an agent grows it from there.
- `agents/`: `minimal` plus the harness files the PRD lists under "`create-ken`": an
  `AGENTS.md` that replaces `ken init`'s, `.agents/hooks.json`, the `.bin/ken-status` script
  its session-start hook runs, `.bin/ken-lint` (the knowledge-base lint, `ken lint`), and one thin adapter each for Claude Code
  (`.claude/settings.json`: a copy of the hooks, and the deny rules), Codex
  (`.codex/hooks.json`, a link) and pi (`.pi/extensions/ken-hooks.ts`). `agents.test.ts` keeps
  the two hooks objects equal and runs the status script; `ken-lint.test.ts` seeds one of
  each problem the lint reports.

npm drops `.gitignore` and symlinks from a published package. So a template stores its
`.gitignore` as `gitignore`, which the copy renames, and holds no symlink: create-ken
links `CLAUDE.md -> AGENTS.md` and `.codex/hooks.json -> ../.agents/hooks.json` itself, after
`ken init`, each when its target is there. Every other file, dotfiles
included, is copied as it is.
