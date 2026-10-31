# ken — PRD

`ken`: the range of what one knows and can reach. A workspace root that is a knowledge
base, with every git checkout inside it, shared knowledge arriving as layers, and a kernel
CLI that enforces the few rules which never change. This document says what the system
does; while nothing is implemented it says what the first release does, and from then on
it changes in the same PR as the behaviour. Git is its history.

## Problem

Work with agents spans many repositories, and the knowledge that ties them together, how
systems fit, which repo does what, why a decision was made, where the logs are, belongs to
no single repository. Today it is scattered: a `~/code` tree an agent cannot navigate
without pasted absolute paths, context files that do not cascade, notes in a private
folder, team docs in a wiki nobody reads. Each agent session starts from zero and is told
where things are by hand.

Three audiences want one answer:

- **An individual** wants one place to start every session, with their own private notes
  and tasks version-controlled, every repo reachable by name, and context that loads in the
  right order without being pasted.
- **A team** wants a curated, shared knowledge base over its repositories that any member,
  and any member's agent, can install and keep current, and contribute to without exposing
  anyone's private notes.
- **A tool user** wants only parts of this: the repo layout with Jira for tasks, or the
  knowledge base with no code at all. Nothing may require everything.

## The shape

The whole root is the knowledge base. Everything that is not knowledge has a reserved,
hidden name.

```
~/ken/                             your root: one git repo, private. KEN_ROOT.
  README.md                        the front page: evergreen pages, one line per section
  AGENTS.md                        < 40 lines: the layout, the commands, pointers
  CLAUDE.md -> AGENTS.md
  log.md                           append-only, one dated line per change
  systems/  flows/  playbooks/  decisions/     sections, each with its own README.md
  sales-atlas -> .repos/github.com/acme/sales-atlas    a layer: its clone, as a section
  me/                              a section one tool owns: the task volume (ken-task)
  .ken.yaml                        layers by name and key, orgs, a section per tool
  .gitignore                       .repos/*/*/*/   .env
  .envrc                           direnv root: dotenv_if_exists; socket paths to $TMPDIR
  .bin/                            ken-* scripts: features, built on the primitives
  .claude/                         hooks, deny rules, skills; not ken's business
  .repos/                          every checkout
    index.yaml                     one entry per repo, by owner
    github.com/acme/AGENTS.md              owner-level context: tracked, on the cascade path
    github.com/acme/.envrc                 owner-level env: source_up_if_exists; dotenv_if_exists
    github.com/acme/.env                   secrets: ignored
    github.com/acme/join-web/              the clone, on its default branch
    github.com/acme/join-web.PROJ-123/     a worktree, named for repo and branch
    github.com/acme/sales-atlas/           the layer's clone, with the same shape inside
```

**Reserved names** at the root: `.repos`, `.bin`, `.ken.yaml`, `.claude`, `.envrc`,
`AGENTS.md`, `CLAUDE.md`, `log.md`, and `README.md` as the front page. `ken init` creates
the ones it owns; `ken layer add` refuses a section name that collides with one, or with
an existing section. Everything else at the root is a section of the knowledge base.

## Decisions

1. **The root is the knowledge base.** Pages live at the top, in sections, each folder
   with a `README.md` that indexes it. Code, scripts and tool state live under reserved
   hidden names. `ls ~/ken` shows knowledge; `rg -L <words> ~/ken` searches knowledge and
   nothing else, because ripgrep skips hidden folders and the root `.gitignore` excludes
   the clones.
2. **The repo key is the address everywhere.** `<host>/<owner>/<repo>`, lowercase, is the
   entry in `.repos/index.yaml`, the clone at `.repos/<key>`, the worktree at
   `.repos/<key>.<branch>`, and the prefix of a code reference `<key>:<path>#<symbol>`. An
   agent that knows the key knows every path; nobody pastes absolute paths. The clone has
   no branch suffix because it holds the default branch, whatever it is called. Every
   other branch is a worktree beside it, with `/` in the branch name written as `-`. Two
   branches that map to one folder, or a repo actually named `<repo>.<branch>`, collide:
   the second is refused, naming what is in the way. A worktree holds the branch it was
   made for and the clone holds the default branch: never switch branches inside either.
3. **Checkouts are physically inside the root, and hidden.** Context cascades only along
   a real path: Claude Code walks every ancestor of the physical working directory to `/`,
   and through a symlink only the target's ancestors load. So a session in
   `.repos/github.com/acme/join-web/` loads the root's `AGENTS.md`, the owner-level one
   and the clone's own, root first; a session at the root loads the lower ones lazily on
   first read. The dot keeps code out of `ls` and `rg`. The gitignore rule is
   `.repos/*/*/*/`: directories at depth three, the clones and worktrees, and nothing
   else, so `index.yaml` and the owner-level `AGENTS.md` and `.envrc` are tracked.
