# A ken root

The CLI is `ken`, and `.bin/ken` here is a copy: run that when `ken` is not a command. `ken help`
says what it does, with examples: the repos this root uses, cloned on demand, their paths, and
its layers. README.md, the front page, says what the root is for.

- A section is a top-level folder with a README.md listing its pages, Markdown files, one line
  each; a new section's line goes under `## Sections` in README.md.
- A layer is a section linked from another root's clone: change it in that repo.
- Name code the way `ken path` reads it, `<key>:<path>#<symbol>`, never by line number or
  absolute path.
- Commit what you change: git is the only sync.
