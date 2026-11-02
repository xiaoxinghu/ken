# ken — PRD

`ken`: the range of what one knows and can reach. A workspace root that is a knowledge
base, every git checkout inside it, shared knowledge arriving as layers, and a kernel CLI
that enforces the few rules which never change. This document is the kernel's: what it does
and why. It changes in the same PR as the behaviour; git is its history. The kernel it
describes is the shell script; `packages/ken` is its TypeScript predecessor until the port
lands.

What is built on the kernel has its own document: [`ken-task`](ken-task.md), the task
system; [`ken-lint`](ken-lint.md), the knowledge-base lint; [templates](templates.md), the
roots to start from and the harness files; [built on top](built-on-top.md), the scripts,
skills and flows. The two files the kernel reads and writes are specified in
[`files.md`](files.md).

## Problem

Work with agents spans many repositories, and the knowledge that ties them together, how
systems fit, which repo does what, why a decision was made, belongs to no single repository.
It is scattered: a `~/code` tree an agent cannot navigate without pasted absolute paths,
context files that do not cascade, notes in a private folder, team docs in a wiki nobody
reads. Every session starts from zero and is told where things are by hand.

Three audiences want one answer. **An individual**: one place to start every session,
private notes and tasks version-controlled, every repo reachable by name, context loading
in the right order unpasted. **A team**: a curated, shared knowledge base over its repos
that any member and any member's agent installs, keeps current and contributes to without
exposing private notes. **A tool user**: only parts of it, the layout with Jira for tasks,
or the knowledge base with no code at all. Nothing may require everything.

## The shape

The whole root is the knowledge base. Everything that is not knowledge has a reserved,
hidden name.

```
~/ken/                             your root: one git repo, private
  README.md                        the front page: evergreen pages, one line per section, one per layer
  AGENTS.md                        < 40 lines: the layout, the commands, pointers
  CLAUDE.md -> AGENTS.md
  log.md                           append-only, one dated line per change
  systems/  flows/  decisions/     sections, made as needed, each with a README.md
  sales-atlas -> .repos/github.com/acme/sales-atlas    a layer: its clone, as a section
  sales-atlas/handbook             a layer's own layer: nested in it, never at the root
  tasks/                           ken-task's folder, when installed
  .ken                             settings, key=value; holding one is what makes a root
  .gitignore                       .repos/*/*/*/   .env
  .envrc  .agents/  .claude/  .codex/  .pi/     a template's: env and harness files, not ken's business
  .bin/                            ken, the kernel itself, and ken-* scripts built on it
  .repos/                          every checkout, the root's and every layer's: hoisted here
    index                          one stanza per repo, cloned or not
    github.com/acme/AGENTS.md              owner-level context: tracked, on the cascade path
    github.com/acme/.envrc  .env           owner-level env, tracked; secrets, ignored
    github.com/acme/join-web/              the clone, on its default branch
    github.com/acme/join-web.PROJ-123/     a worktree, named for repo and branch
    github.com/acme/sales-atlas/           the layer's clone: a root itself, whose own .repos/ holds
                                           its index, owner files and links to hoisted clones
```

**Reserved names** at the root: `.repos`, `.bin`, `.ken`, `.agents`, `.claude`, `.codex`,
`.pi`, `.envrc`, `AGENTS.md`, `CLAUDE.md`, `log.md`, and `README.md` as the front page. `ken
init` creates the ones it owns; `ken layer add` refuses a section name that collides with
one, or with an existing section. Everything else at the root is a section.

## Decisions

1. **The root is the knowledge base.** Pages live at the top, in sections, each folder with
   a `README.md` that indexes it. Code, scripts and tool state live under reserved hidden
   names, so `ls ~/ken` shows knowledge and `rg -L <words> ~/ken` searches knowledge and
   nothing else: ripgrep skips hidden folders and `.gitignore` excludes the clones.