4. **Shared and private never share a git history.** The root is yours. Anything shared
   is a layer: another root-shaped repo, cloned into `.repos/` like any repo and linked at
   the top as a section. A personal branch on a shared repo is private only socially; a
   GitHub fork of a public repo is public; encrypted files in a shared repo break under
   worktrees. Two nested histories do not.
5. **The root is synced by git and nothing else.** Clones, `.env`, `CLAUDE.local.md` and
   `node_modules` are ignored, so code and secrets never leave the machine through the
   root. The root never sits in iCloud, Syncthing or any file share: a missed exclusion
   rule there would upload object stores and secrets.
6. **`ken` is a kernel of primitives.** A command is a primitive when it enforces a rule
   that will not change, or is the only safe way to do a file operation under those rules.
   A git command that carries no rule of ours is not wrapped: the agent runs git against
   the path `ken path` prints. Everything else, flows, hooks, lint, status, the lazy clone,
   the task system, is built on top in scripts, skills and separate packages, and evolves
   without touching the kernel.
7. **Registration is the tool's job.** `.repos/index.yaml` describes every repo the
   workspace knows, cloned or not. `get` writes the entry, so a clone made by `ken` always has
   one, and `repos` names a clone that lacks one; the only writers are `index set` and `index unset`, and
   writes are validated and atomic. Whether a repo exists is the remote's business; the
   index only describes it, so the key is inside the file, never in a file name.
8. **A folder's `README.md` is its index, and is read first.** The root's is the front
   page, under about 60 lines; a section's lists its pages one line each, under about 150.
   An agent reads the front page, a section, a page: three hops, the first two small.
   Nothing derivable goes in: the repo list is `ken repos`, recent changes are `log.md`.
   The caps belong to a lint script, not to `ken`.
9. **A code reference is `<key>:<path>#<symbol>`.** Never a line number, never an absolute
   path. `ken path <ref>` resolves it to a local path when the repo is cloned, else to the
   remote URL.
10. **External subcommands.** `ken <name> ...` runs `ken-<name>` from the root's `.bin/`,
    each layer's `.bin/` in order, then `PATH`, with `KEN_ROOT` set. A builtin cannot be
    shadowed. That is how `ken task` reaches `ken-task`, and how a team's scripts become
    commands by being in its layer.
11. **One config file, shared without knowing.** `.ken.yaml` at the root keeps any
    top-level key it does not recognise, and `ken config --json` prints them all, so tools
    built on `ken` keep their settings in the one file. Per-repo, a committed `.ken.yaml`
    at a repo's root lists files to copy and a setup command for new worktrees.
12. **Tasks are not the kernel's business.** `ken` knows what a branch is, not what a
    task is. The seam with every task system is `ken get <key> -b <branch>`: Jira
    passes `PROJ-123`, `ken-task` passes a denote ID, a human passes `feat/login`. The
    denote task system ships as its own package, `@unclex/ken-task`, reached as `ken task`.
    It depends on `ken`; `ken` never depends on it.
13. **No harness, no GitHub.** `ken` ships no hooks, settings or skills and does not know
    which agent harness runs it. It speaks git only: no remote checks, no `gh`. Those are
    scripts.
14. **Blobless, never shallow.** `get` clones with `--filter=blob:none` by default, which
    works with worktrees and costs first-touch latency only. A shallow clone breaks the second
    worktree and every fetch, so `ken` never makes one.
15. **Real paths.** On a case-insensitive disk `~/ken` and `~/Ken` are one folder. `ken`
    resolves the root with realpath once and compares real paths, never strings. It
    refuses a branch whose folder would differ only by case from an entry of `<owner>/`.
16. **No exceptions to the layout.** A repo that must live at a fixed path stays in the
    layout and the user symlinks that path to the clone. `ken` neither makes nor tracks
    such links.
17. **Every message is a next step.** The CLIs are used by agents that see nothing but
    their output. Every message, above all every error, says what is the case, why it
    matters, and what to run next, with the real command and the real keys or paths
    filled in. `ken help` and `ken <command> --help` carry the same examples.
18. **Its own project, in TypeScript**: a pnpm monorepo of three packages, no build step,
    node running TypeScript directly.

## Packages

| Package            | Command          | Owns                                                    |
| ------------------ | ---------------- | ------------------------------------------------------- |
| `@unclex/ken`      | `ken`            | the kernel: root, layout, index, layers, dispatch       |
| `@unclex/ken-task` | `ken task`       | the task volume, denote names, states, claim and finish |
| `create-ken`       | `npm create ken` | templates and the scaffolding prompt; calls `ken init`  |

Published under the `@unclex` npm scope; the source lives at `github.com/xiaoxinghu/ken`
and each package's `repository` field says so. `create-ken` is unscoped so the command is
`npm create ken`. A root may pin `@unclex/ken` in its own `package.json` so everyone on a
team layer runs the same kernel through `pnpm exec ken` or a direnv `PATH_add`.

