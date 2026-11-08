# ken — PRD

`ken`: the range of what one knows and can reach. A workspace root that is a knowledge
base, every git checkout on the machine in one folder beside it, shared knowledge arriving as
layers, and a kernel CLI that enforces the few rules which never change. This document is the kernel's: what it does
and why. It changes in the same PR as the behaviour; git is its history. The kernel it
describes is the shell script `ken` at the repo's root.

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
~/ken/                             your root: plain files, in git by default, private
  README.md                        the front page: evergreen pages, one line per section, one per layer
  AGENTS.md                        < 40 lines: where the CLI is, the page conventions, the traps
  CLAUDE.md -> AGENTS.md
  log.md                           the timeline: one line per action, written by the agents
  .sessions/<id>.md                the agents template's digest of each session a log line names
  systems/  flows/  decisions/     sections, made as needed, each with a README.md
  sales-atlas -> ~/src/github.com/acme/sales-atlas    a layer: its clone, as a section; derived
  sales-atlas/handbook             a layer's own layer: nested in it, never at the root
  tasks/                           ken-task's folder, when installed
  .ken                             settings, key=value; holding one is what makes a root
  .repos                           the index: one stanza per repo, cloned or not
  .gitignore                       .env
  .envrc  .agents/  .claude/  .codex/  .pi/     a template's: env and harness files, not ken's business
  .bin/                            ken, the kernel itself, and ken-* scripts built on it
~/src/                             KEN_SRC: every checkout on the machine, for every root on it
  AGENTS.md  CLAUDE.md -> ~/ken/AGENTS.md     the root's rules, above every checkout
  .envrc                           exports KEN_ROOT, sources ~/ken/.envrc
  github.com/acme/join-web/              the clone, on its default branch
  github.com/acme/join-web.PROJ-123/     a worktree, named for repo and branch
  github.com/acme/sales-atlas/           the layer's clone: a root itself, with its index and links