2. **The repo key is the address everywhere.** `<host>/<owner>/<repo>`, lowercase, is the
   index entry, the clone at `.repos/<key>`, the worktree at `.repos/<key>.<branch>` with
   `/` in the branch as `-`, and the prefix of a code reference. An agent that knows the key
   knows every path; nobody pastes absolute paths. The clone has no suffix because it holds
   the default branch, whatever its name; every other branch is a worktree beside it. Two
   branches that map to one folder, or a repo named `<repo>.<branch>`, collide: the second
   is refused, naming what is in the way. Never switch branches inside a clone or worktree.
3. **Checkouts are physically inside the top root, and hidden.** Context cascades only along
   a real path: a harness walks the ancestors of the physical working directory, and through
   a symlink only the target's ancestors load. So a session in a clone loads the root's
   `AGENTS.md`, the owner-level one and the clone's own, root first. The ignore rule
   `.repos/*/*/*/` matches directories at depth three, the clones and worktrees, and nothing
   else, so the index and the owner-level files are tracked.
4. **Shared and private never share a git history.** The root is yours. Anything shared is
   a layer: another root, cloned into `.repos/` and linked at the top as a section. A
   personal branch on a shared repo is private only socially, a fork of a public repo is
   public, encrypted files break under worktrees; two nested histories do not.
5. **The root is synced by git and nothing else.** Clones and `.env` are ignored, and a
   template ignores what its tools leave behind, so code and secrets never leave the machine
   through the root. The root never sits in iCloud, Syncthing or any file share: one missed
   exclusion uploads object stores and secrets.
6. **`ken` is a kernel of primitives.** A command is a primitive when it enforces a rule
   that will not change, or is the only safe way to do a file operation under those rules. A
   git command that carries no rule of ours is not wrapped: the agent runs git against the
   path `ken path` prints. Flows, hooks, lint, status and tasks are built on top and evolve
   without touching the kernel.
7. **Registration is the tool's job.** `.repos/index` describes every repo the workspace
   knows, cloned or not. `get` writes the entry, so a clone made by `ken` always has one, and
   `repos` names a clone that lacks one. The only writers are `get`, `index set` and `unset`,
   and writes are validated, atomic and taken in turn under `.repos/index.lock`, so writers at
   once lose nothing. Whether a repo exists is the remote's business; the key is inside the
   file, never in a file name.
8. **A folder's `README.md` is its index, and is read first.** The root's is the front page,
   under about 60 lines; a section's lists its pages one line each, under about 150. Front
   page, section, page: three hops, the first two small. Nothing derivable goes in: the repo
   list is `ken repos`, recent changes are `log.md`. The caps belong to `ken lint`.
9. **A code reference is `<key>:<path>#<symbol>`.** Never a line number, never an absolute
   path. `ken path <ref>` resolves it when the repo is cloned, else prints the repo's URL
   and says on stderr to `ken get <key>`.
10. **External subcommands.** `ken <name> ...` runs `ken-<name>` from the scope's `.bin/`,
    each direct layer's `.bin/` in `.ken` order, then `PATH`, with `KEN_ROOT` set; a builtin
    cannot be shadowed. A script that belongs to a root or layer lives in its `.bin/` and
    travels with git; a packaged tool is installed with whatever installs commands on the
    machine, and `ken` reads nothing but `PATH`. `ken` never fetches, pins or declares an
    extension: a root or layer that relies on one names it in its `AGENTS.md`. The protocol
    is the process model: argv, `KEN_ROOT`, inherited stdio, exit code, and one record per
    line, so an extension never knows what the kernel is written in.
11. **One settings file, shared without knowing.** `.ken` is `key=value` lines, and holding
    one is what makes a folder a root. The first segment of a key names the tool that owns
    it; `ken` keeps every key it does not own, so tools keep their settings in the one file
    and read them with `sed`. No other config exists: nothing per machine, nothing per repo.
12. **Tasks are not the kernel's business.** `ken` knows what a branch is, not what a task
    is. The seam with every task system is `get <key> -b <branch>`: Jira passes `PROJ-123`,
    `ken-task` passes a task's path, a human passes `feat/login`. What a new worktree needs
    beyond git, files copied and a setup command, is the task tool's job after `get -b`.