## The kernel: `ken`

Ten commands. Every listing has `--json`. Everything is offline except `get` when the
clone is missing and `layer add`.

| Group     | Command                                               | Does                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| --------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| root      | `init [<dir>]`                                        | Create the skeleton `ken` owns in `<dir>`, default the current directory: `.repos/index.yaml` (empty), `.ken.yaml`, `.gitignore` with the depth-three rule and `.env` (an existing one gains only the lines it lacks), `.bin/`, and a front page `README.md` (with `## Sections` and `## Layers`) and `AGENTS.md`. Only what is missing: it never overwrites a file, so on a root it fills in the rest and says what it made. A root is a directory holding `.ken.yaml`; `init` refuses `<dir>` when a strict ancestor, by real path, is one, naming it. When `<dir>` is not the configured root it prints the `KEN_ROOT=` and config-file lines that point `ken` at it. Does not `git init`: that is `create-ken`'s or the user's.                                                                                                                                                                                                                                                                                            |
|           | `config [--json]`                                     | Effective settings, where each came from (`.ken.yaml`, `~/.config/ken/config.json`, environment, default), the layers, and the unknown top-level sections verbatim.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| resolve   | `path <what>`                                         | The one resolver, forward. `root`, `repos`, `bin`; `layer <name>`; `code <key> [<branch>]` for a clone or worktree path, whether or not it exists; `<key>:<path>` for a code reference, the local path when cloned, else the remote's URL for it; `<file>` for its README chain, the `README.md` of each folder from the root down to the file's own, then the file.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
|           | `which [<path>] [--json]`                             | Reverse. For a path, default the cwd, compared as a real path: the key, whether it is the clone or a worktree, and the branch, as `<key> <clone\|worktree> <branch>`. An existing checkout is asked of git, a worktree keyed by its clone; a path not checked out yet is answered from its shape, with no branch, so a hook can ask about a repo not cloned yet (`<repo>.<x>` beside an existing clone `<repo>` is its worktree). Outside `.repos/<host>/<owner>/<folder>`, or outside the root, it says so and exits 1.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| layout    | `get <url\|key> [-b <branch> [--from <ref>]]`         | The one write into the layout, idempotent: make `<key>` ready here and print its path. Clone to `.repos/<key>` if missing (blobless unless `.ken.yaml` says `clone.blobless: false`; a key alone resolves through the host as `https://<key>.git`; an empty remote leaves an unborn default branch); set `worktree.useRelativePaths` and `git worktree repair`; write the index entry if none. With `-b`: create `<branch>` from the clone's default branch as it stands (no fetch), or from `--from`, and its worktree at `.repos/<key>.<folder>`; copy the files the repo's `.ken.yaml` lists from the clone and run its `setup`; print the worktree path. An existing branch gets its worktree without `--from`; a branch that already has one prints the existing path. Branch creation is the lock: git's ref lock means two callers never get one branch. A failure after it, up to reading `.ken.yaml`, deletes the branch again; a failure in the copy or the setup keeps the worktree and says how to finish by hand. |
| index     | `repos [<key>] [--layer <name>]`                      | The merged index times the disk: for every key, its `desc`, which workspace listed it, whether it is cloned, its worktrees, and any stray: a clone with no entry, a clone not on its default branch, a worktree whose folder does not match its branch, a worktree outside the layout. For one key: the merged entry, then the files under the root that mention the key. Offline.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
|           | `index set <key> <field>=<value>... [--layer <name>]` | Write fields into the root's index, or a layer's (`.repos/<layer key>/.repos/index.yaml`, the layer named in `.ken.yaml`). Creates the entry and its owner. A value is a YAML flow value (`tags=[sales,join]` a list), else the text as written. Comments, order and unknown fields are kept. Read, modify, validate, write beside, rename over.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
|           | `index unset <key> [<field>...] [--layer <name>]`     | Remove fields, or the whole entry; an owner left with nothing goes too. `desc` alone is not removed: set it, or unset the entry.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| layers    | `layer add <url\|key> [--as <name>]`                  | `get` into `.repos/`; symlink the clone at the root as `<name>`, default the repo name; symlink each of the layer's `.repos/<host>/<owner>/AGENTS.md` into the root's matching owner folder when the root has none there; record the layer in `.ken.yaml`; add its line to the front page. Refuses a reserved or taken name.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
|           | `layer remove <name>`                                 | Reverse of `add`: the link, the owner links, the `.ken.yaml` entry, the front-page line. The clone stays until deleted by hand.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| extension | `ken <name> ...`                                      | Decision 10.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |

