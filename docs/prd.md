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
  systems/  flows/  playbooks/  decisions/     sections, made as needed, each with a README.md
  sales-atlas -> .repos/github.com/acme/sales-atlas    a layer: its clone, as a section
  tasks/                           ken-task's folder, when installed; one file per task
  .ken.yaml                        layers by name and key, orgs, a section per tool
  .gitignore                       .repos/*/*/*/   .env
  .envrc                           direnv root: dotenv_if_exists; socket paths to $TMPDIR
  .bin/                            ken-* scripts: features, built on the primitives
  .agents/                         skills and hooks.json, the files every harness shares; not ken's business
  .claude/  .codex/  .pi/          one thin adapter per harness, pointing into .agents/; not ken's business
  .repos/                          every checkout
    index.yaml                     one entry per repo, by owner
    github.com/acme/AGENTS.md              owner-level context: tracked, on the cascade path
    github.com/acme/.envrc                 owner-level env: source_up_if_exists; dotenv_if_exists
    github.com/acme/.env                   secrets: ignored
    github.com/acme/join-web/              the clone, on its default branch
    github.com/acme/join-web.PROJ-123/     a worktree, named for repo and branch
    github.com/acme/sales-atlas/           the layer's clone, with the same shape inside
```

**Reserved names** at the root: `.repos`, `.bin`, `.ken.yaml`, `.agents`, `.claude`, `.codex`, `.pi`, `.envrc`,
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
   is a layer: another root, cloned into `.repos/` like any repo and linked at
   the top as a section. A personal branch on a shared repo is private only socially; a
   GitHub fork of a public repo is public; encrypted files in a shared repo break under
   worktrees. Two nested histories do not.
5. **The root is synced by git and nothing else.** Clones and `.env` are ignored, and a
   template adds what its tools leave behind, such as `CLAUDE.local.md` or `node_modules`, so code and secrets never leave the machine through the
   root. The root never sits in iCloud, Syncthing or any file share: a missed exclusion
   rule there would upload object stores and secrets.
6. **`ken` is a kernel of primitives.** A command is a primitive when it enforces a rule
   that will not change, or is the only safe way to do a file operation under those rules.
   A git command that carries no rule of ours is not wrapped: the agent runs git against
   the path `ken path` prints. Everything else, flows, hooks, lint, status, the task system,
   is built on top in scripts, skills and separate packages, and evolves
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
   The caps belong to `ken lint`, not to the kernel.
9. **A code reference is `<key>:<path>#<symbol>`.** Never a line number, never an absolute
   path. `ken path <ref>` resolves it to a local path when the repo is cloned, else to the
   repo's URL, `https://<key>.git`, saying on stderr to `ken get <key>`.
10. **External subcommands.** `ken <name> ...` runs `ken-<name>` from the root's `.bin/`,
    each layer's `.bin/` in order, then `PATH`, with `KEN_ROOT` set. A builtin cannot be
    shadowed. That is how `ken task` reaches `ken-task`, and how a team's scripts become
    commands by being in its layer. Two kinds, one contract: a script that belongs to a
    root or layer lives in its `.bin/` and travels with git; a packaged tool is installed
    by the user with whatever installs commands on their machine (npm, cargo, Homebrew,
    mise), and `ken` reads nothing but `PATH`. `ken` never fetches, pins or declares an
    extension: how to get one is the package managers' problem, in any language, and a root
    or layer that relies on one names it in its `AGENTS.md`. The protocol is the process
    model, argv, `KEN_ROOT`, inherited stdio, exit code, plus the `--json` output of the
    builtins, so an extension never knows what the kernel is written in.
11. **One config file, shared without knowing.** `.ken.yaml` at the root keeps any
    top-level key it does not recognise, and `ken config --json` prints them all, so tools
    built on `ken` keep their settings in the one file. Per-repo, a committed `.ken.yaml`
    at a repo's root lists files to copy and a setup command for new worktrees.