```

**Reserved names** at the root: `.repos`, the index, `.bin`, `.ken`, `.agents`, `.claude`, `.codex`,
`.pi`, `.envrc`, `AGENTS.md`, `CLAUDE.md`, `log.md`, and `README.md` as the front page. `ken
init` creates the ones it owns; `ken layer add` refuses a section name that collides with
one, or with an existing section. Everything else at the root is a section.

## Decisions

1. **The root is the knowledge base.** Pages live at the top, in sections, each folder with
   a `README.md` that indexes it. Scripts and tool state live under reserved hidden names and
   code outside the root (3), so `ls ~/ken` shows knowledge and `rg -L <words> ~/ken` searches
   knowledge and nothing else: ripgrep skips hidden names, and a link leads only into a
   layer, which is knowledge too.
2. **The repo key is the address everywhere.** `<host>/<owner>/<repo>`, lowercase, is the
   index entry, the clone at `$KEN_SRC/<key>`, the worktree at `$KEN_SRC/<key>.<branch>` with
   `/` in the branch as `-`, and the prefix of a code reference. An agent that knows the key
   knows every path; nobody pastes absolute paths. The clone has no suffix because it holds
   the default branch, whatever its name; every other branch is a worktree beside it. Two
   branches that map to one folder, or a repo named `<repo>.<branch>`, collide: the second
   is refused, naming what is in the way. Never switch branches inside a clone or worktree.
3. **Checkouts live in `KEN_SRC`, outside every root.** `KEN_SRC`, default `~/src`, holds
   every checkout on the machine as `<host>/<owner>/<repo>`, a branch's worktree beside it as
   `<repo>.<branch>`: one clone per key per machine, for every root on it. The folder is per
   machine, so it is an environment variable like `KEN_ROOT`, never a `.ken` key, which
   travels with the root; one inside a root is refused, since the root would then hold the
   code. Context cascades only along a real path: a harness walks the ancestors of the
   physical working directory, and through a symlink only the target's ancestors load. So
   ken owns the folder above every checkout and puts the root's rules there (5): a session in
   a clone loads `$KEN_SRC/AGENTS.md`, the root's, then the clone's own. No owner-level
   context: an owner is a GitHub org, which has no business putting rules into every clone
   under it; a fact about an owner is an `owner:` stanza in the index, data, not a prompt.
4. **Shared and private never share a git history.** The root is yours. Anything shared is
   a layer: another root, cloned into `$KEN_SRC` and linked at the root as a section. A
   personal branch on a shared repo is private only socially, a fork of a public repo is
   public, encrypted files break under worktrees; two nested histories do not.
5. **The root is plain files, synced however its owner likes; `$KEN_SRC` carries its
   rules.** No checkout is inside the root, so nothing forces a sync rule on the pages: git is
   the default, and the template's `.gitignore` keeps `.env` and tool leavings out of it; a
   root under a file sync is not refused. One warning stays: `.env` is in the root and a file
   sync carries it, so such a root keeps its secrets elsewhere. Machine-local state leaves the
   root for the same reason, to `~/.local/state/ken`, as the agents template's session
   pointer does. `log.md` is the timeline, so
   nothing is lost with git's history where git is not used. `init` and `get` make `$KEN_SRC`
   when it is missing and, where nothing is there, link `$KEN_SRC/AGENTS.md` and
   `$KEN_SRC/CLAUDE.md` to the root's `AGENTS.md`, both names since Claude Code reads the
   second and pi the first, and write `$KEN_SRC/.envrc`: `export KEN_ROOT=<root>`, then
   `source_env` of the root's `.envrc`, a file and not a link because through a link
   `dotenv_if_exists` would read the `.env` beside the link, and only when the root has an
   `.envrc`. The first root on a machine wins; another meeting a file that is not its own is
   told so, once, and nothing is replaced. Codex is out of reach: it reads `AGENTS.md` from the
   git root down, never above a clone; its user-level `AGENTS.md` is where to point it.
   `$KEN_SRC/CLAUDE.md` hides a clone's `AGENTS.md` from Claude Code, so `get` gives a fresh
   clone or worktree that has `AGENTS.md` and no `CLAUDE.md` the link `CLAUDE.md -> AGENTS.md`,
   listed in its `.git/info/exclude`.
6. **`ken` is a kernel of primitives.** A command is a primitive when it enforces a rule
   that will not change, or is the only safe way to do a file operation under those rules. A
   git command that carries no rule of ours is not wrapped: the agent runs git against the
   path `ken path` prints. Flows, hooks, lint, status and tasks are built on top and evolve
   without touching the kernel.
7. **Registration is the tool's job.** The index, `.repos`, describes every repo the workspace
   knows, cloned or not. `get` writes the entry, so a clone made by `ken` always has one, and
   `repos` names a clone that lacks one. The only writers are `get` and `index set`, and
   writes are validated, atomic and taken in turn under `.repos.lock`, so writers at
   once lose nothing. Removing a field or an entry is an edit of the file, rare and checked
   by the reader, which refuses a file it cannot read, naming the line. Whether a repo exists is the remote's business; the key is inside the
   file, never in a file name.
8. **A folder's `README.md` is its index, and is read first.** The root's is the front page,
   under about 60 lines; a section's lists its pages one line each, under about 150. Front
   page, section, page: three hops, the first two small. Nothing derivable goes in: the repo
   list is `ken repos`, recent changes are `log.md`, which the agents write as they act. The caps belong to `ken lint`.
9. **A code reference is `<key>:<path>#<symbol>`.** Never a line number, never an absolute
   path. `ken path <ref>` resolves it when the repo is cloned, else prints the repo's URL
   and says on stderr to `ken get <key>`.
10. **External subcommands.** `ken <name> ...` runs `ken-<name>` from the scope's `.bin/`,
    each direct layer's `.bin/` in `.ken` order, then `PATH`, with `KEN_ROOT` set and the folder of the running `ken` first on `PATH`, so
    a script runs `ken` back whether or not one is installed; a builtin cannot be shadowed. A script that belongs to a root or layer lives in its `.bin/` and
    travels with git; a packaged tool is installed with whatever installs commands on the
    machine, and `ken` reads nothing but `PATH`. `ken` never fetches, pins or declares an
    extension: a root or layer that relies on one names it in its `AGENTS.md`. The protocol
    is the process model: argv, `KEN_ROOT`, inherited stdio, exit code, and one record per
    line, so an extension never knows what the kernel is written in.
