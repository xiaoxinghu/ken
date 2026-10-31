# Templates

One folder per template, copied verbatim into the new directory before `ken init` runs.
Nothing here is a rule: a template is an opinion about what a fresh root should hold.

- `minimal`: no folder. The root is what `ken init` makes, plus `CLAUDE.md -> AGENTS.md`,
  and assumes nothing about what it is for; an agent grows it from there.
- `claude/`: `minimal` plus `.claude/` hooks, deny rules and skills, and the `.bin/` scripts they call. Not written yet.

npm drops `.gitignore` and symlinks from a published package. So a template stores its
`.gitignore` as `gitignore`, which the copy renames, and holds no symlink: create-ken
links `CLAUDE.md -> AGENTS.md` itself, after `ken init`. Every other file, dotfiles
included, is copied as it is.
