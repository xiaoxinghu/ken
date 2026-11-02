# ken — PRD

`ken`: the range of what one knows and can reach. A workspace root that is a knowledge
base, with every git checkout inside it, shared knowledge arriving as layers, and a kernel
CLI that enforces the few rules which never change. This document says what the system
does; while nothing is implemented it says what the first release does, and from then on
it changes in the same PR as the behaviour. Git is its history. The kernel it describes is
the shell script; `packages/ken` is its TypeScript predecessor until the port lands.

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
  sales-atlas/handbook             a layer's own layer: nested in it, never at the root
  tasks/                           ken-task's folder, when installed; one file per task
  .ken                             settings: layers, orgs, clone, a key prefix per tool
  .gitignore                       .repos/*/*/*/   .env
  .envrc                           direnv root: dotenv_if_exists; socket paths to $TMPDIR
  .bin/                            ken, the kernel itself, and ken-* scripts built on it
  .agents/                         skills and hooks.json, the files every harness shares; not ken's business
  .claude/  .codex/  .pi/          one thin adapter per harness, pointing into .agents/; not ken's business
  .repos/                          every checkout, the root's and every layer's: hoisted here
    index                          one stanza per repo, cloned or not
    github.com/acme/AGENTS.md              owner-level context: tracked, on the cascade path
    github.com/acme/.envrc                 owner-level env: source_up_if_exists; dotenv_if_exists
    github.com/acme/.env                   secrets: ignored
    github.com/acme/join-web/              the clone, on its default branch
    github.com/acme/join-web.PROJ-123/     a worktree, named for repo and branch
    github.com/acme/sales-atlas/           the layer's clone, a root itself; in its .repos/ only
                                           the index, owner files, and links to hoisted clones
```

**Reserved names** at the root: `.repos`, `.bin`, `.ken`, `.agents`, `.claude`, `.codex`, `.pi`, `.envrc`,
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
   entry in `.repos/index`, the clone at `.repos/<key>`, the worktree at
   `.repos/<key>.<branch>`, and the prefix of a code reference `<key>:<path>#<symbol>`. An
   agent that knows the key knows every path; nobody pastes absolute paths. The clone has
   no branch suffix because it holds the default branch, whatever it is called. Every
   other branch is a worktree beside it, with `/` in the branch name written as `-`. Two
   branches that map to one folder, or a repo actually named `<repo>.<branch>`, collide:
   the second is refused, naming what is in the way. A worktree holds the branch it was
   made for and the clone holds the default branch: never switch branches inside either.
3. **Checkouts are physically inside the top root, and hidden.** Context cascades only along
   a real path: Claude Code walks every ancestor of the physical working directory to `/`,
   and through a symlink only the target's ancestors load. So a session in
   `.repos/github.com/acme/join-web/` loads the root's `AGENTS.md`, the owner-level one
   and the clone's own, root first; a session at the root loads the lower ones lazily on
   first read. The dot keeps code out of `ls` and `rg`. The gitignore rule is
   `.repos/*/*/*/`: directories at depth three, the clones and worktrees, and nothing
   else, so `index` and the owner-level `AGENTS.md` and `.envrc` are tracked.
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
7. **Registration is the tool's job.** `.repos/index` describes every repo the
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
10. **External subcommands.** `ken <name> ...` runs `ken-<name>` from the scope's `.bin/`,
    each of its direct layers' `.bin/` in `.ken` order, then `PATH`, with `KEN_ROOT` set. A builtin cannot be
    shadowed. That is how `ken task` reaches `ken-task`, and how a team's scripts become
    commands by being in its layer. Two kinds, one contract: a script that belongs to a
    root or layer lives in its `.bin/` and travels with git; a packaged tool is installed
    by the user with whatever installs commands on their machine (npm, cargo, Homebrew,
    mise), and `ken` reads nothing but `PATH`. `ken` never fetches, pins or declares an
    extension: how to get one is the package managers' problem, in any language, and a root
    or layer that relies on one names it in its `AGENTS.md`. The protocol is the process
    model, argv, `KEN_ROOT`, inherited stdio, exit code, plus the one-record-per-line
    output of the builtins, so an extension never knows what the kernel is written in.