**Everything else is git**, run by the agent or a script against the path `ken path`
prints: `git worktree list`, `git worktree remove` and `git branch -d` to finish a branch,
`rm -rf "$(ken path code <key>)"` and its worktrees to drop a clone (the entry stays, so
the repo is lazy again), `git init "$(ken path code <key>)"` then `ken get <key>` for a
new repo, `mv <old> "$(ken path code <key>)"` then `ken get <key>` to adopt one. `ken`
wraps no git command that carries none of its rules; it prevents at the one write it owns
and detects everywhere else, in `repos`.

**Collisions and guards.** A folder in the way of a clone or worktree is named in the
refusal. A key is validated as `<host>/<owner>/<repo>` with one slash each, each part
letters, digits, `.`, `_` and `-` and neither `.` nor `..`; a URL's `.git` is dropped and
its userinfo never printed. GitLab subgroups are out of scope. A branch must pass git's
own rules (`git check-ref-format --branch`), and `@` is refused as `git branch` refuses
it. A root that does not exist, or is not a folder, is an error naming the path and where
it came from.

**Deliberately not in `ken`:** tasks and branch naming policy; anything about Claude Code
or another harness; anything about GitHub beyond git; git commands that carry no rule;
knowledge commands beyond `path`, because the file system is the union and `rg -L`,
`find -L` and the READMEs are the interface; lint rules, thresholds and flows; the lazy
clone hook; status, doctor, grep, promote, ingest.

## Layers

A layer is a root-shaped repo: a front page, sections, `.repos/index.yaml`,
`.repos/<host>/<owner>/` context files, `.bin/`, optionally `.claude/`. No clones, no
`me/`. Installing one is `ken layer add <key>`.

**Two unions, one in the file system and one in code.**

- Pages: the symlink is the union. `~/ken/sales-atlas/systems/x.md` is a page like any
  other; `rg -L` finds it, `ken path` prints its README chain through the link.
- Index entries: `ken repos` merges the root's `.repos/index.yaml` with each layer's, in
  `.ken.yaml` order, the root first; a whole entry wins by that order. One table, one
  `--json`. A layer contributes repos to your workspace just by being added: a team layer
  lists the team's repos once, and everyone who adds it can `ken get` any of them by
  key, with the description already there.

**Update** is `git pull` in the layer's clone. **Contribute** is a move: a page from a
root section into the layer's section, or an entry with `index unset` here and `index set
--layer` there; then the ordinary flow on the layer's repo, a branch, a worktree, a PR.
Private notes never touch the shared history. **A new joiner** with nothing of their own:
`npm create ken ~/ken && ken layer add github.com/acme/sales-atlas`.

**A layer is a unit of sharing, not of organisation.** A group of repos only you care
about is a section and tags in the root. It becomes a layer the day someone else should
receive it, or it needs a different visibility. Two layers cannot share a section name.

## The index: `.repos/index.yaml`

One structured file per workspace, at the top of the tree it describes, nested by owner so
a key is spelled once and owner-level facts have a home:

```yaml
# .repos/index.yaml: what each repo is. Whether it exists is the remote's business.
github.com/acme:
  desc: acme's GitHub org. Sales tribe repos are tagged sales.
  repos:
    join-web:
      desc: Front end for the direct-to-consumer join funnel.
      kind: frontend
      tags: [ sales, join ]
      depends_on: [ join-api ]
      doc: systems/join.md
    join-api:
      desc: Join API and step functions. Identity, payment, underwriting, then hand off.
      kind: api
      tags: [ sales, join ]
      lifecycle: production
      owner: sales-squad-1
github.com/xiaoxinghu:
  repos:
    ken:
      desc: Workspace kernel. Every checkout under .repos/, a layered knowledge base above it.
      tags: [ tooling ]
```

`desc` lets an agent choose a repo before cloning; when present it is a non-empty string.
An entry without one is valid, because `get` writes the entry before anyone has described
the repo, and `ken repos` flags it with the `ken index set <key> desc="..."` to run. `kind`,
`tags`, `depends_on`, `lifecycle`, `owner` filter or link and keep a Backstage export
possible; `doc` points at a page. Unknown fields are kept. Anything longer than a line is
a page the entry points at. The file is real YAML; `ken` takes one dependency for it, the
`yaml` package. Anchors and aliases are refused: every entry stands on its own, so editing
one never changes another.

`ken repos` reconciles the merged index against the clones under `.repos/` and reports
each key as listed (by which workspace) and cloned (with its worktrees). A script adds the
remote: listed but not cloned and on the remote is lazy; listed and not on the remote is
a typo or a deleted repo, named to fix; cloned but not listed is registered. The code
layout never depends on the index: a key in no index is still a valid address. Two agents
cloning in the same second is the one race, repaired by that script.

## The knowledge base

The root holds what no single repo can hold: how systems fit together, flows that cross
repos, where logs point, why decisions were made. A page about one repo is a smell: the
one-line `desc` plus the repo's own `README.md` is the per-repo documentation, and when a
repo is thin, the fix is a README PR to that repo. A page on how we use a third-party
repo and where it bites is knowledge about our use of it, and belongs here.

- **A `README.md` per folder is the index** (decision 8). The front page says what the
  knowledge base is, names the few evergreen pages, gives one line per section with its
  page count and one line per layer. A section's README lists its pages one line each;
  over the cap it splits. GitHub renders a folder's README; `ken path <file>` prints the
  chain top down.
- **`log.md`** is append-only, one dated line per change, never read whole. Grepped by
  date or key; rolled per year if it bothers.
- **Sections** follow Diátaxis: `systems/`, `flows/`, `playbooks/`, `decisions/`. Pages
  are Markdown. Code references are `<key>:<path>#<symbol>`. No `generated/`: a generated
  overview belongs in the repo's own README.