13. **No harness, no GitHub.** `ken` ships no hooks, settings or skills and does not know
    which harness runs it. It speaks git only: no remote checks, no `gh`. Those are scripts.
14. **Blobless, never shallow.** `get` clones with `--filter=blob:none`, which works with
    worktrees and costs first-touch latency only. A shallow clone breaks the second worktree
    and every fetch.
15. **Real paths.** On a case-insensitive disk `~/ken` and `~/Ken` are one folder. `ken`
    resolves roots with realpath and compares real paths, never strings, and refuses a
    branch whose folder would differ only by case from an entry of `<owner>/`.
16. **No exceptions to the layout.** A repo that must live at a fixed path stays in the
    layout and the user links that path to the clone. `ken` neither makes nor tracks such
    links.
17. **Every message is a next step.** Agents see nothing but the output. Every message,
    above all every error, says what is the case, why it matters, and what to run next, with
    the real keys and paths filled in. `ken help` and `ken <command> --help` carry the same
    examples.
18. **One shell script, and git.** The kernel is one POSIX `sh` file, `ken`, short enough to
    read in a sitting, whose only dependency is git 2.48 or newer, which the layout needs
    anyway. No runtime, no package, no build, no binary: a file anyone reads, diffs and
    copies. Its two files are the line formats of `files.md`, read by `awk` and `sed` in the
    kernel and by a few lines in any other language.
19. **The kernel travels with the root.** It lives at `.bin/ken` in the root it serves,
    tracked like `gradlew`, and finds its root from its own path. `git clone <root> ~/ken &&
    ~/ken/.bin/ken init` is the whole install, a symlink to it on `PATH` is the per-machine
    configuration, and a layer's `.bin/ken` is the version its team runs.
20. **Scope and top.** Every folder holding `.ken` is a root, and `ken` acts on the nearest
    one above the current directory, the scope, as git acts on the nearest repository:
    `KEN_ROOT` overrides; outside any root, the script's own root (19), then `~/ken`. A layer
    is a root, so `cd` into one scopes every command to it. Roots nest only through
    `.repos/`, and the outermost root reached that way is the top: every checkout lives in
    the top's `.repos/`, one clone per key per machine, however deep the layer that asked.
    `path code`, `which` and `get`'s clone answer from the top; the index, settings, `.bin/`
    and links are the scope's. Inside a layer, `ken` behaves as if that layer were your root,
    except that its code is hoisted and the resolver is the only thing that knows where.
21. **A layer contributes every surface a root has, and the nearer wins.** The order is the
    scope, then its layers in `.ken` order, each followed by its own, then `PATH`. Each
    surface unions by its own mechanism: pages by the link, index entries by merge, commands
    by lookup order, owner context and skills by a link where the scope has none. Checkouts
    are not a surface, they are hoisted. Settings are not a surface: a layer's `.ken`
    configures the layer alone. Hooks and deny rules are not a surface: hooks are the root's,
    one line each, and call commands.
22. **Layers install their layers, nested; only direct layers run.** Installing a layer
    clones the layers it lists, hoisted to the top, and makes its tracked links to them
    resolve, so a layer is complete wherever it is added: B, a layer of A, is the section
    `A/B`, never one of the root. Pages, index entries and owner context arrive
    transitively; commands and skills come only from a layer the scope lists itself, since
    those execute on your machine: what you add directly runs, what arrives through it is
    read. A layer reached twice is one clone with two links, found twice by search; the
    index merges first-wins in walk order. A cycle is visited once; an offline layer's own
    layers are unknown until it is cloned.

## The kernel: `ken`

Eight commands. Output is for a shell: a listing prints one record per line, tab-separated
under `--porcelain`. Everything is offline except `get` when the clone is missing, `layer
add`, and `init` when a layer's clone is missing.