12. **Tasks are not the kernel's business.** `ken` knows what a branch is, not what a
    task is. The seam with every task system is `ken get <key> -b <branch>`: Jira
    passes `PROJ-123`, `ken-task` passes a task's path, a human passes `feat/login`. The
    task system ships as its own package, `@unclex/ken-task`, reached as `ken task`, with
    its own PRD, `docs/ken-task.md`. It depends on `ken`; `ken` never depends on it.
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
18. **Its own project, in TypeScript**: a pnpm monorepo of four packages, no build step,
    node running TypeScript directly.

## Packages

| Package            | Command          | Owns                                                   |
| ------------------ | ---------------- | ------------------------------------------------------ |
| `@unclex/ken`      | `ken`            | the kernel: root, layout, index, layers, dispatch      |
| `@unclex/ken-task` | `ken task`       | plain-text tasks in one folder; `docs/ken-task.md`     |
| `@unclex/ken-lint` | `ken lint`       | the knowledge-base lint                                |
| `create-ken`       | `npm create ken` | templates and the scaffolding prompt; calls `ken init` |

Published under the `@unclex` npm scope; the source lives at `github.com/xiaoxinghu/ken`
and each package's `repository` field says so. `create-ken` is unscoped so the command is
`npm create ken`. npm is one way to install them, not a dependency of the design: `ken`
and an extension are commands on `PATH`, however they got there.

## The kernel: `ken`

Ten commands. Every listing has `--json`. Everything is offline except `get` when the
clone is missing, `layer add`, and `init` when a layer's clone is missing.