11. **One settings file, shared without knowing.** `.ken` is `key=value` lines, and holding
    one is what makes a folder a root. The first segment of a key names the tool that owns
    it; `ken` keeps every key it does not own, so tools keep their settings in the one file
    and read them with `sed`. No other config file exists: what is per machine is the
    environment, `KEN_ROOT` and `KEN_SRC`, and nothing is per repo.
12. **Tasks are not the kernel's business.** `ken` knows what a branch is, not what a task
    is. The seam with every task system is `get <key> -b <branch>`: Jira passes `PROJ-123`,
    `ken-task` passes a task's path, a human passes `feat/login`. What a new worktree needs
    beyond git, files copied and a setup command, is the task tool's job after `get -b`.
13. **No harness, no GitHub.** `ken` ships no hooks, settings or skills and does not know
    which harness runs it, beyond the two names it links in `$KEN_SRC`, `AGENTS.md` and
    `CLAUDE.md`, since only ken owns that folder (5). It speaks git only: no remote checks, no
    `gh`. Those are scripts.
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
    kernel and by a few lines in any other language. The one exception is in the `agents`
    template, not the kernel: a harness's transcript is JSON lines, and `ken digest` reads it
    with `jq`, the common tool for that, rather than a JSON parser written in `awk`; without
    `jq` the digest says so and `ken log` still logs.
19. **The kernel travels with the root.** It lives at `.bin/ken` in the root it serves,
    tracked like `gradlew`, and finds its root from its own path, so `git clone <root> ~/ken &&
    ~/ken/.bin/ken init` works on a fresh machine, and a layer's `.bin/ken` is the version its
    team runs when the layer is cloned alone. The `ken` on `PATH` is the kernel installed as
    any CLI is, for now a link to the implementation's clone; in a root session `ken status`
    puts the root's `.bin/` first on `PATH`, so there the root's copy is what runs.
20. **The scope is found as git finds a repository.** Every folder holding `.ken` is a root,
    and `ken` acts on one, the scope: `KEN_ROOT` when set, else the nearest `.ken` above the
    current directory, else, when `ken` runs as `<root>/.bin/ken`, that root (19); else it
    stops, saying it is outside any root and naming `cd` and `KEN_ROOT` as the ways in. Roots
    do not nest: `init` refuses a folder inside a root. A layer is a root, so `cd` into its
    clone scopes every command to it. A checkout under `$KEN_SRC` has no `.ken` above it, so
    `KEN_ROOT` says which root, three ways, one per case: `ken status` exports it into a
    session started at the root through `CLAUDE_ENV_FILE`; a launcher such as `ken flow` sets
    it for a worktree session, with `<root>/.bin` first on `PATH` and the root's harness
    settings and extension named on the command line, since a harness reads hooks and deny
    rules only from the folder a session starts in; and `$KEN_SRC/.envrc` exports it through
    direnv for a shell and what it starts. A layer's clone is a root with its own `.envrc`, so
    there direnv never reaches `$KEN_SRC`'s and the layer's `.ken` wins. `path code`, `path
    <ref>` and `which` need no root and answer from `$KEN_SRC`; `get`'s clone goes there too;
    the index, settings, `.bin/` and links are the scope's.
21. **A layer contributes every surface a root has, and the nearer wins.** The order is the
    scope, then its layers in `.ken` order, each followed by its own, then `PATH`. Each
    surface unions by its own mechanism: pages by the link, index entries by merge, commands
    by lookup order, skills by a link where the scope has none. Checkouts are not a surface,
    they are in `$KEN_SRC`. Settings are not a surface: a layer's `.ken`
    configures the layer alone. Hooks and deny rules are not a surface: hooks are the root's,
    one line each, and call commands.
22. **Layers install their layers, nested; only direct layers run.** Installing a layer
    clones the layers it lists into `$KEN_SRC` and links them inside its clone, so a layer is
    complete wherever it is added: B, a layer of A, is the section `A/B`, never one of the
    root. Pages and index entries arrive transitively; commands and skills come only from a
    layer the scope lists itself, since
    those execute on your machine: what you add directly runs, what arrives through it is
    read. A layer reached twice is one clone with two links, found twice by search; the
    index merges first-wins in walk order. A cycle is visited once; an offline layer's own
    layers are unknown until it is cloned.