| Command                                       | Does                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `init [<dir>]`                                | Make `<dir>`, default the cwd, a root with only what `ken` owns: `.ken` and `.repos/index`, each holding only a comment, `.bin/` with a copy of the running `ken` when none is there, and `.gitignore` with `.repos/*/*/*/` and `.env`, an existing one gaining only the lines it lacks. Never overwrites, and a rerun says nothing was created; writes no page and no `AGENTS.md`, those are a template's. Refuses a `<dir>` inside a root unless it is a checkout at that root's `.repos/<host>/<owner>/<repo>`, and so for every root above. Then reconciles (below). When `<dir>` is not the root `ken` would find from here, prints the `ln -s` onto `PATH` or the `KEN_ROOT=` to use. Does not `git init`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `path root \| code <key> [<branch>] \| <ref>` | The one resolver. `root`: the scope. `code`: the clone in the top's `.repos/`, or the worktree of `<branch>` beside it, whether or not it exists; `<key>` may be a git URL. `<key>:<path>[#<symbol>]`: `<clone>/<path>` when cloned, the symbol being the reader's to find; else `https://<key>.git`, exit 0, and stderr says to `ken get <key>`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `which [<path>]`                              | The reverse: `<key> <clone\|worktree> <branch>` for a path, default the cwd, compared real against the top's `.repos/`. An existing checkout is asked of git, a worktree keyed by its clone; a path not checked out yet is answered from its shape, with no branch, so a hook can ask about a repo not cloned (`<repo>.<x>` beside a clone `<repo>` is its worktree). A layer's clone is a checkout of the root above it. Outside `.repos/<host>/<owner>/<folder>`, in such a folder with no `.git`, or in a worktree of a clone outside the top's `.repos/`, exit 1 saying so and what to run: for that worktree, the `git worktree move` beside its clone.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `get <url\|key> [-b <branch> [--from <ref>]]` | The one write into the layout, idempotent: make `<key>` ready at the top and print its path, the only thing on stdout. Clone to `<top>/.repos/<key>` if missing: blobless unless the scope's `.ken` says `clone.blobless=false`, a key alone from `https://<key>.git`, a failed clone leaving no folder. `.repos` or the key's host or owner folder as a link is refused, since a clone under it would be outside the top. The `mkdir` of the clone's folder is the claim: of two gets at once one clones, and the other waits for it and uses its clone. A clone already there, a folder whose own `.git` folder git takes as its repo, is used as is, no fetch; anything else there is refused untouched, naming the `mv` aside, or the `git init` that makes a plain folder the repo. Every time: set `worktree.useRelativePaths`, `git worktree repair`, and when no index of the scope or its layers lists the key, write an entry into the scope's, saying on stderr to run `ken index set <key> desc="..."`. Git older than 2.48 is refused. `-b`: create `<branch>` from the default branch as it stands, the one the clone's HEAD names (a detached clone is refused with the `git switch`), or from `--from`, and its worktree `<clone>.<folder>`; print that. A bad branch name is refused before the clone is touched. An existing branch gets its worktree, `--from` with it is refused, a branch with a worktree prints it (its folder gone, the `git worktree prune` to run), the default branch prints the clone, an unborn default branch without `--from` is refused. A folder in the way, or one differing only by case, is refused before anything is made. Branch creation is the lock: two callers never get one branch, the loser is told to rerun without `--from`, and a failure after it removes the folder this caller made when empty, and the branch when no worktree holds it, saying so. A worktree holding `.ken` is a root: it is reconciled. Nothing is copied or run (decision 12). |
| `repos [--porcelain]`                         | The merged index times the disk: the scope's index, then each reachable layer's in walk order, a whole entry winning by that order; an offline layer left out with a line on stderr. One row per key, sorted: `desc`, which workspace listed it, whether cloned and on which branch, its worktrees, and each stray with the command that fixes it: no `desc`; a clone not on its default branch (`refs/remotes/origin/HEAD`, skipped when none); a worktree whose folder does not match its branch, or outside the layout. At the top only, also every clone no index lists. `--porcelain`: key, desc, listed by, cloned, branch. Mentions of a key are `grep -rl`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `index set <key> <field>=<value>...`          | Write fields into the scope's index, creating the file and the entry. A field name is `[A-Za-z0-9_-]+`, not `repo`; a value is the rest of the argument as written, one line, not empty, a list its items separated by spaces. The one stanza is rewritten, the file written beside and renamed over; comments, order and unknown fields are kept. Says what it set and where. For a layer's index, `cd` into the layer.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `index unset <key> [<field>...]`              | Remove fields, or the whole entry and the blank line after it. `desc` alone is not removed: set it, or unset the entry. A field the entry lacks, or a key with no entry, is refused.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `layer add <url\|key> [--as <name>]`          | Refuses, before writing, a reserved name in any case, a name anything is at (a dangling link included) or another direct layer has, and a key already a direct layer, suggesting `--as`. Then `get` it, link it at the scope as `<name>` (default the repo name, relative), append `layer.<name>=<key>` to `.ken` keeping its comments and other keys, and reconcile. Each step checks before acting, so a rerun finishes a job that failed halfway. Prints what it did and the `git add` to run; the front-page line is the agent's, checked by `ken lint`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `layer remove <name>`                         | Remove its `.ken` line and its link, then reconcile. The clones stay; it prints the `rm -rf "$(ken path code <key>)"` that deletes this one. A name that is not a layer has nothing to remove, which it says, exit 0.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `ken <name> ...`, `help [<command>]`          | Decision 10: the first executable `ken-<name>` in the scope's `.bin/`, each direct layer's, then `PATH`, run by `exec` with `KEN_ROOT` the real scope, so signals and the exit code are its own. Not found, `ken` names the folders it looked in; a match that is not executable is named with the `chmod +x` to run. `help` prints every command with examples, and the external commands found by where they came from.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |

**Reconcile**, the one place derived state is made to match `.ken`, run by `init`, `layer
add`, `layer remove` and `get -b` of a root: walk the scope's layers and theirs (22). Clone
each missing one as `get` does, unattended: `GIT_TERMINAL_PROMPT=0`, no askpass, ssh
`BatchMode=yes` with a connect timeout and keepalive added after the ssh word of the user's
own command, http low-speed limits. In each layer's clone, link `.repos/<key>` of each of
its layers to the hoisted clone and list the link in that clone's `.git/info/exclude`. At
the scope, link each reachable layer's `.repos/<host>/<owner>/AGENTS.md` and each direct
layer's `.agents/skills/<name>` where the scope has none, and remove such links into clones
no longer reachable. A clone already there is left alone, no fetch. A layer that cannot be
cloned is offline on this machine: said on stderr with git's reason and the `ken init` to
rerun, exit 0.

**Everything else is git**, run against the path `ken path` prints: `git worktree list`,
`git worktree remove` and `git branch -d` to finish a branch; `rm -rf "$(ken path code
<key>)"` to drop a clone, the entry staying so the repo is lazy again; `git init "$(ken path
code <key>)"` then `ken get <key>` for a new repo; `mv <old> "$(ken path code <key>)"` then
`ken get <key>` to adopt one; `git pull` in a layer's clone to update it. `ken` prevents at
the one write it owns and detects everywhere else, in `repos`.

**Guards.** A key is `<host>/<owner>/<repo>` with one slash each, each part letters, digits,
`.`, `_` and `-`, neither `.` nor `..`; a URL's `.git` is dropped and its userinfo never
printed. A branch must pass `git check-ref-format --branch`, and `@` is refused as `git
branch` refuses it. A root that does not exist, or is not a folder, is an error naming the
path and where it came from. Relative worktree paths (git 2.48) let a whole `<owner>/`
folder move with `mv`; moving one repo folder alone needs `git worktree repair`, which `get`
runs.

**Deliberately not in `ken`:** a `config` command (the file is the API); any knowledge
command (the file system is the union; `rg -L`, `find -L` and the READMEs are the
interface); editing any Markdown; copying files or running a setup in a new worktree;
`--layer` flags (`cd` into the layer); tasks and branch naming; anything about a harness;
anything about GitHub beyond git; git commands that carry no rule; lint rules, thresholds
and flows; status, doctor, grep, promote, ingest.

