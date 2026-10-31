# Templates

One folder per template, copied verbatim into the new directory before `ken init` runs.
Nothing here is a rule: a template is an opinion about what a fresh root should hold.

- `minimal/`: the kernel alone. A front page, `AGENTS.md` and `CLAUDE.md -> AGENTS.md`,
  `.ken.yaml` with commented examples, `.gitignore`, `.envrc`, `log.md`, and the sections
  `systems/`, `flows/`, `playbooks/`, `decisions/`, each with a `README.md` and no pages.
- `claude/`: `minimal` plus `.claude/` hooks, deny rules and skills, and the `.bin/` scripts they call. Not written yet.
- `layer/`: the shape of a shareable layer: a front page, sections, `.repos/index.yaml`, `.bin/`, no private sections. Not written yet.

npm drops `.gitignore` and symlinks from a published package, so a template holds neither:
its `.gitignore` is stored as `gitignore`, and `CLAUDE.md` is not stored at all. The copy
renames `gitignore` to `.gitignore` and links `CLAUDE.md -> AGENTS.md` beside the
template's top-level `AGENTS.md`. Every other file, dotfiles included, is copied as it is.