- **The LLM writes the index**, with judgment about grouping and what is evergreen. A lint
  script makes that safe: every page in exactly one section README, every link and code
  reference resolving, the caps, and pages nobody links to and nobody has touched in a
  year proposed for `.archive/`.
- **A layer is a section**, complete on its own, with its own front page and READMEs.
- The root `AGENTS.md` stays under 40 lines: context files cost tokens on every turn and
  help only for the non-obvious. Everything else loads when a question needs it.

**The flows**, all built on top, none in the kernel:

- **Ingest a repo**: clone lazily if needed; read its README, manifests, top-level tree
  and `AGENTS.md`; write `desc`, `kind`, `tags` through `ken index set`; log it. If the
  repo lacks a README or does not say how to run, the follow-up is a task on that repo.
- **Ingest a source**: read it; write a page in the right section naming the repos it
  concerns by key; add its line to the section README, and to the front page only if a
  section was added; revise related pages; log it. The source is cited, not copied.
- **Query**: front page, section, page, code; cite; file a good answer back; log it.
- **Promote**: a settled note moves from `me/` to a section, or from the root to a layer.

## Configuration

Per machine, `$XDG_CONFIG_HOME/ken/config.json` (default `~/.config/ken/config.json`),
optional, with one key: `root`, default `~/ken`. `KEN_ROOT` overrides it, and `ken` sets
it for every external subcommand. State `ken` owns on a machine belongs in
`~/.local/state/ken`.

Per root, `.ken.yaml`, tracked:

```yaml
orgs:
  me: github.com/xiaoxinghu
clone:
  blobless: true
layers:
  - name: sales-atlas
    key: github.com/acme/sales-atlas
task: # ken-task's section; ken keeps it and prints it, nothing more
  volume: me
  branch: "{id}"
```

Every key is optional, and one left empty is its default; a missing file is all defaults.
A key of the wrong type, or a YAML error, stops every command that reads the file, with the
file, the key and what it expects. `root` is refused
here, since the root is per machine. `ken config --json` prints one object: `root` and
`clone.blobless` as `{ value, source }`, `orgs`, `layers` with `cloned` and `linked` (the
clone and the root link exist, a hint), then every unknown section as written, so a tool
reads its own with `ken config --json | jq .task`.

Per repo, a committed `.ken.yaml` at the repo root, read by `get -b` from the new
worktree:

```yaml
copy: [ platform/worker/.env, platform/worker/.dev.vars ]
setup: pnpm install
```

**Environment** is direnv's job. The root `.envrc` is the top of a chain:
`.repos/<host>/<owner>/.envrc` with `source_up_if_exists` and `dotenv_if_exists`, so a
worktree without an `.envrc` of its own inherits the owner's and the root's. A
`[whitelist] prefix = ["~/ken"]` in `direnv.toml` removes per-worktree `direnv allow`.
The root `.envrc` points socket-creating tools at `$TMPDIR` (`OVERMIND_SOCKET`, `PGHOST`,
ssh `ControlPath`), because a Unix socket path is limited to 104 bytes on macOS and the
longest worktree path here is near 90. An agent harness reads env at startup and its
shell does not re-run direnv on `cd`, so setup commands and skills run `direnv exec .
<cmd>` when a repo needs its own environment.

Relative worktree paths (git ≥ 2.48) let a whole `<owner>/` folder move with a plain
`mv`; moving one repo folder alone needs `git worktree repair`, since its worktrees are
beside it. The `relativeWorktrees` extension makes any older git refuse the repo;
accepted.

## `ken-task`

Tasks, notes and reports as plain text in a private volume, linked to code by data and
pattern, never by path. Installed as `@unclex/ken-task`; its binary `ken-task` is found by
dispatch, so it reads as `ken task <command>`. It depends on `ken` for `path code`, `get -b`
and `which`, runs git itself for the rest, and reads the `task:` section of `.ken.yaml`.

**The volume** is a folder `ken-task` owns, by default the `me/` section of the root
(`task.volume`, a path relative to the root or absolute, so it can also live on a file
share). `ken-task` scans all of it for identified files, skipping dot entries and
symlinks, so `.archive` is never walked. An editor backup ending in `~` is not an
identified file. Everything that is not an identified file belongs to the humans and
agents who put it there.

