# ken

A ken root: a knowledge base with every git checkout inside it. Start at the front page,
README.md, which lists the sections and layers; each folder's README.md indexes its pages.

## Layout

- Folders at the top are sections: `systems/`, `flows/`, `playbooks/`, `decisions/`. A
  layer is a section linked to the clone of a shared repo; change it there, by PR.
- `.repos/<host>/<owner>/<repo>/` is a clone on its default branch, and
  `.repos/<host>/<owner>/<repo>.<branch>/` a worktree beside it, `/` in the branch as `-`.
- `.repos/index.yaml` describes every repo, cloned or not. `.ken.yaml` holds settings.
- `.bin/` holds `ken-<name>` scripts, run as `ken <name>`.

## Writing knowledge

- A page lives in one section and has one line in its README.md. Name repos by key and
  code as `<key>:<path>#<symbol>`: never a line number or an absolute path.
- A page about one repo belongs in that repo's README.md, not here.
- Append one dated line per change to log.md; grep it, never read it whole.

## Commands

- `ken path code <key> [<branch>]`: the clone or worktree of a repo key such as
  github.com/acme/join-web. `ken path <file>`: the README.md chain down to a file.
- `ken which`: the repo key and branch of the current folder.
- `ken get <key> [-b <branch>]`: clone the repo, or make the branch's worktree, and print
  its path. The one way code gets into `.repos/`.
- `ken repos [<key>]`: every repo the index lists, and what is cloned.

Everything else is git, run against the path `ken path` prints. `ken help` for the rest.