11. **One settings file, shared without knowing.** `.ken` at the root is `key=value` lines
    (`docs/files.md`), and holding one is what makes a folder a root. The first segment of a
    key names the tool that owns it; `ken` keeps every key it does not own, so tools built on
    `ken` keep their settings in the one file and read them with `sed`. There is no other
    config file: nothing per machine, nothing per repo.
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
18. **One shell script, and git.** The kernel is one POSIX `sh` file, `ken`, short enough
    to read in a sitting, whose only dependency is git 2.48 or newer, which the layout needs
    anyway. No runtime, no package, no build, no binary: a file anyone reads, diffs and
    copies. Its two files are the line formats of `docs/files.md`, read by `awk` and `sed`
    in the kernel and by a few lines in any other language.
19. **The kernel travels with the root.** It lives at `.bin/ken` in the root it serves,
    tracked by git like `gradlew`, and finds its root from its own path. So
    `git clone <root> ~/ken && ~/ken/.bin/ken init` is the whole install, a symlink to it on
    `PATH` is the per-machine configuration, and a layer's `.bin/ken` is the version its
    team runs. `KEN_ROOT` still overrides, and `~/ken` is the default when `ken` runs from
    outside any root.
20. **Scope and top.** Every folder holding `.ken` is a root, and `ken` acts on the nearest
    one above the current directory, the scope, as git acts on the nearest repository;
    `KEN_ROOT` overrides, and outside any root the script's own root (19), then `~/ken`. A
    layer is a root, so `cd` into one scopes every command to it. Roots nest only through
    `.repos/`, and the outermost root reached that way is the top: every checkout lives in
    the top's `.repos/`, one clone per key per machine, however deep the layer that asked.
    `path code`, `which` and `get`'s clone answer from the top; the index, the settings, the
    `.bin/` and the links are the scope's. Inside a layer, `ken` behaves as it would if that
    layer were your root, except that its code is hoisted and the resolver is the only thing
    that knows where. Paths are compared real (15), so the link at the root and the clone
    it points to are one scope.
21. **A layer contributes every surface a root has, and the nearer wins.** The order is
    the scope, then its layers in `.ken` order, each followed by its own layers, then
    `PATH`. Each surface unions by its own mechanism: pages by the link at the root, index
    entries by merge, commands by lookup order, owner context and skills by a link where
    the scope has none. Checkouts are not a surface, they are hoisted. Settings are not a
    surface: a layer's `.ken` configures the layer alone. Hooks and deny rules are not a
    surface: hooks are the root's, one line each, and call commands.
22. **Layers install their layers, nested; only direct layers run.** Installing a layer
    clones the layers it lists, hoisted to the top, and makes its tracked links to them
    resolve, so a layer is complete wherever it is added: B, a layer of A, is the section
    `A/B`, never a section of the root. Pages, index entries and owner context arrive
    transitively; commands and skills come only from a layer the scope lists itself, since
    those execute on your machine: what you add directly runs, what arrives through it is
    read. A layer reached twice is one clone with two links, and search finds its pages
    twice; the index merges first-wins in walk order. A cycle is visited once; an offline
    layer's own layers are unknown until it is cloned.

## Pieces

| Piece              | Command    | Owns                                                               |
| ------------------ | ---------- | ------------------------------------------------------------------ |
| `ken`, one script  | `ken`      | the kernel: root, layout, index, layers, dispatch; `docs/files.md` |
| `@unclex/ken-task` | `ken task` | plain-text tasks in one folder; `docs/ken-task.md`                 |
| `@unclex/ken-lint` | `ken lint` | the knowledge-base lint                                            |