**Names** are denote's, exactly: `<id>[==<signature>]--<title>__<keywords>.<ext>`, at any
depth. Only the ID is required. A file that starts with an ID is an **identified file**: a
task or a note, by its keywords. A folder is a group and nothing more: no status, no
metadata, no ID; renaming or moving a folder changes no file. Every other file is an
asset: a `README.md` of shared context, a script, an image. Sluggification is denote's:
the title lowercased with words joined by `-`; a keyword lowercased with denote's
punctuation and all whitespace removed; keywords joined by `_` and sorted. Reserved
tokens: `--`, `__`, `==`.

**ID.** `YYYYMMDDTHHMMSS`, the creation time to the second, local time. It is the
identity, the default branch name, the link target and the one unambiguous token:
`[0-9]{8}T[0-9]{6}` finds references in the volume, commit messages and branch names.
`add` takes the first second no file starts with and reserves it before creating the file.

**Kind** comes from the keywords. `todo`, `done` and `wontfix` are reserved: exactly one
makes the file a task; none makes a note; more than one is malformed, named by `list` and
never ready. Any other keyword is a topic.

**Front matter**, YAML in `.md` files only, holds what the name cannot:

```markdown
---

scheduled: 2026-10-20 # optional: not ready before this day
due: 2026-10-31 # optional: deadline
repo: github.com/acme/join-web # optional: the code link, a repo key
blocked-by: [20261015T143012] # tasks only
---

# Remember the milk
```

Unknown fields are kept; an edit changes only the line of the field it sets. Denote's own
`title:`, `date:`, `tags:` and `identifier:` are never added; when present, `rename` and
`done` rewrite `title:` and `tags:` to match the name. The title is the first `# `
heading, else `title:`, else the name's title, else the ID.

**Branch.** `task.branch` in `.ken.yaml` is a template, default `{id}`; `{id}`, `{title}`
and `{keywords}` are the fields. The ID must appear, since it is how the branch is found
again. `claim` passes the rendered name to `ken get -b`.

**States**, in the order they are decided:

| State         | Meaning                                                                             |
| ------------- | ----------------------------------------------------------------------------------- |
| malformed     | more than one status keyword                                                        |
| landing       | done, but the task's branch exists in its repo and is not on the default branch yet |
| done, wontfix | the keyword says so                                                                 |
| claimed       | repo task whose branch exists in its repo on this machine                           |
| blocked       | todo, waiting on a blocker that is missing, open, or landing                        |
| later         | todo, `scheduled` for a day after today                                             |
| ready         | todo, none of the above                                                             |

A blocker holds a task back until it is landed, not merely marked done. Nothing is
inferred from git history: `done` on a repo task whose branch exists asks whether that
branch is an ancestor of the default branch and refuses if not; a squash merge hides a
merge, so landing is a rebase and a merge that keeps the commits. A note's state comes
from the tasks that mention it: open, planned, done. A task sees the `README.md` of its
folder and every folder above it as shared context. **Mentions** are by grep for the ID;
there is no link field. **Order** comes from dependencies alone; among ready tasks `next`
picks the earliest `due`, then the lowest ID. **Archive**: `<volume>/.archive/` holds
closed tasks and retired notes at their relative paths; listings never see it, lookups
by ID fall through to it.