| Group     | Command                                               | Does                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| --------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| root      | `init [<dir>]`                                        | Create the skeleton `ken` owns in `<dir>`, default the current directory: `.repos/index.yaml` (empty), `.ken.yaml`, `.gitignore` with the depth-three rule and `.env` (an existing one gains only the lines it lacks), `.bin/`, and a front page `README.md` (with `## Sections` and `## Layers`) and an `AGENTS.md` that says how to make a section and a page, and that another root can add this one as a layer. Only what is missing: it never overwrites a file, so on a root it fills in the rest and says what it made. A root is a directory holding `.ken.yaml`; `init` refuses `<dir>` when a strict ancestor, by real path, is one, naming it. Then it installs the layers: each layer in `.ken.yaml` whose clone is missing is cloned as `get` does, in `.ken.yaml` order, so the tracked root link and owner links resolve; it does not relink or touch `.ken.yaml` or the front page, and a clone already there is left alone, with no fetch. These clones neither prompt nor wait forever: `GIT_TERMINAL_PROMPT=0`, no askpass, ssh with `BatchMode=yes`, a connect timeout and a keepalive that drops a stalled connection, put right after the ssh word of the user's own `GIT_SSH_COMMAND` or `core.sshCommand`, before its options since ssh takes the first value of each (appended when it has none, a wrapper) (a `GIT_SSH` program is left alone), http with a low-speed limit and time. A layer that cannot be cloned is offline on this machine: `init` says so on stderr with git's reason and the `ken init <dir>` to run once it can be reached, and still exits 0. When `<dir>` is not the configured root it prints the `KEN_ROOT=` and config-file lines that point `ken` at it. Does not `git init`: that is `create-ken`'s or the user's.                                                                                                                                                                              |
|           | `config [--json]`                                     | Effective settings, where each came from (`.ken.yaml`, `~/.config/ken/config.json`, environment, default), the layers, and the unknown top-level sections verbatim.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| resolve   | `path <what>`                                         | The one resolver, forward. `root`, `repos`, `bin`; `layer <name>`; `code <key> [<branch>]` for a clone or worktree path, whether or not it exists; `<key>:<path>[#<symbol>]` for a code reference, `<clone>/<path>` when cloned (the symbol is the reader's to find), else `https://<key>.git` with exit 0 and a line on stderr to run `ken get <key>`, since `ken` knows no host's web layout; `<file>` for its README chain, the `README.md` of each folder from the root down to the file's own, those that exist, then the file, taken logically so a page through a layer's link keeps the link; a folder ends with its own README; a file outside the root is refused. The words come first, then a `<host>/<owner>/<repo>:` prefix is a reference, anything else a file: a file named like a word is `./root`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
|           | `which [<path>] [--json]`                             | Reverse. For a path, default the cwd, compared as a real path: the key, whether it is the clone or a worktree, and the branch, as `<key> <clone\|worktree> <branch>`. An existing checkout is asked of git, a worktree keyed by its clone; a path not checked out yet is answered from its shape, with no branch, so a hook can ask about a repo not cloned yet (`<repo>.<x>` beside an existing clone `<repo>` is its worktree). Outside `.repos/<host>/<owner>/<folder>`, or outside the root, it says so and exits 1.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| layout    | `get <url\|key> [-b <branch> [--from <ref>]]`         | The one write into the layout, idempotent: make `<key>` ready here and print its path, the only thing on stdout. Clone to `.repos/<key>` if missing (blobless unless `.ken.yaml` says `clone.blobless: false`; a key alone resolves through the host as `https://<key>.git`; an empty remote leaves an unborn default branch; a failed clone leaves no folder behind and names the command to rerun). A clone already there is used as it is, with no fetch; anything else there, a plain folder, a file, a link or a worktree, is refused and left untouched. Every time, set `worktree.useRelativePaths` and run `git worktree repair` in the clone, so `mv` then `get` adopts a clone; a git older than 2.48 is refused. When no index, the root's or a layer's, has an entry for the key, write one without `desc` into the root's and say on stderr to run `ken index set <key> desc="..."`. With `-b`: create `<branch>` from the clone's default branch as it stands (no fetch), or from `--from`, and its worktree at `.repos/<key>.<folder>`; copy each file the repo's `.ken.yaml` lists from the clone to the same path in the worktree and run its `setup` there with `sh -c`, its output on stderr; print the worktree path. An existing branch gets its worktree, and `--from` with it is refused; a branch that already has one prints the existing path; the default branch prints the clone. An unborn default branch with no `--from` is refused: nothing to branch from. A folder in the way, or one in `<owner>/` differing only by case, is refused before anything is created. Branch creation is the lock: git's ref lock means two callers never get one branch, and the loser is told to rerun. A failure after it, up to reading `.ken.yaml`, removes the worktree and deletes the branch again; a failure in the copy, a missing source included, or the setup keeps the worktree and prints the commands to finish by hand. |
| index     | `repos [<key> \| --layer <name>] [--json]`            | The merged index times the disk. The root's `.repos/index.yaml`, then each layer's in `.ken.yaml` order, a whole entry winning by that order; a layer not cloned, offline, is left out with a line on stderr to run `ken init`. Then every folder at depth three under `.repos/` whose `.git` is a folder, a clone, and its `git worktree list`. One row per key, sorted: its `desc`, which workspace listed it (`root` or the layer's name), whether it is cloned and on which branch, its worktrees with branches, and each stray with the command that fixes it: a clone no index lists (`ken index set <key> desc="..."`); an entry with no `desc` (the same, with `--layer` when a layer listed it); a clone not on its default branch, `refs/remotes/origin/HEAD`, skipped when there is none (`git switch` back, then `ken get <key> -b <branch>`); a worktree beside the clone whose folder does not match its branch, or one outside the layout (`git worktree move` to its path); a detached worktree is listed, not a stray. `--layer <name>` keeps the keys that workspace's own index lists, `root` the root's. For one key: the same row, the merged entry and the index it came from, then the text files under the root that contain the key, the walk skipping hidden entries (so nothing in `.repos/`) and following the layer links at the top. `--json` is one array of rows, or one object with `entry` and `mentions` for a key. Offline.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
|           | `index set <key> <field>=<value>... [--layer <name>]` | Write fields into the root's index, or a layer's (`.repos/<layer key>/.repos/index.yaml`, the layer named in `.ken.yaml`). Creates the entry and its owner. An offline layer, not cloned, is refused with the `ken init` that clones it. A value is a YAML flow value (`tags=[sales,join]` a list), else the text as written. Comments, order and unknown fields are kept. Read, modify, validate, write beside, rename over.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
|           | `index unset <key> [<field>...] [--layer <name>]`     | Remove fields, or the whole entry; an owner left with nothing goes too. `desc` alone is not removed: set it, or unset the entry.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| layers    | `layer add <url\|key> [--as <name>]`                  | `get` into `.repos/`; symlink the clone at the root as `<name>`, default the repo name, with a relative link; symlink each of the layer's `.repos/<host>/<owner>/AGENTS.md` into the root's matching owner folder when the root has none there (the root's own wins); add `- [<name>](<name>/README.md): <first line of prose of the layer's README>` under `## Layers` in the front page, the heading made at the end when missing; last, append `{ name, key }` to `layers:` in `.ken.yaml`, keeping its comments and other keys, so a layer listed there is a layer complete. Refuses, before writing anything, a reserved name (in any case), a name anything is at (a dangling link included) or another layer has, and a key already a layer, naming the clash and suggesting `--as`. Each step checks before acting, so a rerun after a failure finishes the job: its own link to the clone is no clash. Prints what it did and the `git add` and `ken repos --layer <name>` to run next.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
|           | `layer remove <name>`                                 | Reverse of `add`: the front-page line, the owner links that point into the layer's clone and nothing else, the root link, then the `.ken.yaml` entry, last so a rerun still knows the key. The clone stays; it prints the `rm -rf "$(ken path code <key>)"` that deletes it. A name that is not a layer has nothing to remove, which it says, exiting 0.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| extension | `ken <name> ...`                                      | Decision 10. `ken-<name>` is looked for in `<root>/.bin/`, then each layer's `.repos/<layer key>/.bin/` in `.ken.yaml` order, then `PATH`; the first executable file wins, and a builtin is checked first. It runs with the arguments as given, stdio inherited and `KEN_ROOT` set to the real root, and `ken` exits with its code, 128 + the signal number when it was killed; a SIGINT, SIGQUIT, SIGTERM or SIGHUP sent to `ken` is passed on to it. Not found, `ken` names the folders it looked in, in order, and points at `ken help`, which lists the external commands found by where they came from; a match that is not executable is named with the `chmod +x` to run.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |

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
`find -L` and the READMEs are the interface; lint rules, thresholds and flows; status,
doctor, grep, promote, ingest.

## Layers

A layer is a root someone else adds: a front page, sections, `.repos/index.yaml`,
`.repos/<host>/<owner>/` context files, `.bin/`, optionally `.claude/`. Any root is one, so
there is no layer template: make a root, push it, and `ken layer add <key>` it from another;
its clones stay behind, ignored. What it should hold is what its readers should receive:
the root is private because it is yours, a layer is public because it is shared. Layers are one level deep: `ken` reads only the root's
`.ken.yaml`, so a layer's own `layers:`, `orgs` and `clone` do nothing for the root that adds
it, and a layer added inside a layer is a dangling link there. Installing one is `ken layer
add <key>`. Installing a root installs its layers, the
way `npm install` installs the dependencies: `git clone <root> ~/ken && ken init ~/ken`
clones every layer `.ken.yaml` lists, and a rerun after `git pull` gets one a teammate
added.

**Offline.** A layer listed in `.ken.yaml` with no clone on this machine is offline, such
as a company layer on a personal laptop. Offline is derived, never stored, so another
machine never sees it and a later `ken init` that clones it brings it back. The rest of the
root works without it: its link and owner links dangle, and its index, scripts and pages are
left out. `ken config`, `ken repos` and `index set --layer` name it offline and point at
`ken init`.

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
`npm create ken ~/ken && ken layer add github.com/acme/sales-atlas`; on a team that shares a
root, `git clone <root> ~/ken && ken init ~/ken`.

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
  knowledge base is, links the few evergreen pages, which live in sections like any other, gives one line per section with its
  page count and one line per layer. A section's README lists its pages one line each;
  over the cap it splits. GitHub renders a folder's README; `ken path <file>` prints the
  chain top down.
- **`log.md`** is append-only, one dated line per change, never read whole. Grepped by
  date or key; rolled per year if it bothers.
- **Sections** are the root's own: a folder at the top with a `README.md` listing its
  pages, made when a topic needs one. None is made up front, since nothing is assumed about
  what the root is for; an engineering team might split by Diátaxis type into `systems/`,
  `flows/`, `playbooks/`, `decisions/`. Pages are Markdown, each in a section: none sits at the top beside the front page. Code references are `<key>:<path>#<symbol>`. No `generated/`: a generated
  overview belongs in the repo's own README.
- **The LLM writes the index**, with judgment about grouping and what is evergreen. `ken lint`
  makes that safe: every page in exactly one section README, every link and code
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
- **Promote**: a settled note moves from a task to a page, or from the root to a layer.

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
  folder: tasks
template: # create-ken's section: what the root was scaffolded from, read by its --diff
  name: agents
  version: 0.0.0
```

Every key is optional, and one left empty is its default; a missing file is all defaults.
A key of the wrong type, or a YAML error, stops every command that reads the file, with the
file, the key and what it expects. `root` is refused
here, since the root is per machine. `layers` is written out, with no YAML anchor or alias,
since `layer add` and `layer remove` edit it in place, keeping comments and every other key. `ken config --json` prints one object: `root` and
`clone.blobless` as `{ value, source }`, `orgs`, `layers` with `cloned` and `linked` (the
clone and the root link exist, a hint; `cloned: false` is an offline layer, which `ken init`
clones), then every unknown section as written, so a tool
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

Plain-text tasks in one folder of the root, one file per task, the file's path as its
identity, tied to code by repo key and branch name. Its own package, `@unclex/ken-task`,
installed by the user beside `ken` and reached as `ken task` through `PATH` (decision
10); its PRD is `docs/ken-task.md`. It depends on `ken` for `config`,
`which`, `path code` and `get -b`, and `ken` never depends on it. The kernel knows two
things of it: the `task:` section of `.ken.yaml`, kept and printed, and a branch named
after a task, passed to `get -b` like any other.

## `ken-lint`

The knowledge-base lint, its own package, `@unclex/ken-lint`, installed beside `ken` and
reached as `ken lint` through `PATH` (decision 10), like `ken-task`. It is a package and
not a `.bin/` script because it parses Markdown as CommonMark (`mdast-util-from-markdown`),
so a link, a code span and a link's label are what a Markdown reader sees, never a guess
at where one ends. It reads `ken config --json` for the layers and the task folder, and
runs `ken path` for every code reference.

It walks the root's sections and each layer's, through the layer links as `find -L` does,
each folder once, skipping hidden entries and the task folder. Each problem names its file,
and its line when it has one, and what to do. Errors, exit 1: a page in no section
`README.md` or in more than one; a `.md` at the top of the root or a layer other than
`README.md`, `AGENTS.md`, `CLAUDE.md` and `log.md`, a page in no section; a Markdown link or
reference definition to a file that does not exist; a code reference, in prose or a code
span, that `ken path` resolves to a file not in the clone; the front page over 60 lines, a
section README over 150, the root `AGENTS.md` over 40, constants at the top of its source.
Notes, exit 0: references into repos not cloned, counted with the `ken get` to run; a page
nobody links to (a section README's listing does not count) and unchanged in a year by
`git log -1`, with the `git mv` into `.archive/`. Links and references in code blocks are
examples and not checked.

## `create-ken`

`npm create ken [<dir>] [--template <name>]` asks for what it was not given, copies the
template folder out of its own package, runs `git init`, runs `ken init <dir>` through
its pinned `@unclex/ken` so the rules have one source, and prints the next commands. No
logic beyond copy and prompt: anything that needs to know a rule is a kernel primitive.
Templates are bundled, not cloned, so a template version is tied to a kernel version.

It asks only on a terminal: for the directory, offering the configured root, and the
template, listing those it has. Off a terminal a missing `<dir>` is an error giving the
full command, and the template is `minimal`. A `<dir>` that exists and is not an empty
folder is refused, naming it, unless it is a root (it holds `.ken.yaml`): then, like `ken
init`, it adds the template's missing files and links, overwrites nothing, and says what it
added, so a root scaffolded from an older template picks up new files by running the same
command again. The template's name and create-ken's version are recorded under `template:`
in `.ken.yaml`, a section `ken` keeps and prints. `--diff` prints, for each template file,
the difference between the bundled template and the root's copy, missing files named, and
writes nothing: the agent reading it is the merge tool. There is no three-way merge: the
template is meant not to need one (see "Harness files"). npm publishes no `.gitignore` and
no symlink, so a template stores `gitignore`, renamed on copy, and `CLAUDE.md ->
AGENTS.md` and the template's other links are made after `ken init`. The next commands are
`cd <dir>`, the first commit, starting an agent there to say what the knowledge base is
for, and `ken layer add <key>` to join a team, led by the `export KEN_ROOT=` line when
`<dir>` is not the configured root.

`minimal` is the hello world: it assumes nothing about what the root is for, not even
software, so it holds no files of its own. The root is what `ken init` makes plus the
`CLAUDE.md` link, and an agent grows it from the `AGENTS.md`, `ken help` and the messages.
A layer starts the same way: any root is one (see "Layers").

| Template  | Holds                                                                                         |
| --------- | --------------------------------------------------------------------------------------------- |
| `minimal` | nothing beyond `ken init` and `CLAUDE.md -> AGENTS.md`: no sections, no `log.md`, no `.envrc` |
| `agents`  | `minimal` plus the harness files below: hooks, deny rules, skills, and the `.bin/` scripts    |

**Harness files.** Two of the four surfaces a harness reads have a standard every harness
checked honours (Claude Code, Codex and pi; OpenCode, Gemini CLI, Cursor and Copilot CLI on
most of it): `AGENTS.md` for instructions and `.agents/skills/<name>/SKILL.md` for skills,
the Agent Skills specification. Hooks have a de facto one: Codex reads Claude Code's hooks
schema and stdin/stdout contract unchanged, Cursor and Copilot read `.claude/settings.json`
hooks directly, and pi has no hook file at all, only TypeScript extensions. Deny rules and
PATH have nothing shared. So the `agents` template keeps one source for each shared
surface and one thin adapter per harness, each pointing at the shared file:

```
AGENTS.md                      every harness; Claude Code only while no CLAUDE.md is above it, so the link stays
.agents/skills/<name>/         Codex and pi read it; Claude Code does not: one link per skill in .claude/skills/
.agents/hooks.json             one hooks object in Claude Code's schema; Codex reads it as it is
.bin/ken-status                the script the session-start hook runs
.claude/settings.json          hooks (a copy of the object: a settings file holds other keys) and permissions.deny
.codex/hooks.json -> ../.agents/hooks.json
.pi/extensions/ken-hooks.ts    a shim: reads hooks.json, runs its SessionStart hooks on session_start
```

Hook lines name commands, `ken status`, not script paths. A command
resolves through decision 10, so the script behind it can move from the root's `.bin/` to a
layer's or to a package on `PATH` and update by `git pull` or an upgrade, while the hook
files never change; Codex and pi pin hooks by hash, so a hook file that never changes is
never re-trusted. The adapters change rarely; when they do, the re-run and `--diff` above
carry the change into an existing root. Codex and pi load a project's hooks, skills and
extensions only after a trust prompt, which the first-run message says; Codex then asks
again for the hooks, pinning each by hash. pi has no way to put a `session_start` handler's
output before the model, so the shim sends the `SessionStart` output with the first prompt. A deny rule is
Claude Code's alone: no other harness has a declarative path deny. Nothing in the template
puts `.bin/` on `PATH`: hooks and skills reach scripts as `ken <name>`, so only `ken` must
be on the `PATH` of the shell that starts the harness, which every harness inherits.

## Built on top

Not in any package here. Scripts live in `.bin/` of a root or a layer and reach `ken` as
`ken <name>`; skills hold judgment and call scripts and primitives for every fact; hooks
are one line each. Skills are tested with golden questions: ten to twenty real past
questions with known answers, run through a fresh session at the root and scored, rerun
after a docs, skill or model change.

| Piece                                                                  | Built from                                                                                                                                                                                      |
| ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ken-status`, run by the session-start hook as `ken status`            | `repos`, `config`, `ken task ready`: one screen so the agent never lists folders. A repo it shows as not cloned is the agent's to `ken get` before reading in it: no hook clones behind a tool. |
| deny rules in the root's `.claude/settings.json`, Claude Code only     | `.repos/**/node_modules/**`, `dist`, `.next`, `coverage`, lockfiles.                                                                                                                            |
| `ken-doctor`                                                           | `repos` plus `gh` for remote states, the lint, the strays `repos` names, clones with `AGENTS.md` and no `CLAUDE.md`, layers behind upstream.                                                    |
| `ken-pull`                                                             | entries for unlisted clones, `desc` from `gh repo view`, through `index set`.                                                                                                                   |
| `ken-grep`                                                             | `rg` over cloned repos in scope, paths passed explicitly; names the uncloned.                                                                                                                   |
| `ken-promote`                                                          | `git mv` plus `index unset` and `index set --layer`.                                                                                                                                            |
| `ken-jira`                                                             | Jira issue picker into `get <key> -b <issue>`; no task file involved.                                                                                                                           |
| skills: `start-task`, `where-is`, `ingest`, `kb`, `capture`, `promote` | the flows above. A team's playbooks are skills in its layer.                                                                                                                                    |

Sessions start at the root: that is where the hooks, skills and deny rules live, and the
only layout a harness that walks down from the git root understands. A session that must
start in a clone gets the root's skills and hooks as a plugin enabled at user scope. Two
documented traps: Claude Code reads `AGENTS.md` natively only while no `CLAUDE.md` exists
in the working directory or above it (its default `instructionFiles`), so an ancestor
`CLAUDE.md` hides a clone's `AGENTS.md` unless the clone has `CLAUDE.md -> AGENTS.md` or
the user sets `instructionFiles: claude-md-and-agents-md` in user settings; auto-memory is
keyed on the git repo, so every session at the root shares one memory.

## Path length

|                                                                                              | chars       |
| -------------------------------------------------------------------------------------------- | ----------- |
| `/Users/me/ken/.repos/github.com/acme/join-api-step-functions.portal-print-web-views-to-pdf` | 90          |
| `PATH_MAX` macOS / Linux                                                                     | 1024 / 4096 |
| Unix socket path (`sun_path`) macOS / Linux                                                  | 104 / 108   |
| Windows `MAX_PATH`                                                                           | 260         |

Not a problem on macOS or Linux. The one wall is a Unix socket created inside the tree,
handled by the root `.envrc`. If it ever bites: a host alias (`gh/` for `github.com/`) or
a shorter root. Windows needs `LongPathsEnabled` and `core.longpaths` regardless.

## Out of scope for now

- Windows.
- `.org` pages and org-agenda; pages are Markdown.
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
- **Extensions as volume dependencies: declared in `.ken.yaml`, cloned into `.repos/` by
  `init`, or pinned in a root `package.json`.** Then `ken` must say how to get one, and an
  extension may be a folder of a monorepo, a closed-source binary, or a Homebrew formula:
  defining acquisition is being a package manager. `.repos/` is the user's work, not
  `node_modules`. Like `git` and `kubectl`, `ken` finds `ken-<name>` on `PATH` and the user
  installs it as they install `ken`.

## Prior art

- The `ws` CLI and the sales-atlas design, the two halves this merges: a worktree per
  task and the `<host>/<owner>/<repo>.<branch>` layout from one; a manifest, curated docs,
  tiny `AGENTS.md`, skills, hooks and lazily cloned repos from the other.
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
