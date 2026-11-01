# Templates

One folder per template, copied verbatim into the new directory before `ken init` runs.
Nothing here is a rule: a template is an opinion about what a fresh root should hold.

- `minimal`: no folder. The root is what `ken init` makes, plus `CLAUDE.md -> AGENTS.md`,
  and assumes nothing about what it is for; an agent grows it from there.
- `agents/`: `minimal` plus the harness files the PRD lists under "`create-ken`": `AGENTS.md`,
  `.agents/` skills and hooks, the `.bin/` scripts they run, and one thin adapter each for
  Claude Code, Codex and pi. Not written yet.

npm drops `.gitignore` and symlinks from a published package. So a template stores its
`.gitignore` as `gitignore`, which the copy renames, and holds no symlink: create-ken
links `CLAUDE.md -> AGENTS.md` itself, after `ken init`. Every other file, dotfiles
included, is copied as it is.