| Command                                                                                        | Does                                                                                                                                                                                                 |
| ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ken task list [--kind task\|note\|all] [-k <kw>]... [--json]`                                 | Every task with its state, unmet blockers, and a note on what may need you.                                                                                                                          |
| `ken task ready`, `ken task next`                                                              | IDs of all ready tasks; the first.                                                                                                                                                                   |
| `ken task add [-p <folder>] [-k <kw>]... [-b <id>]... [-r <key>] [--note] [-F <file>] <title>` | Create the file and print its path. `-r` is a repo key, cloned or not. Without `-r`, inside a clone or worktree (`ken which`), its repo is the default. Interactive with no arguments on a terminal. |
| `ken task done [<id>]`                                                                         | Rename `todo` to `done`. Without `<id>`, the task of the current branch (`ken which`). Refuses a repo task whose branch is not landed.                                                               |
| `ken task rename <id> <title>`                                                                 | New title in the name, heading and `title:`.                                                                                                                                                         |
| `ken task archive [<id>...] [--closed]`                                                        | Move to `.archive/`. A todo task is refused.                                                                                                                                                         |
| `ken task path [<id>]`                                                                         | The file, its folder, the READMEs above it top down, then the mentions.                                                                                                                              |
| `ken task claim [<id>]`                                                                        | Render the branch, `ken get <key> -b <branch>`, print the path. Without `<id>`, the first ready repo task; losing the race retries with the next. The repo must be cloned.                           |
| `ken task finish [--force] <id>`                                                               | `git worktree remove` then `git branch -d` for a done or wontfix task, at the path `ken path code` prints; git's refusals pass through, `--force` goes to both. Any other status is refused.         |
| `ken task context [<id>]`                                                                      | Body, READMEs above, the commits on the branch not on the default branch, the mentions; Markdown on stdout for a reviewer or a fresh agent.                                                          |

`list` notes what needs you: malformed; overdue; todo for more than 90 days; landing;
done but branch remains; claimed but the worktree is missing or not the branch's;
uncommitted changes in a worktree; how many closed tasks `archive --closed` could move.

**Concurrency**, several agents on one machine, atomic operations, no lock files: claim is
atomic through git's ref lock; create reserves an ID with an exclusive-create file
`<volume>/.<id>.add`, and a held or stale reservation moves the writer on one second;
update writes beside and renames over; a status change is a rename of the file itself;
two writers to one file, last wins.

**The agent workflow:** `cd "$(ken task claim)"`; read what `ken task path` prints; work
and commit on the branch with a `Task: <id>` trailer; `ken task done`; after the merge,
from outside the worktree, `ken task finish <id>`. A thought becomes work the same way:
`ken task add --note`, a session over `ken task context <id>`, tasks that mention the note.

## `create-ken`

`npm create ken [<dir>] [--template <name>]` asks for what it was not given, copies the
template folder out of its own package, runs `git init`, runs `ken init <dir>` through
its pinned `@unclex/ken` so the rules have one source, and prints the next commands. No
logic beyond copy and prompt: anything that needs to know a rule is a kernel primitive.
Templates are bundled, not cloned, so a template version is tied to a kernel version.

| Template  | Holds                                                                                                             |
| --------- | ----------------------------------------------------------------------------------------------------------------- |
| `minimal` | front page, `AGENTS.md`, `CLAUDE.md -> AGENTS.md`, `.ken.yaml`, `.gitignore`, `.envrc`, `log.md`, empty sections  |
| `claude`  | `minimal` plus `.claude/` hooks, deny rules and skills, and the `.bin/` scripts they call                         |
| `layer`   | the shape of a shareable layer: front page, sections, `.repos/index.yaml`, `.bin/`; no `me/`, no private sections |

## Built on top

Not in any package here. Scripts live in `.bin/` of a root or a layer and reach `ken` as
`ken <name>`; skills hold judgment and call scripts and primitives for every fact; hooks
are one line each. Skills are tested with golden questions: ten to twenty real past
questions with known answers, run through a fresh session at the root and scored, rerun
after a docs, skill or model change.

| Piece                                                                  | Built from                                                                                                                                   |
| ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `ken-status`, a session-start hook                                     | `repos`, `config`, `ken task ready`: one screen so the agent never lists folders.                                                            |
| `ken-ensure`, a pre-tool hook on read, search and shell                | `which` then `repos --json`; `get <key>` when the key is listed and not cloned: the lazy clone.                                              |
| deny rules in the root's `.claude/settings.json`                       | `.repos/**/node_modules/**`, `dist`, `.next`, `coverage`, lockfiles.                                                                         |
| `ken-doctor`                                                           | `repos` plus `gh` for remote states, the lint, the strays `repos` names, clones with `AGENTS.md` and no `CLAUDE.md`, layers behind upstream. |
| `ken-lint`                                                             | `find -L` over the sections, the READMEs, the caps, `path` for every reference.                                                              |
| `ken-pull`                                                             | entries for unlisted clones, `desc` from `gh repo view`, through `index set`.                                                                |
| `ken-grep`                                                             | `rg` over cloned repos in scope, paths passed explicitly; names the uncloned.                                                                |
| `ken-promote`                                                          | `git mv` plus `index unset` and `index set --layer`.                                                                                         |
| `ken-jira`                                                             | Jira issue picker into `get <key> -b <issue>`; no task file involved.                                                                        |
| skills: `start-task`, `where-is`, `ingest`, `kb`, `capture`, `promote` | the flows above. A team's playbooks are skills in its layer.                                                                                 |

Sessions start at the root: that is where the hooks, skills and deny rules live, and the
only layout a harness that walks down from the git root understands. A session that must
start in a clone gets the root's skills and hooks as a plugin enabled at user scope. Two
documented traps: an ancestor `CLAUDE.md` hides a clone's `AGENTS.md` unless the clone has
`CLAUDE.md -> AGENTS.md` or the user sets `instructionFiles: claude-md-and-agents-md`;
auto-memory is keyed on the git repo, so every session at the root shares one memory.

## Path length

|                                                                                | chars       |
| ------------------------------------------------------------------------------ | ----------- |
| `/Users/me/ken/.repos/github.com/acme/join-api-step-functions.20261019T101500` | 78          |
| `PATH_MAX` macOS / Linux                                                       | 1024 / 4096 |
| Unix socket path (`sun_path`) macOS / Linux                                    | 104 / 108   |
| Windows `MAX_PATH`                                                             | 260         |

Not a problem on macOS or Linux. The one wall is a Unix socket created inside the tree,
handled by the root `.envrc`. If it ever bites: a host alias (`gh/` for `github.com/`) or
a shorter root. Windows needs `LongPathsEnabled` and `core.longpaths` regardless.

## Out of scope for now

- Syncing the volume and more than one machine: `claimed` is read from this machine.
- Windows.
- Priority and effort on tasks; dependencies order the work.
- `.org` pages and org-agenda; pages and tasks are Markdown.
- GitLab subgroups: an owner with slashes.
- Repos with submodules: the clone at `<repo>` and no worktrees until git recommends them.
- A union file system for layers; a symlink per layer is the overlay.
- A Backstage export of the index; a script later, if ever.
- Encrypting anything in a shared layer.

## Considered and rejected

- **One card file per repo, named by key.** A stray rename or delete makes a phantom
  repo; the key belongs inside a file.
- **Metadata inside the clone, tracked by the root.** Git never tracks files inside a
  nested repo, and the entry must outlive the clone for lazy cloning to work.
- **Knowledge-first, the index derived from mentions.** Coverage would rest on
  discipline; registration has to be the tool's job. Mentions survive in `repos <key>`.
- **A folder per repo holding `main/`, `<branch>/`, `info.yaml`.** Tools that name a
  project after its folder show `main` for every repo; doubling the name lengthens every
  path.
- **A hidden clone root with a symlink view.** A second tree of generated state, the
  `main` problem again, and `rg` finds everything twice when told to follow.
- **Generated per-repo overview pages.** A stale second copy of the README owned by
  nobody. An overview belongs in the repo's README; ingest proposes that PR.
- **A single `INDEX.md` of every page.** Grows until it costs more than `AGENTS.md`.
  A bounded README per folder instead.
- **A `kb/` folder, a `layers/` folder, knowledge commands in the kernel.** Three folders
  for one job; the root is the knowledge base and the file system is the union.
- **Tasks in the kernel.** A Jira user must be able to adopt `ken` without a task system;
  the seam is `get -b`.
- **Wrapping git: `clone`, `new`, `adopt`, `remove`, `worktree add|remove|ls`.** Seven
  commands whose only rule was the path, which `path` already prints. Folded into one
  idempotent `get`, the single write into the layout; the rest is git, and `repos`
  detects strays.
- **`open <ref>` beside `path`.** Two resolvers for one rule; `path` takes the reference.
- **Code outside the root, linked in.** Through a symlink only the target's ancestors load
  context, so the cascade breaks; the clones are physically inside.
- **A personal branch, a GitHub fork, or git-crypt for private content.** Private only
  socially, public by construction, and broken under worktrees, respectively.
- **Shallow clones.** Break the second worktree and every fetch; blobless instead.

## Prior art

- The `ws` CLI and the sales-atlas design, the two halves this merges: denote-named tasks
  with a worktree per task and the `<host>/<owner>/<repo>.<branch>` layout from one; a
  manifest, curated docs, tiny `AGENTS.md`, skills, hooks and lazily cloned repos from the
  other.
- denote: the file-name scheme, timestamp identifier, sorted keywords, front matter
  optional, backlinks by grep.
- A code-free bootstrap repo with gitignored clones beside tracked context files, and
  "point to the manifest, don't copy it".
- Google `repo` manifests and Zephyr `west`: listed but not synced is the lazy state.
- mani, tsrc: `desc` and `tags` per repo; never touch a dirty tree on sync.
- Backstage: entry vocabulary (`kind`, `lifecycle`, `owner`, `depends_on`).
- Karpathy's LLM wiki: index first, append-only log, ingest, query and lint, file answers
  back.
- llms.txt, Diátaxis, matklad's ARCHITECTURE.md: the front-page shape, doc types, name
  files and symbols rather than lines.
- "Evaluating AGENTS.md" (ICLR 2026): context files cost on every turn; keep the root
  minimal and measure with golden questions.
- git, cargo, gh, kubectl: `<tool>-<name>` external subcommands, a root variable for
  children.
- GNU Stow: the symlink overlay, reduced to one link per layer.
- ghq, gwq, worktrunk, git-repo-manager: `<root>/<host>/<owner>/<repo>` placement,
  `ghq get` as the one verb that puts a repo in place, and worktrees beside the clone.
- vibe-kanban, git-town, Linear, GitLab, `gh issue develop`: the identifier in the branch
  name is the join key, so a task tool needs only `get -b`.
- workmux, Conductor: files to copy and a setup command per worktree.
- direnv `source_up_if_exists` and the whitelist prefix: cascading env without
  per-worktree allow.