## Layers

A layer is a root someone else adds: a front page, sections, `.repos/index`, owner-level
context files, `.bin/`, `.agents/skills/`, and layers of its own. Any root is one, so there
is no layer template: make a root, push it, `ken layer add <key>` it from another.
Installing a root installs its layers the way `npm install` installs dependencies:
`git clone <root> ~/ken && ~/ken/.bin/ken init` clones every layer `.ken` lists, and
theirs, and a rerun after `git pull` gets one a teammate added.

**A layer is a workspace.** Its clone holds `.ken`, so `cd ~/ken/sales-atlas` scopes every
command to it (decision 20):

| inside `~/ken/sales-atlas` | acts on                                                                   |
| -------------------------- | ------------------------------------------------------------------------- |
| `path code`, `which`       | the top's checkouts, shared with the root                                 |
| `get`                      | clones at the top, registers the entry in the layer's index               |
| `repos`                    | the layer's index and its layers', against the top's disk                 |
| `index`, `layer`, `init`   | the layer's index, `.ken` and links                                       |
| `ken <name>`               | the layer's `.bin/`, then its direct layers', then `PATH`; not the root's |

Two things are not as if it were your root. Context cascades along the physical path, so a
session in a clone loads the top's `AGENTS.md`, not the layer's; the owner-level links close
most of that gap. And the clone is on its default branch, so a contribution is made in a
worktree, `ken get <key> -b <branch>`, which holds `.ken` and is a root with the same
guarantees. Dispatch sets `KEN_ROOT` to the scope; an extension that needs code asks
`ken path code`, which answers from the top.

**Nested, hoisted.** A layer's layers are sections inside it, `sales-atlas/handbook`, never
of the root; their clones are hoisted to the top, and reconcile makes the layer's tracked
link resolve with a link in the layer's `.repos/`, excluded locally. The root's section
namespace stays what its owner chose, the tree is visible in the file system, and no layer
ever holds a clone.

**Offline.** A layer listed in `.ken` with no clone on this machine, such as a company
layer on a personal laptop, is offline. Offline is derived, never stored, so another
machine never sees it and a later `ken init` brings it back. The rest works without it: its
links dangle, its index, scripts, skills and layers are left out, and `ken repos` names it.

**Two unions.** Pages: the link is the union; `~/ken/sales-atlas/handbook/x.md` is a page
through two links and `rg -L` finds it. Index entries: `ken repos` merges the scope's index
with each reachable layer's in walk order, a whole entry winning by that order, so a team
layer lists the team's repos once and everyone who adds it can `ken get` any of them by key.

**Update** is `git pull` in the layer's clone, then `ken init` for anything it now lists.
**Contribute** is a move into a worktree of the layer: a page from a root section into the
layer's, or an entry with `index unset` here and `index set` there; then a branch and a PR.
Private notes never touch the shared history. **A new joiner** with nothing of their own:
`ken init ~/ken && ken layer add github.com/acme/sales-atlas`; on a team that shares a root,
`git clone <root> ~/ken && ~/ken/.bin/ken init`. **A layer is a unit of sharing, not of
organisation**: a group of repos only you care about is a section and tags; it becomes a
layer the day someone else should receive it, or it needs a different visibility.

## The index: `.repos/index`

