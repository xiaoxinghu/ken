# Templates

One folder per template, copied verbatim into the new directory before `ken init` runs.
Nothing here is a rule: a template is an opinion about what a fresh root should hold.

- `minimal/`: the kernel alone. A front page, `AGENTS.md`, `.ken.yaml`, `.gitignore`.
- `claude/`: `minimal` plus `.claude/` hooks, deny rules and skills, and the `.bin/` scripts they call.
- `layer/`: the shape of a shareable layer: a front page, sections, `.repos/index.yaml`, `.bin/`, no private sections.

Not written yet.