The kernel is published nowhere: it is `ken` in this repo, and `.bin/ken` in every root
(decision 19). The extensions are npm packages under `@unclex`, one way to install them, not
a dependency of the design: `ken` and an extension are commands on `PATH`, however they got
there. There is no scaffolding package: `ken init` makes a root, and a template is a root
(see "Templates").

## The kernel: `ken`

Eight commands. Output is for a shell: a listing prints one record per line, tab-separated
under `--porcelain`. Everything is offline except `get` when the clone is missing,
`layer add`, and `init` when a layer's clone is missing. "Scope" and "top" are decision 20.

| Group     | Command                                          | Does                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| --------- | ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| root      | `init [<dir>]`                                   | Make `<dir>`, default the current directory, a root with only what `ken` owns: `.ken`, `.repos/index` (empty), `.bin/` with a copy of the running `ken` when none is there (19), and `.gitignore` with `.repos/*/*/*/` and `.env` (an existing one gains only the lines it lacks). Never overwrites, so a rerun creates nothing; writes no page, no `AGENTS.md`: those are a template's. Refuses a `<dir>` under a root unless through its `.repos/` (20). Then reconciles the layers, the one place derived state is made to match `.ken`: walking the scope's layers and theirs (22), clone each missing one as `get` does, unattended (`GIT_TERMINAL_PROMPT=0`, no askpass, ssh `BatchMode=yes` with a connect timeout and keepalive put after the ssh word of the user's own command, http low-speed limits); in each layer's clone, link `.repos/<key>` of each of its layers to the hoisted clone and list the link in the clone's `.git/info/exclude`; at the scope, link each reachable layer's `.repos/<host>/<owner>/AGENTS.md` and each direct layer's `.agents/skills/<name>` where the scope has none, and remove such links into clones no longer reachable. A clone already there is left alone, no fetch. A layer that cannot be cloned is offline on this machine: said on stderr with git's reason and the `ken init` to rerun, exit 0. When `<dir>` is not the root `ken` would find from here, prints the `ln -s` onto `PATH` or the `KEN_ROOT=` to use. Does not `git init`. |
| resolve   | `path root \| code <key> [<branch>] \| <ref>`    | Forward. `root`: the scope. `code <key> [<branch>]`: the clone in the top's `.repos/`, or the worktree of `<branch>` beside it, `/` as `-`, whether or not it exists. `<key>:<path>[#<symbol>]`, a code reference: `<clone>/<path>` when cloned (the symbol is the reader's to find), else `https://<key>.git` with exit 0 and a line on stderr to run `ken get <key>`. A `<key>` may be a git URL.                                                                                                                                                                                                                                                                                                                                                                                                                                 |
|           | `which [<path>]`                                 | Reverse. For a path, default the cwd, compared as a real path against the top's `.repos/`: `<key> <clone\|worktree> <branch>`. An existing checkout is asked of git, a worktree keyed by its clone; a path not checked out yet is answered from its shape, with no branch, so a hook can ask about a repo not cloned (`<repo>.<x>` beside a clone `<repo>` is its worktree). A layer's clone is a checkout of the root above it. Outside `.repos/<host>/<owner>/<folder>`, or outside the top, exits 1 saying so.                                                                                                                                                                                                                                                                                                                                          |
| layout    | `get <url\|key> [-b <branch> [--from <ref>]]`    | The one write into the layout, idempotent: make `<key>` ready at the top and print its path, the only thing on stdout. Clone to `<top>/.repos/<key>` if missing (blobless unless the scope's `.ken` says `clone.blobless=false`; a key alone clones `https://<key>.git`; an empty remote leaves an unborn default branch; a failed clone leaves no folder and names the command to rerun). A clone already there is used as it is, no fetch; anything else there is refused and left untouched. Every time, set `worktree.useRelativePaths`, run `git worktree repair`, and when no index of the scope or its layers lists the key, write an entry into the scope's and say on stderr to run `ken index set <key> desc="..."`. A git older than 2.48 is refused. With `-b`: create `<branch>` from the default branch as it stands (no fetch), or from `--from`, and its worktree at `.repos/<key>.<folder>`; print that path. An existing branch gets its worktree, `--from` with it is refused, a branch with a worktree prints it, the default branch prints the clone, an unborn default branch without `--from` is refused. A folder in the way, or one in `<owner>/` differing only by case, is refused before anything is made. Branch creation is the lock: two callers never get one branch, and the loser is told to rerun; a failure after it undoes what this caller made. A worktree of a repo that holds `.ken` is a root (20): its layers are reconciled as `init` does. Nothing is copied or run: that is the task tool's, after `get -b` returns. |
| index     | `repos [--porcelain]`                            | The merged index times the disk. The scope's `.repos/index`, then each reachable layer's in walk order (22), a whole entry winning by that order; an offline layer is left out with a line on stderr. One row per key, sorted: its `desc`, which workspace listed it, whether it is cloned at the top and on which branch, its worktrees, and each stray with the command that fixes it: an entry with no `desc`; a clone not on its default branch (`refs/remotes/origin/HEAD`, skipped when none); a worktree whose folder does not match its branch, or one outside the layout. At the top only, also every clone no index lists: disk strays are the top's. `--porcelain`: one line per key, tab-separated, key, desc, listed by, cloned, branch. Which pages mention a key is `grep -rl` (decision 1).                                                                                                                                                                                                                                      |
|           | `index set <key> <field>=<value>...`             | Write fields into the scope's index, creating the entry when missing. A value is the text as written; a list field is its items separated by spaces (`tags="sales join"`); `desc` is not empty. Comments, order and unknown fields are kept: the one stanza is rewritten, the file written beside and renamed over (`docs/files.md`). To write a layer's index, `cd` into the layer (20).                                                                                                                                                                                                                                                                                                                                                                                                                                             |
|           | `index unset <key> [<field>...]`                 | Remove fields, or the whole entry. `desc` alone is not removed: set it, or unset the entry.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| layers    | `layer add <url\|key> [--as <name>]`             | Refuses, before writing, a reserved name (in any case), a name anything is at (a dangling link included) or another direct layer has, and a key already a direct layer, naming the clash and suggesting `--as`. Then `get` it; link it at the scope as `<name>`, default the repo name, relative; append `layer.<name>=<key>` to `.ken`, keeping its comments and other keys; reconcile as `init` does, which brings its layers (22) and the owner and skill links. Each step checks before acting, so a rerun finishes a job that failed halfway. Prints what it did and the `git add` to run; the front-page line is the agent's, checked by `ken lint`.                                                                                                                                                                                                                                                                                 |
|           | `layer remove <name>`                            | Remove its `.ken` line and its link at the scope, then reconcile, which removes the owner and skill links into clones no longer reachable. The clones stay; it prints the `rm -rf "$(ken path code <key>)"` that deletes this one. A name that is not a layer has nothing to remove, which it says, exit 0.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| extension | `ken <name> ...`                                 | Decision 10. `ken-<name>` is looked for in the scope's `.bin/`, then each direct layer's `.repos/<key>/.bin/` in `.ken` order, then `PATH`; the first executable wins, a builtin is checked first. It runs with the arguments as given, stdio inherited and `KEN_ROOT` the real scope, by `exec`, so signals and the exit code are its own. Not found, `ken` names the folders it looked in and points at `ken help`, which lists the external commands found by where they came from; a match that is not executable is named with the `chmod +x` to run. `help [<command>]` prints every command with examples, or one in full.                                                                                                                                                                                                                                              |

**Everything else is git**, run by the agent or a script against the path `ken path`
prints: `git worktree list`, `git worktree remove` and `git branch -d` to finish a branch,
`rm -rf "$(ken path code <key>)"` and its worktrees to drop a clone (the entry stays, so
the repo is lazy again), `git init "$(ken path code <key>)"` then `ken get <key>` for a
new repo, `mv <old> "$(ken path code <key>)"` then `ken get <key>` to adopt one, `git pull`
in a layer's clone to update it. `ken` wraps no git command that carries none of its
rules; it prevents at the one write it owns and detects everywhere else, in `repos`.

**Collisions and guards.** A folder in the way of a clone or worktree is named in the
refusal. A key is validated as `<host>/<owner>/<repo>` with one slash each, each part
letters, digits, `.`, `_` and `-` and neither `.` nor `..`; a URL's `.git` is dropped and
its userinfo never printed. GitLab subgroups are out of scope. A branch must pass git's
own rules (`git check-ref-format --branch`), and `@` is refused as `git branch` refuses
it. A root that does not exist, or is not a folder, is an error naming the path and where
it came from.

**Deliberately not in `ken`:** a `config` command (the file is the API); a README chain
or any knowledge command (the file system is the union and `rg -L`, `find -L` and the
READMEs are the interface); editing any Markdown; copying files or running a setup in a new
worktree (the task tool's, after `get -b`); `--layer` flags (`cd` into the layer); tasks and
branch naming policy; anything about Claude Code or another harness; anything about GitHub
beyond git; git commands that carry no rule; lint rules, thresholds and flows; status,
doctor, grep, promote, ingest.

## Layers

A layer is a root someone else adds: a front page, sections, `.repos/index`,
`.repos/<host>/<owner>/` context files, `.bin/`, `.agents/skills/`, and layers of its own.
Any root is one, so there is no layer template: make a root, push it, and `ken layer add
<key>` it from another. Installing a root installs its layers the way `npm install` installs
the dependencies: `git clone <root> ~/ken && ~/ken/.bin/ken init` clones every layer `.ken`
lists, and theirs, and a rerun after `git pull` gets one a teammate added.

**A layer is a workspace.** Its clone holds `.ken`, so it is a root, and `cd ~/ken/sales-atlas`
scopes every command to it (decision 20):

| inside `~/ken/sales-atlas` | acts on                                                                 |
| -------------------------- | ----------------------------------------------------------------------- |
| `path code`, `which`       | the top's checkouts, shared with the root                               |
| `get`                      | clones at the top, registers the entry in the layer's index             |
| `repos`                    | the layer's index and its layers', against the top's disk               |
| `index`, `layer`, `init`   | the layer's index, `.ken` and links                                     |
| `ken <name>`               | the layer's `.bin/`, then its direct layers', then `PATH`; not the root's |

What is not as if it were your root: context cascades along the physical path, so a session
in a clone loads the top's `AGENTS.md`, not the layer's, which the owner-level links close
most of the way; and the clone is on its default branch, so a contribution is made in a
worktree, `ken get <key> -b <branch>`, which holds `.ken` and is a root with the same
guarantees. Dispatch sets `KEN_ROOT` to the scope; an extension that needs code asks
`ken path code`, which answers from the top.

**Nested, hoisted.** A layer's layers are sections inside it, `sales-atlas/handbook`, never
of the root; their clones are hoisted to the top like every checkout, and `init` makes the
layer's tracked link resolve with a link in the layer's `.repos/`, listed in that clone's
`.git/info/exclude`. The root's section namespace stays what its owner chose, the tree is
visible in the file system, `rg -L ~/ken` finds every page once unless the root also adds a
layer one of its layers brings, and no layer ever holds a clone (decision 22).

**Offline.** A layer listed in `.ken` with no clone on this machine is offline, such as a
company layer on a personal laptop. Offline is derived, never stored, so another machine
never sees it and a later `ken init` that clones it brings it back. The rest works without
it: its link and owner links dangle, its index, scripts, skills and layers are left out.
`ken repos` names it and points at `ken init`.

**Two unions, one in the file system and one in code.**

- Pages: the link is the union. `~/ken/sales-atlas/systems/x.md` is a page like any other,
  and `~/ken/sales-atlas/handbook/x.md` through two links; `rg -L` finds both.
- Index entries: `ken repos` merges the scope's `.repos/index` with each reachable layer's
  in walk order, the scope first; a whole entry wins by that order. One table. A layer
  contributes repos to your workspace just by being added: a team layer lists the team's
  repos once, and everyone who adds it can `ken get` any of them by key, with the
  description already there.

**Update** is `git pull` in the layer's clone, then `ken init` for anything it now lists.
**Contribute** is a move into a worktree of the layer: a page from a root section into the
layer's section, or an entry with `index unset` here and `index set` there; then the
ordinary flow, a branch, a PR. Private notes never touch the shared history. **A new
joiner** with nothing of their own: `ken init ~/ken && ken layer add github.com/acme/sales-atlas`;
on a team that shares a root, `git clone <root> ~/ken && ~/ken/.bin/ken init`.

**A layer is a unit of sharing, not of organisation.** A group of repos only you care
about is a section and tags in the root. It becomes a layer the day someone else should
receive it, or it needs a different visibility. Two direct layers cannot share a name.

## The index: `.repos/index`

One text file per workspace, at the top of the tree it describes: a stanza per repo, and
one per owner where owner-level facts have a home. The grammar is `docs/files.md`.

```
# .repos/index: what each repo is. Whether it exists is the remote's business.

owner: github.com/acme
desc: acme's GitHub org. Sales tribe repos are tagged sales.

repo: github.com/acme/join-web
desc: Front end for the direct-to-consumer join funnel.
kind: frontend
tags: sales join
depends_on: join-api
doc: systems/join.md

repo: github.com/acme/join-api
desc: Join API and step functions. Identity, payment, underwriting, then hand off.
kind: api
tags: sales join
lifecycle: production
owner: sales-squad-1
```

`desc` lets an agent choose a repo before cloning; when present it is not empty. An entry
without one is valid, because `get` writes the entry before anyone has described the repo,
and `ken repos` flags it with the `ken index set <key> desc="..."` to run. `kind`, `tags`,
`depends_on`, `lifecycle`, `owner` filter or link and keep a Backstage export possible;
`doc` points at a page. Unknown fields are kept. Anything longer than a line is a page the
entry points at. Each stanza stands on its own, so editing one never changes another.

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
  over the cap it splits. GitHub renders a folder's README.
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

Per machine, nothing to edit. The root is `KEN_ROOT` when set; else the scope, the nearest
folder holding `.ken` above the current directory, compared real; else the root the script
runs from, `<root>/.bin/ken`, a symlink on `PATH` resolved to it; else `~/ken`. `ken` sets
`KEN_ROOT` to the scope for every external subcommand. State `ken` owns on a machine
belongs in `~/.local/state/ken`.

Per root, `.ken`, tracked, `key=value` lines (`docs/files.md`):

```
clone.blobless=true
org.me=github.com/xiaoxinghu
layer.sales-atlas=github.com/acme/sales-atlas
task.folder=tasks
```

Every key is optional and an empty file is all defaults. A value `ken` cannot read, or a
line that is not `key=value`, stops every command that reads the file, naming the file, the
line and what it expects. `root` is refused here, since the root is per machine. `layer add`
and `layer remove` edit the `layer.*` lines in place, keeping comments and every other key.
There is no `config` command: a tool reads its own key with
`sed -n 's/^task\.folder=//p' "$KEN_ROOT/.ken"`, and `ken path root` prints the scope.

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
10); its PRD is `docs/ken-task.md`. It depends on `ken` for `which`, `path code` and
`get -b`, reads `task.folder` from `.ken`, and `ken` never depends on it. The kernel knows
two things of it: the `task.*` keys of `.ken`, kept, and a branch named after a task,
passed to `get -b` like any other. What a new worktree needs beyond git, files copied from
the clone and a setup command, is its job after `get -b` returns, not the kernel's.

## `ken-lint`

The knowledge-base lint, its own package, `@unclex/ken-lint`, installed beside `ken` and
reached as `ken lint` through `PATH` (decision 10), like `ken-task`. It is a package and
not a `.bin/` script because it parses Markdown as CommonMark (`mdast-util-from-markdown`),
so a link, a code span and a link's label are what a Markdown reader sees, never a guess
at where one ends. It reads `.ken` for the layers and the task folder, and runs `ken path`
for every code reference.

It walks the root's sections and each layer's, through the layer links as `find -L` does,
each folder once, skipping hidden entries and the task folders: the root's, and each
layer's from its own `.ken`, compared by real path; a `.ken` it cannot read stops it. Each problem names its file,
and its line when it has one, and what to do. Errors, exit 1: a page in no section
`README.md` or in more than one; a `.md` at the top of the root or a layer other than
`README.md`, `AGENTS.md`, `CLAUDE.md` and `log.md`, a page in no section; a Markdown link or
reference definition to a file that does not exist; a code reference, in prose or a code
span, that `ken path` resolves to a file not in the clone; a direct layer with no line under
`## Layers` in the front page, or a line there for no layer; the front page over 60 lines, a
section README over 150, the root `AGENTS.md` over 40, constants at the top of its source.
Notes, exit 0: references into repos not cloned, counted with the `ken get` to run; a page
nobody links to (a section README's listing does not count) and unchanged in a year by
`git log -1`, with the `git mv` into `.archive/`. Links and references in code blocks are
examples and not checked.

## Templates

A template is a root, pushed somewhere, with the kernel it was made with at `.bin/ken`.
Starting from one is `git clone <template> ~/ken && ~/ken/.bin/ken init`, then
`git remote remove origin` and the first commit; `init` fills in what the template left
out and overwrites nothing, so a root made from an older template picks up a newer one by
diffing against the template's clone, the agent being the merge tool. Starting from
nothing is `ken init ~/ken`. A template's `.ken` carries `template.name`, a key `ken`
keeps and prints. There is no scaffolding tool: anything that needs to know a rule is a
kernel primitive, and the rest is `git clone`.

`minimal` is the hello world: it assumes nothing about what the root is for, not even
software. It is what `ken init` makes plus a front page, an `AGENTS.md` that says how to
make a section and a page, and `CLAUDE.md -> AGENTS.md`; an agent grows it from there,
`ken help` and the messages. `ken init` alone writes no page: a root with no template has
`.ken`, an empty index and a `.bin/`, which is all a layer needs to be one. A layer starts the same way: any root
is one (see "Layers").

| Template  | Holds                                                                                         |
| --------- | --------------------------------------------------------------------------------------------- |
| `minimal` | `ken init` plus `README.md`, `AGENTS.md` and `CLAUDE.md -> AGENTS.md`: no sections, no `log.md`, no `.envrc` |
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
.agents/skills/<name>/         Codex and pi read it; a direct layer's skills are linked here by ken (decision 21)
.claude/skills -> ../.agents/skills   one link, so Claude Code sees every skill a layer brings (to verify: a folder link)
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
never re-trusted. The adapters change rarely; when they do, a diff against the template's clone
carries the change into an existing root. Codex and pi load a project's hooks, skills and
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
| `ken-status`, run by the session-start hook as `ken status`            | `repos`, `.ken`, `ken task ready`: one screen so the agent never lists folders. A repo it shows as not cloned is the agent's to `ken get` before reading in it: no hook clones behind a tool. |
| deny rules in the root's `.claude/settings.json`, Claude Code only     | `.repos/**/node_modules/**`, `dist`, `.next`, `coverage`, lockfiles.                                                                                                                            |
| `ken-doctor`                                                           | `repos` plus `gh` for remote states, the lint, the strays `repos` names, clones with `AGENTS.md` and no `CLAUDE.md`, layers behind upstream.                                                    |
| `ken-pull`                                                             | entries for unlisted clones, `desc` from `gh repo view`, through `index set`.                                                                                                                   |
| `ken-grep`                                                             | `rg` over cloned repos in scope, paths passed explicitly; names the uncloned.                                                                                                                   |
| `ken-promote`                                                          | `git mv` into a worktree of the layer, `index unset` here, `cd` there and `index set`.                                                                                                                                            |
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
- **Extensions as volume dependencies: declared in `.ken`, cloned into `.repos/` by
  `init`, or pinned in a root `package.json`.** Then `ken` must say how to get one, and an
  extension may be a folder of a monorepo, a closed-source binary, or a Homebrew formula:
  defining acquisition is being a package manager. `.repos/` is the user's work, not
  `node_modules`. Like `git` and `kubectl`, `ken` finds `ken-<name>` on `PATH` and the user
  installs it as they install `ken`.
- **A TypeScript kernel on npm, or a compiled binary.** The first release was a pnpm
  monorepo on node 24: a runtime to install, a registry to publish to, a package to
  maintain, for ten commands that are mostly `git` and `mkdir`. A binary asks for trust
  nobody can check. One shell file is read, diffed and copied, and asks for nothing.
- **YAML for the index and settings.** One dependency, a comment-preserving editor, for two
  files whose values never exceed a line. The line formats of `docs/files.md` instead.
- **git's config format for them.** Free parsing, locking and atomic writes, but its
  semantics come along: keys allow no `_`, fold case, and `[include]` pulls in other files.
  The formats are owned here, and a stanza edit is one `awk` line.
- **A scaffolding package, `create-ken`.** Copying a template out of a package is what
  `git clone` does; the prompt and `--diff` were the rest. A template is a root.
- **Layers one level deep.** A layer whose pages link to its own layers was broken wherever
  it was added. Hoisting removed the reason: its layers are cloned once at the top and
  nested inside it (decision 22).
- **Hoisting with a link per clone in each layer's `.repos/`**, pnpm's mechanism. The
  folder is tracked, the ignore rule `.repos/*/*/*/` does not match links, and the links
  are derived state nobody owns. The resolver knows where code is; only the links a tracked
  layer link needs are made, and excluded locally.
- **Transitive commands.** Adding one layer would put scripts from repos you never named on
  your command path, npm's supply-chain problem. Pages are read; commands run from direct
  layers only.
- **`ken config`, `--layer`, `ken path layer|repos|bin|<file>`, `repos <key>`.** Each
  restated a rule or reached into a layer. The file is the API, the link is the resolver,
  `cd` is the scope, `grep -rl` finds mentions.
- **Copy and setup in `get -b`, and the per-repo `.ken`.** Not a rule, the kernel's only
  execution of configured commands, and a `.ken` in a clone would read as a root marker.
  The task tool does it after `get -b`.
- **The kernel editing `README.md`.** One line per layer in the front page is a lint rule;
  the agent writes it, `ken lint` checks it. The kernel touches no knowledge content.

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
- `gradlew`, `mvnw`, Google's `repo` launcher: the tool vendored in the tree it serves.
- yadm, `git-subtree`, rbenv, myrepos: one shell or Perl file wrapping git, installed by
  copying; rbenv's `rbenv-<name>` dispatch.
- `deb822` control files and `/etc/os-release`: the stanza and `key=value` formats.
- git's repository discovery and submodules: the nearest root is the scope, and inside a
  nested one commands act on it.
- pnpm: one physical store, hoisted, with the logical tree kept; npm: transitive install,
  and the supply-chain lesson that made commands direct-only here.