## The kernel: `ken`

Eight commands. Output is for a shell: a listing prints one record per line, tab-separated
under `--porcelain`. Everything is offline except `get` when the clone is missing, `layer
add`, and `init` when a layer's clone is missing.

| Command                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Does                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `init [<dir>]`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Make `<dir>`, default the cwd, a root with only what `ken` owns: `.ken` and the index `.repos`, each holding only a comment, `.bin/` with a copy of the running `ken` when none is there, and `.gitignore` with `.env`, an existing one gaining only the line it lacks. Never overwrites, and a rerun says nothing was created; writes no page and no `AGENTS.md`, those are a template's. Refuses a `<dir>` inside a root, since roots do not nest (20), and one that holds `$KEN_SRC`. Then makes `$KEN_SRC` and gives it the root's rules where nothing is there (5), saying once that they are another root's when they are, and reconciles (below). When `<dir>` is not the root `ken` would find from here, prints the `export KEN_ROOT=` to use. Does not `git init`.                                                                                         |
| `path root \| The one resolver. `root`: the scope. `code`: the clone, `$KEN_SRC/<key>`, or the worktree of `<branch>`beside it, whether or not it exists;`<key>`may be a git URL.`<key>:<path>[#<symbol>]`: `<clone>/<path>`when cloned, the symbol being the reader's to find; else`https://<key>.git`, exit 0, and stderr says to `ken get <key>`. `code` and a reference need no root.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `which [<path>]`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | The reverse: `<key> <clone\|worktree> <branch>` for a path, default the cwd, compared real against `$KEN_SRC`, with no root needed. An existing checkout is asked of git, a worktree keyed by its clone; a path not checked out yet is answered from its shape, with no branch, so a hook can ask about a repo not cloned (`<repo>.<x>` beside a clone `<repo>` is its worktree). A layer's clone is a checkout, through its link too. Outside `$KEN_SRC/<host>/<owner>/<folder>`, in such a folder with no `.git`, or in a worktree of a clone outside `$KEN_SRC`, exit 1 saying so and what to run: for that worktree, the `git worktree move` beside its clone.                                                                                                                                                                                                   |
| `get <url\| The one write into the layout, idempotent: make `<key>`ready in`$KEN_SRC`and print its path, the only thing on stdout.`$KEN_SRC`is made when missing, with the root's rules as`init`gives them, and refused inside a root. Clone to`$KEN_SRC/<key>`if missing: blobless unless the scope's`.ken`says`clone.blobless=false`, a key alone from `https://<key>.git`, a failed clone leaving no folder. The key's host or owner folder as a link is refused, since a clone under it would be outside `$KEN_SRC`. The `mkdir`of the clone's folder is the claim: of two gets at once one clones, and the other waits for it and uses its clone. A clone already there, a folder whose own`.git`folder git takes as its repo, is used as is, no fetch; anything else there is refused untouched, naming the`mv`aside, or the`git init`that makes a plain folder the repo. A fresh clone or worktree with`AGENTS.md`and no`CLAUDE.md`gets`CLAUDE.md -> AGENTS.md`, excluded from git (5). Every time: set `worktree.useRelativePaths`, `git worktree repair`, and when no index of the scope or its layers lists the key, write an entry into the scope's: a clone holding `.ken`is a root whose front page opens with what it is for, so its first line of prose is the`desc`, said on stderr; any other gets no `desc`and the`ken index set <key> desc="..."`to run. A clone that fails says what git said, and that an unpushed or private repo is no fault here. Git older than 2.48 is refused.`-b`: create `<branch>`from the default branch as it stands, the one the clone's HEAD names (a detached clone is refused with the`git switch`), or from `--from`, and its worktree `<clone>.<folder>`; print that. A bad branch name is refused before the clone is touched. An existing branch gets its worktree, `--from`with it is refused, a branch with a worktree prints it (its folder gone, the`git worktree prune`to run), the default branch prints the clone, an unborn default branch without`--from`is refused. A folder in the way, or one differing only by case, is refused before anything is made. Branch creation is the lock: two callers never get one branch, the loser is told to rerun without`--from`, and a failure after it removes the folder this caller made when empty, and the branch when no worktree holds it nor another `get`'s folder is there to, saying so. A worktree holding `.ken` is a root: it is reconciled. Nothing is copied or run (decision 12). |
| `repos [--porcelain]`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | The merged index times the disk: the scope's index, then each reachable layer's in walk order, a whole entry winning by that order; an offline layer left out with a line on stderr. One row per key, sorted: `desc`, which workspace listed it (`root`, or a layer's section, as `atlas/handbook`), whether cloned and on which branch, `local only` when the clone has no remote-tracking branch, its worktrees, and each stray with the command that fixes it: no `desc`; a clone not on its default branch (`refs/remotes/origin/HEAD`, skipped when none); a worktree whose folder does not match its branch, or outside the layout; a detached worktree is listed, not a stray. In a root outside `$KEN_SRC`, not a layer's clone, also every clone there no index lists. `--porcelain`: key, desc, listed by, cloned, branch. Mentions of a key are `rg -lL`. |
| `index set <key> <field>=<value>...`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Write fields into the scope's index, creating the file and the entry. A field name is `[A-Za-z0-9_-]+`, not `repo`; a value is the rest of the argument as written, one line, not empty, a list its items separated by spaces. The one stanza is rewritten, the file written beside and renamed over; comments, order and unknown fields are kept. Says what it set and where. For a layer's index, `cd` into the layer.                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `layer add <url\| Refuses, before writing, a name that is not a folder name (letters, digits, `.`, `_`and`-`), a reserved name in any case, a name anything is at (a dangling link included, but not its own link left by an add that failed halfway) or another direct layer has, and a key already a direct layer, suggesting `--as`, or `ken init`to finish installing it. Then`get`it, append`layer.<name>=<key>`to`.ken`keeping its comments and other keys, and reconcile, which links it as`<name>`(default the repo name). Each step checks before acting, so a rerun finishes a job that failed halfway. Prints what it did and the`git add`of`.ken`and the index; the front-page line under`## Layers`is the agent's, checked by`ken lint`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `layer remove <name>`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Remove its `.ken` lines and, when it is the link reconcile makes, its link and its exclude line; then reconcile, which removes the skill links into what is no longer a direct layer. The clones stay: it prints the `rm -rf "$(ken path code <key>)"` that deletes this one, and the `git add` that records the removal. A name that is not a direct layer has nothing to remove, which it says, exit 0.                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `ken <name> ...`, `help [<command>]`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Decision 10: the first executable `ken-<name>` in the scope's `.bin/`, each direct layer's, then `PATH`, run by `exec` with `KEN_ROOT` the real scope and the running `ken`'s folder first on `PATH`, so signals and the exit code are its own and the script can run `ken`. Not found, `ken` names the folders it looked in; a match that is not executable is named with the `chmod +x` to run. `help` prints every command with examples, and the external commands found by where they came from.                                                                                                                                                                                                                                                                                                                                                                |

**Reconcile**, the one place derived state is made to match `.ken`, run by `init`, `layer
add`, `layer remove` and `get -b` of a root: walk the scope's layers and theirs (22). Clone
each missing one as `get` does, unattended: `GIT_TERMINAL_PROMPT=0`, no askpass, ssh
`BatchMode=yes` with a connect timeout and keepalive added after the ssh word of the user's
own command, http low-speed limits. In the scope and in each layer's clone, link each layer
it lists, `<name> -> $KEN_SRC/<key>`, absolute, since a link cannot say `~`: made, or
repointed when it points elsewhere, as after the clones move; anything else there is left,
which it says. At the scope, link each direct layer's `.agents/skills/<name>` where the scope
has none, made again when a move left it dangling, and remove such links into a layer no
longer direct; a skills folder that is a link is left alone, which it says. No link is
tracked: each is listed in the `.git/info/exclude` of the repo it is in, when there is one,
and a link removed takes its line out. A clone already there is left alone, no fetch. A
layer that cannot be cloned is offline on this machine: said on stderr with git's reason
and the `ken init` to rerun, its link made all the same and dangling, its own layers unknown,
exit 0. It says each layer cloned or already there and each link made, repointed or
removed.

**Everything else is git**, run against the path `ken path` prints: `git worktree list`,
`git worktree remove` and `git branch -d` to finish a branch; `rm -rf "$(ken path code
<key>)"` to drop a clone, the entry staying so the repo is lazy again; `git init "$(ken path
code <key>)"` then `ken get <key>` for a new repo; `mv <old> "$(ken path code <key>)"` then
`ken get <key>` to adopt one; `git pull` in a layer's clone to update it. `ken` prevents at
the one write it owns and detects everywhere else, in `repos`.

**Guards.** A key is `<host>/<owner>/<repo>` with one slash each, each part letters, digits,
`.`, `_` and `-`, neither `.` nor `..`; a URL's `.git` is dropped and its userinfo never
printed. A branch must pass `git check-ref-format --branch`, and `@` is refused as `git
branch` refuses it. A `KEN_ROOT` that does not exist, or is not a folder, is an error
naming the path. A `KEN_SRC` inside a root is refused. Relative worktree paths (git 2.48) let
a whole `<owner>/` folder, or `$KEN_SRC` itself, move with `mv`, and the next `ken init`
repoints the layer links; moving one repo folder alone needs `git worktree repair`, which
`get` runs.

**Deliberately not in `ken`:** a `config` command (the file is the API); any knowledge
command (the file system is the union; `rg -L`, `find -L` and the READMEs are the
interface); editing any Markdown; copying files or running a setup in a new worktree;
`--layer` flags (`cd` into the layer); tasks and branch naming; anything about a harness;
anything about GitHub beyond git; git commands that carry no rule; lint rules, thresholds
and flows; status, doctor, grep, promote, ingest.

## Layers

A layer is a root someone else adds: a front page, sections, an index, `.bin/`,
`.agents/skills/`, and layers of its own. Any root is one, so there
is no layer template: make a root, push it, `ken layer add <key>` it from another.
Installing a root installs its layers the way `npm install` installs dependencies:
`git clone <root> ~/ken && ~/ken/.bin/ken init` clones every layer `.ken` lists, and
theirs, and a rerun after `git pull` gets one a teammate added.

**A layer is a workspace.** Its clone holds `.ken`, so `cd ~/ken/sales-atlas` scopes every
command to it (decision 20):

| inside `~/ken/sales-atlas` | acts on                                                        |
| -------------------------- | -------------------------------------------------------------- |
| `path code`, `which`       | `$KEN_SRC`, shared with the root                               |
| `get`                      | clones in `$KEN_SRC`, registers the entry in the layer's index |
| `repos`                    | the layer's index and its layers', against `$KEN_SRC`          |
| `index`, `layer`, `init`   | the layer's index, `.ken` and links                            |
| `ken <name>`               | the layer's `.bin/`, then its direct layers', then `PATH`      |

Two things are not as if it were your root. Context cascades along the physical path, so a
session in a clone loads `$KEN_SRC/AGENTS.md`, the first root's, not the layer's. And the
clone is on its default branch, so a contribution is made in a worktree, `ken get <key> -b
<branch>`, which holds `.ken` and is a root with the same guarantees. Dispatch sets
`KEN_ROOT` to the scope; an extension that needs code asks `ken path code`.

**Nested, linked.** A layer's layers are sections inside it, `sales-atlas/handbook`, never
of the root; their clones are in `$KEN_SRC`, and every layer link is derived: reconcile makes
`<name> -> $KEN_SRC/<key>` in the scope and in each layer's clone, excluded from git there, so
no link is tracked anywhere and a layer's own links still resolve. The root's section
namespace stays what its owner chose, the tree is visible in the file system, and no layer
ever holds a clone.

**Offline.** A layer listed in `.ken` with no clone on this machine, such as a company
layer on a personal laptop, is offline. Offline is derived, never stored, so another
machine never sees it and a later `ken init` brings it back. The rest works without it: its
link dangles, its index, scripts, skills and layers are left out, `ken repos` names it, and
`ken lint` counts the links into it in a note, never an error. A root fresh from `git clone`,
or arriving by any sync, has no layer links at all until `ken init` makes them, and `ken
lint` takes that as the same case, a note that says to run `ken init`.

**Two unions.** Pages: the link is the union; `~/ken/sales-atlas/handbook/x.md` is a page
through two links and `rg -L` finds it. Index entries: `ken repos` merges the scope's index
with each reachable layer's in walk order, a whole entry winning by that order, so a team
layer lists the team's repos once and everyone who adds it can `ken get` any of them by key.

**Update** is `git pull` in the layer's clone, then `ken init` for anything it now lists.
**Contribute** is a move into a worktree of the layer: a page from a root section into the
layer's, or an entry deleted from the index here and `index set` there; then a branch and a PR.
Private notes never touch the shared history. **A new joiner** with nothing of their own:
`ken init ~/ken && ken layer add github.com/acme/sales-atlas`; on a team that shares a root,
`git clone <root> ~/ken && ~/ken/.bin/ken init`. **A layer is a unit of sharing, not of
organisation**: a group of repos only you care about is a section and tags; it becomes a
layer the day someone else should receive it, or it needs a different visibility.

## The index: `.repos`

One text file per workspace, `.repos` at the top of the root it describes: a stanza per repo
and one per owner where owner-level facts have a home ([`files.md`](files.md)). Like `.ken` it
is hidden, which `rg` skips: the index is read by `ken repos`, never grepped for.

```
# .repos: what each repo is. Whether it exists is the remote's business.

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
- **`log.md`** is the root's timeline, append-only, written by the agents as they act, not by
  `ken`: deciding what is worth a line takes judgment. One file at the root `KEN_ROOT` names,
  whatever the current folder; a change to a layer's page is logged at the root it was made
  in, its subject naming the layer path. One line per entry,
  `<time> <kind> <subject>: <what>`, through the `agents` template's `ken log`:
  `2026-11-05T15:10+1300 query flow/README.md: how a task's worktree is cleaned up`. The time
  is local to the minute with its offset, stamped by `ken log` when the agent acts, not the
  commit time: a commit can hold a day of work, and an answered question changes no file. The
  kind is one of a closed list, `ingest`, `query`, `page`, `task`, `promote`, `layer`; the
  subject is one word, a repo key, a path, a task path or a code reference. Never read whole:
  `ken status` shows the last 10 lines, sorted, and older ones are grepped by date, kind or
  subject. It is committed with the change it records, and `log.md merge=union` in
  `.gitattributes` merges two machines' appends without a conflict, sorting back into order
  where the lines share an offset. `git log` does not replace it. In a session whose start
  hook named it, `ken log` first writes the session's digest, `.sessions/<id>.md`, and ends the
  line with `s=<id>`: the user's prompts, the agent's replies and one line per tool call, taken
  from the harness's transcript by a script, never tool results, thinking or attachments. The
  transcript is deleted on the harness's schedule; the digest is the root's copy, committed
  with the line, read through `ken session <id>`. It is a record of what happened, not
  knowledge: where it and a page disagree, the page wins. Hidden, so `ken lint` and `rg` skip it.
- **Sections** are folders at the top with a README, made when a topic needs one; none up
  front, since nothing is assumed about what the root is for. Pages are Markdown, each in a
  section, none beside the front page. No generated pages: an overview belongs in the repo's
  own README.
- **The LLM writes the index**, with judgment about grouping and what is evergreen;
  [`ken-lint`](ken-lint.md) makes that safe.
- The root `AGENTS.md` stays under 40 lines: context files cost tokens on every turn and
  help only for the non-obvious. It points at the CLI and holds what no command reveals,
  the page conventions and the harness traps; what `ken help` says, it does not repeat.

The flows that fill it, ingest, query, promote, are skills and scripts: see
[built on top](built-on-top.md).

## Configuration

Per machine, the environment. The root is `KEN_ROOT` when set; else the scope, the nearest
`.ken` above the cwd, compared real; else the root the script runs from as its `.bin/ken`, a
symlink on `PATH` resolved; else `ken` stops (decision 20). The checkouts are in `KEN_SRC`,
default `~/src` (decision 3). State `ken` owns on a machine belongs in `~/.local/state/ken`.

Per root, `.ken`, tracked, `key=value` lines:

```
clone.blobless=true
org.me=github.com/xiaoxinghu
layer.sales-atlas=github.com/acme/sales-atlas
task.folder=tasks
```

Every key is optional and an empty file is all defaults. A line `ken` cannot read stops
every command that reads the file, naming the file, the line and what it expects. `root` is
refused here, since the root is per machine, and the checkouts folder is no key for the same
reason. `layer add` appends a `layer.*` line and `remove`
deletes one, every other line kept. A tool reads its key with
`sed -n 's/^task\.folder=//p' "$KEN_ROOT/.ken"`.
Environment is direnv's job and a template's: see [templates](templates.md).

## Path length

The longest worktree path here is near 80 characters,
`/Users/me/src/github.com/acme/join-api-step-functions.portal-print-web-views-to-pdf`,
against `PATH_MAX` of 1024 on macOS and 4096 on Linux. The one wall is a Unix socket created
inside the tree, 104 bytes on macOS, which the template's `.envrc` handles. If it ever
bites: a host alias such as `gh/` for `github.com/`, or a shorter `KEN_SRC`.

## Out of scope for now

Windows (`MAX_PATH` 260, `core.longpaths`); `.org` pages; GitLab subgroups, an owner with
slashes; repos with submodules, no worktrees until git recommends them; a union file system
for layers, the link per layer is the overlay; a Backstage export; encrypting anything in a
shared layer; splitting `log.md` into a `log/` folder by year or month, decided when its size
gets in the way; `ken-lint` checking `log.md` lines against the format.

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
  context, so the cascade breaks. Rejected while nobody owned the folder outside; now ken owns
  `$KEN_SRC` and puts the root's rules there (3, 5), so the code is outside and nothing is
  linked in but the layers, which are knowledge.
- **Checkouts inside the root, under `.repos/`.** The first layout: the cascade for free, but
  4 GB of clones inside a few hundred pages, and a sync rule the clones forced on the pages,
  since one missed exclusion uploads an object store. A tree synced by two systems fights
  itself.
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
  it was added; one clone per key in `$KEN_SRC`, linked where each layer lists it, removed
  the reason (22).
- **Hoisting with a link per clone in each layer's `.repos/`**, pnpm's mechanism, and its
  successor, a tracked relative link through a `.repos/` folder of links to the hoisted
  clone. Two links where one does, and a folder of untracked state; now the one link is
  absolute, derived and untracked.
- **Owner-level context, `<host>/<owner>/AGENTS.md`.** An owner is a GitHub org, and an org
  has no business putting rules into every clone under it; a repo's rules are its own
  `AGENTS.md`, and what the root wants said in every clone is said once, in `$KEN_SRC`.
- **Transitive commands.** Scripts from repos you never named on your command path, npm's
  supply-chain problem. Pages are read; commands run from direct layers only.
- **`ken config`, `--layer`, `ken path layer|repos|bin|<file>`, `repos <key>`.** Each
  restated a rule or reached into a layer: the file is the API, the link is the resolver,
  `cd` is the scope, `grep -rl` finds mentions.
- **Copy and setup in `get -b`, and a per-repo `.ken`.** Not a rule, the kernel's only
  execution of configured commands, and a `.ken` in a clone would read as a root marker.
- **The kernel editing `README.md`.** One line per layer is a lint rule; the agent writes
  it. The kernel touches no knowledge content.
- **`ken` logging its own commands, or `git log` as the timeline.** What is worth a line is
  judgment, and a commit's date is when someone committed, not when the thing happened.
- **A heading per log entry with a body, as Karpathy's wiki has it, or UTC times.** One line
  keeps `tail`, `grep` and `sort` working without a parser; UTC sorts everywhere but is
  unreadable at a glance to the person whose root it is, and the offset keeps local time exact.

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
- git's repository discovery and submodules: the nearest root is the scope, and outside one
  a command stops. pnpm: one store, the logical tree kept by links. npm: transitive install, and the supply-chain lesson
  that made commands direct-only.