One text file per workspace, at the top of the tree it describes: a stanza per repo and
one per owner where owner-level facts have a home ([`files.md`](files.md)).

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
```

`desc` lets an agent choose a repo before cloning. An entry without one is valid, because
`get` writes the entry before anyone has described the repo, and `ken repos` flags it.
`kind`, `tags`, `depends_on`, `lifecycle`, `owner` filter or link and keep a Backstage
export possible; `doc` points at a page; unknown fields are kept. Anything longer than a
line is a page the entry points at. Each stanza stands on its own, so editing one never
changes another. The layout never depends on the index: a key in no index is still a valid
address. Listed but not cloned is the lazy state; a script that asks the remote tells a
typo from a lazy repo.

## The knowledge base

The root holds what no single repo can hold: how systems fit together, flows that cross
repos, where logs point, why decisions were made. A page about one repo is a smell: the
one-line `desc` plus the repo's own README is the per-repo documentation, and a thin repo
gets a README PR. A page on how we use a third-party repo and where it bites belongs here.

- **A `README.md` per folder is the index** (decision 8). The front page says what the
  knowledge base is, links the few evergreen pages, which live in sections like any other,
  and gives one line per section with its page count and one per layer. A section's README
  lists its pages one line each; over the cap it splits.
- **`log.md`** is append-only, one dated line per change, never read whole: grepped by date
  or key, rolled per year if it bothers.
- **Sections** are folders at the top with a README, made when a topic needs one; none up
  front, since nothing is assumed about what the root is for. Pages are Markdown, each in a
  section, none beside the front page. No generated pages: an overview belongs in the repo's
  own README.
- **The LLM writes the index**, with judgment about grouping and what is evergreen;
  [`ken-lint`](ken-lint.md) makes that safe.
- The root `AGENTS.md` stays under 40 lines: context files cost tokens on every turn and
  help only for the non-obvious. Everything else loads when a question needs it.

The flows that fill it, ingest, query, promote, are skills and scripts: see
[built on top](built-on-top.md).

## Configuration

Per machine, nothing to edit. The root is `KEN_ROOT` when set; else the scope, the nearest
`.ken` above the cwd, compared real; else the root the script runs from, a symlink on `PATH`
resolved; else `~/ken`. State `ken` owns on a machine belongs in `~/.local/state/ken`.

Per root, `.ken`, tracked, `key=value` lines:

```
clone.blobless=true
org.me=github.com/xiaoxinghu
layer.sales-atlas=github.com/acme/sales-atlas
task.folder=tasks
```

Every key is optional and an empty file is all defaults. A line `ken` cannot read stops
every command that reads the file, naming the file, the line and what it expects. `root` is
refused here, since the root is per machine. `layer add` and `remove` edit the `layer.*`
lines in place. A tool reads its key with `sed -n 's/^task\.folder=//p' "$KEN_ROOT/.ken"`.
Environment is direnv's job and a template's: see [templates](templates.md).

## Path length

The longest worktree path here is near 90 characters,
`/Users/me/ken/.repos/github.com/acme/join-api-step-functions.portal-print-web-views-to-pdf`,
against `PATH_MAX` of 1024 on macOS and 4096 on Linux. The one wall is a Unix socket created
inside the tree, 104 bytes on macOS, which the template's `.envrc` handles. If it ever
bites: a host alias such as `gh/` for `github.com/`, or a shorter root.

## Out of scope for now

Windows (`MAX_PATH` 260, `core.longpaths`); `.org` pages; GitLab subgroups, an owner with
slashes; repos with submodules, no worktrees until git recommends them; a union file system
for layers, the link per layer is the overlay; a Backstage export; encrypting anything in a
shared layer.

## Considered and rejected

- **One card file per repo, named by key.** A stray rename makes a phantom repo; the key
  belongs inside a file.
- **Metadata inside the clone, tracked by the root.** Git never tracks files inside a nested
  repo, and the entry must outlive the clone for lazy cloning.
- **The index derived from mentions.** Coverage would rest on discipline; registration is
  the tool's job.
- **A folder per repo holding `main/`, `<branch>/`.** Tools that name a project after its
  folder show `main` for every repo; doubling the name lengthens every path.
- **A hidden clone root with a symlink view.** Generated state nobody owns, the `main`
  problem again, and `rg` finds everything twice.
- **Generated per-repo overview pages, a single `INDEX.md`, a `kb/` or `layers/` folder,
  knowledge commands in the kernel.** Stale copies, unbounded files, three folders for one
  job; the root is the knowledge base and the file system is the union.
- **Tasks in the kernel.** A Jira user must adopt `ken` without a task system; the seam is
  `get -b`.
- **Wrapping git: `clone`, `new`, `adopt`, `remove`, `worktree add|remove|ls`, `open`.**
  Commands whose only rule was the path. One idempotent `get`, one resolver, the rest git.
- **Code outside the root, linked in.** Through a symlink only the target's ancestors load
  context, so the cascade breaks.
- **A personal branch, a fork, or git-crypt for private content.** Private only socially,
  public by construction, broken under worktrees.
- **Shallow clones.** Break the second worktree and every fetch.
- **Extensions as dependencies declared in `.ken` or a `package.json`.** Then `ken` must say
  how to get one, and an extension may be a monorepo folder, a closed binary or a Homebrew
  formula: defining acquisition is being a package manager. Like `git` and `kubectl`, `ken`
  finds `ken-<name>` on `PATH`.
- **A TypeScript kernel on npm, or a compiled binary.** The first release was a pnpm monorepo
  on node 24: a runtime to install, a registry, a package to maintain, for commands that are
  mostly `git` and `mkdir`. A binary asks for trust nobody can check. One shell file is
  read, diffed and copied.
- **YAML for the files, or git's config format.** YAML: one dependency and a
  comment-preserving editor for values that never exceed a line. git config: free parsing
  and locking, but its semantics come along, keys allow no `_`, fold case, and `[include]`
  pulls in files. The line formats of `files.md` are owned here.
- **A scaffolding package.** Copying a template out of a package is `git clone`.
- **Layers one level deep.** A layer whose pages link to its own layers was broken wherever
  it was added; hoisting removed the reason (22).
- **Hoisting with a link per clone in each layer's `.repos/`**, pnpm's mechanism. The folder
  is tracked, `.repos/*/*/*/` does not match links, and the links are state nobody owns.
  The resolver knows where code is; only the links a tracked layer link needs are made.
- **Transitive commands.** Scripts from repos you never named on your command path, npm's
  supply-chain problem. Pages are read; commands run from direct layers only.
- **`ken config`, `--layer`, `ken path layer|repos|bin|<file>`, `repos <key>`.** Each
  restated a rule or reached into a layer: the file is the API, the link is the resolver,
  `cd` is the scope, `grep -rl` finds mentions.
- **Copy and setup in `get -b`, and a per-repo `.ken`.** Not a rule, the kernel's only
  execution of configured commands, and a `.ken` in a clone would read as a root marker.
- **The kernel editing `README.md`.** One line per layer is a lint rule; the agent writes
  it. The kernel touches no knowledge content.

## Prior art

- The `ws` CLI and the sales-atlas design, the two halves this merges: a worktree per task
  and the `<host>/<owner>/<repo>.<branch>` layout; a manifest, curated docs, tiny
  `AGENTS.md`, skills, hooks and lazily cloned repos.
- Google `repo` and Zephyr `west`: listed but not synced is the lazy state. mani, tsrc:
  `desc` and `tags` per repo. Backstage: the entry vocabulary.
- Karpathy's LLM wiki: index first, append-only log, ingest, query, lint. llms.txt,
  Diátaxis, matklad's ARCHITECTURE.md: the front-page shape, doc types, names not lines.
  "Evaluating AGENTS.md" (ICLR 2026): context files cost on every turn.
- git, cargo, gh, kubectl: `<tool>-<name>` subcommands and a root variable for children.
  rbenv: the same, in 130 lines of shell. GNU Stow: the symlink overlay.
- ghq, gwq, worktrunk, git-repo-manager: `<root>/<host>/<owner>/<repo>` placement, one verb
  that puts a repo in place, worktrees beside the clone. vibe-kanban, git-town, Linear,
  `gh issue develop`: the identifier in the branch name is the join key.
- `gradlew`, `mvnw`, the `repo` launcher: the tool vendored in the tree it serves. yadm,
  `git-subtree`, myrepos: one file wrapping git, installed by copying.
- `deb822` and `/etc/os-release`: the stanza and `key=value` formats.
- git's repository discovery and submodules: the nearest root is the scope. pnpm: one
  hoisted store, the logical tree kept. npm: transitive install, and the supply-chain lesson
  that made commands direct-only.
