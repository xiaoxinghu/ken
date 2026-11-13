# ken — PRD

`ken`: the range of what one knows and can reach. A root that is a knowledge base, every git
checkout it uses inside it under `.repos/`, and one CLI installed once per machine that
enforces the few rules which never change. This document is ken's: what it does and why. It
changes in the same PR as the behaviour; git is its history.

It describes the rewrite, TypeScript in `packages/`. While the rewrite is built, the shell
kernel `ken` at the repo's root and `templates/agents` stay beside it, unchanged, because a
root still runs them (`AGENTS.md`); their design is this file's history in git, up to the
commit that replaced it.

The pieces have their own documents: [extensions](extensions.md), the contract every command
outside the core keeps; [`files.md`](files.md), the two files ken reads and writes;
[templates](templates.md), what `create-ken` writes into a root for an agent harness;
[`ken-task`](ken-task.md), the task system; [`ken-lint`](ken-lint.md), the knowledge-base
lint; [built on top](built-on-top.md), the scripts, skills and flows.

## Problem

Work with agents spans many repositories, and the knowledge that ties them together, how
systems fit, which repo does what, why a decision was made, belongs to no single repository.
It is scattered: a `~/code` tree an agent cannot navigate without pasted absolute paths,
context files that do not cascade, notes in a private folder, team docs in a wiki nobody
reads. Every session starts from zero and is told where things are by hand.

Three audiences want one answer. **An individual**: one place to start every session,
private notes and tasks version-controlled, every repo reachable by name, context loading
in the right order unpasted. **A team**: a curated, shared knowledge base over its repos
that every member clones, keeps current and contributes to, beside their private one and
never mixed with it. **A tool user**: only parts of it, the layout with Jira for tasks, or
the knowledge base with no code at all. Nothing may require everything.

## The shape

The whole root is the knowledge base. Everything that is not knowledge has a reserved,
hidden name.

```
~/ken/                             your root: plain files, in git by default
  README.md                        the front page: evergreen pages, one line per section
  AGENTS.md                        < 40 lines: the CLI, the page conventions, the traps
  CLAUDE.md -> AGENTS.md
  log.md                           the timeline: one line per action, written by the agents
  .sessions/<id>.jsonl             the digest of each session a log line names
  systems/  flows/  decisions/     sections, made as needed, each with a README.md
  tasks/                           ken task's folder
  .ken                             settings, key=value, ken.format=1; holding one makes a root
  .repos.index                     the index: one stanza per repo, cloned or not
  .repos/                          every checkout this root uses; ignored by git and the sync
    github.com/acme/join-web/              the clone, on its default branch
    github.com/acme/join-web.PROJ-123/     a worktree, named for repo and branch
  .gitignore                       .env, .repos/
  .envrc  .agents/  .claude/  .codex/  .pi/     create-ken's: env and harness files
  .bin/                            the root's own tools, ken-<name>; never ken
~/work/                            another root, beside this one, never inside it
```

**Reserved names** at the root: `.ken`, `.repos`, `.repos.index`, `.bin`, `.sessions`,
`.agents`, `.claude`, `.codex`, `.pi`, `.envrc`, `AGENTS.md`, `CLAUDE.md`, `log.md`, and
`README.md` as the front page. `ken init` creates the ones it owns. Everything else at the
root is a section.

## Decisions

1. **The root is the knowledge base.** Pages live at the top, in sections, each folder with
   a `README.md` that indexes it. Scripts, tool state and checkouts live under reserved
   hidden names, so `ls ~/ken` shows knowledge and `rg <words> ~/ken` searches knowledge
   and nothing else: ripgrep skips hidden names, and `.repos/` is in `.gitignore` too.
2. **One knowledge base is one root, and roots are not mixed.** A root is one repo in one
   folder. Two bases, such as work and personal, are two roots side by side, each with its
   own checkouts, index and tasks; a session works in one. Shared and private never share a
   git history: a team's base is a root its members clone beside their own, and what is
   private stays in the private root. A personal branch on a shared repo is private only
   socially, a fork of a public repo is public, encrypted files break under worktrees.
   There are no layers: one root never links, merges or runs another (Considered and
   rejected).
3. **ken is installed once per machine.** No root holds a copy of ken or of a standard
   command. The core and the standard commands ship together, at one version, as git ships
   `git-core`; `ken version` says which. A root carried its own kernel once, and copies in
   each root's `.bin/` skewed against each other and against the one on `PATH`, with no
   update path but a diff against a fresh template. A root on a machine with no ken is
   still a readable knowledge base, and its `AGENTS.md` names the install line.
4. **A root declares its format.** `.ken` holds `ken.format=1`. ken reads every format up to
   its own and stops on a newer one, saying this ken is too old for the root and how to
   upgrade. A `.ken` with no `ken.format` is a root from before the rewrite: ken stops and
   names the migration (From before the rewrite, below). Unknown keys are ignored, so an
   addition needs no bump; the number goes up only for a change an older ken would misread:
   to `.ken`, `.repos.index` or the layout. git's `core.repositoryformatversion` and
   SQLite's file header are the model: one tool installed, the data saying what it is.
5. **The repo key is the address everywhere.** `<host>/<owner>/<repo>`, lowercase, is the
   index entry, the clone at `<root>/.repos/<key>`, the worktree at
   `<root>/.repos/<key>.<branch>` with `/` in the branch as `-`, and the prefix of a code
   reference. An agent that knows the key knows every path; nobody pastes absolute paths.
   The clone has no suffix because it holds the default branch, whatever its name; every
   other branch is a worktree beside it. Two branches that map to one folder, or a repo
   named `<repo>.<branch>`, collide: the second is refused, naming what is in the way.
   Never switch branches inside a clone or worktree.
6. **Checkouts are inside the root, in `.repos/`.** The name is fixed, not a setting, so
   every root and every tool agrees on it without reading one. Context cascades only along
   a real path, a harness walking the ancestors of the physical working directory, so a
   session in a checkout loads the root's `AGENTS.md`, then the checkout's own; and the
   root is found from a checkout as from anywhere in it, the nearest `.ken` above (9).
   Codex is the exception: it reads `AGENTS.md` from the git root down, never above it, and
   a checkout is its own git root; its user-level `~/.codex/AGENTS.md` is where to point it
   at a root's rules, which with two roots can name only one. Nothing outside the root
   carries its rules, and nothing exports `KEN_ROOT` to reach a checkout. The cost: two roots that use one repo clone it twice. `.repos/` is ignored by
   the root's git, which `get` checks. A file sync that indexes the root must leave
   `.repos` alone, by name; a root under a sync that cannot skip a folder is its owner's
   problem. The root's `CLAUDE.md` is above every checkout, and Claude Code reads a
   checkout's `AGENTS.md` only while no `CLAUDE.md` is at or above it, so `get` gives a
   fresh clone or worktree that has `AGENTS.md` and no `CLAUDE.md` the link `CLAUDE.md ->
   AGENTS.md`, listed in its `.git/info/exclude`. No owner-level context: an owner is a
   GitHub org, which has no business putting rules into every clone under it; a fact about
   an owner is an `owner:` stanza in the index, data, not a prompt.
7. **The index is the file `.repos.index`, and registration is the tool's job.** It
   describes every repo the root knows, cloned or not, at the top of the root and not
   inside `.repos/`, which a sync skips and which `rm -rf` empties. `get` writes the
   entry, so a clone made by ken always has one, and `repos` names a clone that lacks one.
   The only writers are `get` and `index set`; writes are validated, atomic and taken in
   turn under `.repos.index.lock`, so writers at once lose nothing. Removing a field or an
   entry is an edit of the file, rare and checked by the reader, which refuses a file it
   cannot read, naming the line. Whether a repo exists is the remote's business; the key
   is inside the file, never in a file name.
8. **The root is plain files, synced however its owner likes.** Git is the default, and
   `.gitignore` keeps `.env`, tool leavings and `.repos/` out of it; a root under a file
   sync is not refused. One warning stays: `.env` is in the root and a file sync carries
   it, so such a root keeps its secrets elsewhere. Machine-local state leaves the root for
   the same reason, to `~/.local/state/ken`. `log.md` is the timeline, so nothing is lost
   with git's history where git is not used.
9. **The root is found as git finds a repository.** ken acts on one root: `KEN_ROOT` when
   set, else the nearest folder holding `.ken` above the current one, else it stops, saying
   it is outside any root and naming `cd` and `KEN_ROOT` as the ways in. Nothing is found
   from where ken itself is installed. Roots do not nest: `init` refuses a folder inside a
   root. A checkout that holds a `.ken` of its own, another root cloned to be read, is that
   root while one works inside it, as a nested repository is to git; ken makes none. A
   root's own worktree is not a thing: a root is worked on in place, and `get` refuses the
   root's own key, the one its `origin` names, since its clone would be a root inside
   itself.
10. **The core is a kernel of primitives.** A command is a primitive when it enforces a rule
    that will not change, or is the only safe way to do a file operation under those rules.
    A git command that carries no rule of ours is not wrapped: the agent runs git against
    the path `ken path` prints. Status, log, lint and tasks are commands on top, and evolve
    without touching the core.
11. **Two packages.** `@unclex/ken-core` is the primitives and the dispatch, as small as it
    can be and meant to stay put: `init`, `path`, `which`, `get`, `repos`, `index set`,
    `help`, `version`, and running `ken-<name>`. `@unclex/ken` is what a person installs:
    the core plus the standard commands, bundled, each in the form of an extension:
    `status`, `log`, `digest`, `session`, `task`, `lint`. Nothing in the core knows a
    standard command, so one changes, or is replaced, without a release of the core.
12. **Everything else is an extension.** `ken <name> ...` runs an executable `ken-<name>`.
    It gets `KEN_ROOT`, finds this same ken as `ken` on its `PATH`, and uses the core only
    through its commands and the two files; it never imports the core. Bundled or not, the
    contract is the same ([extensions](extensions.md)). Lookup order: a core command, then
    the root's `.bin/`, then the bundled commands, then `PATH`, so a root can replace a
    standard command, on purpose, and `ken help` says when one does. ken never fetches,
    pins or declares an extension: a root that relies on one beyond the bundled names it in
    its `AGENTS.md`. The protocol is the process model, argv, `KEN_ROOT`, inherited stdio,
    exit code, one record per line, so an extension never knows what ken is written in.
13. **`.bin/` is the root's own tools.** What the root wrote for itself, as `ken-<name>`
    scripts that travel with its git. Never ken, never a copy of a standard command: a copy
    there shadows the real one and goes stale against it. `ken status` puts `<root>/.bin`
    on the agent's `PATH` where the harness has a way ([templates](templates.md)).
14. **One settings file, shared without knowing.** `.ken` is `key=value` lines, and holding
    one is what makes a folder a root. The first segment of a key names the tool that owns
    it; ken keeps every key it does not own, so tools keep their settings in the one file
    and read them with `sed`. No other config file exists: what is per machine is the
    environment, and nothing is per repo.
15. **A folder's `README.md` is its index, and is read first.** The root's is the front page,
    under about 60 lines; a section's lists its pages one line each, under about 150. Front
    page, section, page: three hops, the first two small. Nothing derivable goes in: the
    repo list is `ken repos`, recent changes are `log.md`. The caps belong to `ken lint`.
16. **A code reference is `<key>:<path>#<symbol>`.** Never a line number, never an absolute
    path. `ken path <ref>` resolves it when the repo is cloned, else prints the repo's URL
    and says on stderr to `ken get <key>`.
17. **Tasks are not the core's business.** The core knows what a branch is, not what a task
    is; `ken task` is bundled, and is an extension like any other. The seam with every task
    system is `get <key> -b <branch>`: Jira passes `PROJ-123`, `ken task` passes a task's
    path, a human passes `feat/login`. What a new worktree needs beyond git, files copied
    and a setup command, is the task tool's job after `get -b`.
18. **No harness, no GitHub, in the core.** The core ships no hooks, settings or skills and
    does not know which harness runs it, beyond the one link `get` makes in a fresh
    checkout (6). It speaks git only: no remote checks, no `gh`. The harness files are
    `create-ken`'s (19); remote checks are extensions'.
19. **A root starts from `create-ken`**, the `npm create ken <dir>` convention: it runs `ken
    init`, then writes the template's files, adding only what is missing. `ken init` alone
    is a root for a person with no agent. A scaffolding package was rejected while a
    template carried the kernel, since copying it out of a package was `git clone`; with ken
    installed once the template is a few constant files and a rerun is its update path
    ([templates](templates.md)). The template branch and its workflow go.
20. **TypeScript, run directly by Node 24 or newer and by Bun.** No build to develop, test or
    run from a clone: only syntax Node strips, no `enum`, no namespaces, no parameter
    properties, held by `erasableSyntaxOnly`. The core's one dependency beyond the runtime
    is git 2.48 or newer, which the layout needs anyway; JSON, as in a harness's
    transcript, is read with `JSON.parse`, so no tool such as `jq` can be missing. The shell
    kernel rejected a TypeScript kernel on npm, a runtime and a registry for commands that
    are mostly `git` and `mkdir`, when the kernel had to be a file a root could carry.
    Installed once, that reason is gone, the runtime is paid once per machine, and `ken
    lint` and `ken task` already needed it. Node refuses to strip types from a file under
    `node_modules`, so what the published package holds is decided with its first release;
    a clone, and a link to it, run the source.
21. **Blobless, never shallow.** `get` clones with `--filter=blob:none`, which works with
    worktrees and costs first-touch latency only. A shallow clone breaks the second worktree
    and every fetch.
22. **Real paths.** On a case-insensitive disk `~/ken` and `~/Ken` are one folder. ken
    resolves roots with realpath and compares real paths, never strings, and refuses a
    branch whose folder would differ only by case from an entry of `<owner>/`.
23. **No exceptions to the layout.** A repo that must live at a fixed path stays in the
    layout and the user links that path to the clone. ken neither makes nor tracks such
    links.
24. **Every message is a next step.** Agents see nothing but the output. Every message,
    above all every error, says what is the case, why it matters, and what to run next, with
    the real keys and paths filled in. `ken help` and `ken <command> --help` carry the same
    examples.

## The core

Output is for a shell: a listing prints one record per line, tab-separated under
`--porcelain`. Everything is offline except `get` when the clone is missing. Every core
command but `init`, `help` and `version` needs a root (9); `init` makes one, and dispatch
runs outside a root too, without the root's `.bin/`.

- **`init [<dir>]`.** Make `<dir>`, default the current folder, a root with only what ken
  owns: `.ken` with a comment and `ken.format=1`, `.repos.index` holding only its comment,
  and `.gitignore` with `.env` and `.repos/`, an existing one gaining only the lines it
  lacks. Never overwrites, and a rerun says nothing was created. A `.ken` with no
  `ken.format` is left alone, and `init` names the migration. Refuses a `<dir>` inside a
  root (9). Makes no `.bin/` and copies nothing; writes no page and no `AGENTS.md`, those
  are `create-ken`'s; does not `git init`. When `<dir>` is not the root ken would find from
  here, says to `cd` there.
- **`path root`**: the root. **`path code <key> [<branch>]`**: the clone,
  `<root>/.repos/<key>`, or the worktree of `<branch>` beside it, whether or not it exists;
  `<key>` may be a git URL. **`path <key>:<path>[#<symbol>]`**: `<clone>/<path>` when cloned,
  the symbol being the reader's to find; else `https://<key>.git`, exit 0, and stderr says
  to `ken get <key>`.
- **`which [<path>]`.** The reverse: `<key> <clone|worktree> <branch>` for a path, default
  the current folder, compared real against `<root>/.repos`. An existing checkout is asked
  of git, a worktree keyed by its clone; a path not checked out yet is answered from its
  shape, with no branch, so a hook can ask about a repo not cloned (`<repo>.<x>` beside a
  clone `<repo>` is its worktree). Outside `.repos/<host>/<owner>/<folder>`, in such a
  folder with no `.git`, or in a worktree of a clone outside `.repos/`, exit 1 saying so
  and what to run: for that worktree, the `git worktree move` beside its clone.
- **`get <url|key> [-b <branch> [--from <ref>]]`.** The one write into the layout,
  idempotent: make `<key>` ready in `.repos/` and print its path, the only thing on stdout.
  Refused, before anything is made, when the root is in git and its git does not ignore
  `.repos/`, naming the `.gitignore` line; and for the root's own key (9). Clone to
  `.repos/<key>` if missing: blobless unless `.ken` says `clone.blobless=false`, a key alone
  from `https://<key>.git`, a failed clone leaving no folder. `.repos`, a host or an owner
  folder that is a link is refused, since a clone under it would be outside the root. The `mkdir` of the
  clone's folder is the claim: of two gets at once one clones, and the other waits for it
  and uses its clone. A clone already there, a folder whose own `.git` git takes as its
  repo, is used as is, no fetch; anything else there is refused untouched, naming the `mv`
  aside, or the `git init` that makes a plain folder the repo. A fresh clone or worktree
  with `AGENTS.md` and no `CLAUDE.md` gets `CLAUDE.md -> AGENTS.md`, excluded from git (6).
  Every time: set `worktree.useRelativePaths`, `git worktree repair`, and when the index
  does not list the key, write its entry: a clone holding `.ken` is a root whose front page
  opens with what it is for, so its first line of prose is the `desc`, said on stderr; any
  other gets no `desc` and the `ken index set <key> desc="..."` to run. A clone that fails
  says what git said, and that an unpushed or private repo is no fault here. Git older than
  2.48 is refused.

  `-b`: create `<branch>` from the default branch as it stands, the one the clone's HEAD
  names (a detached clone is refused with the `git switch`), or from `--from`, and its
  worktree `<clone>.<folder>`; print that. A bad branch name is refused before the clone is
  touched. An existing branch gets its worktree, `--from` with it is refused, a branch with
  a worktree prints it (its folder gone, the `git worktree prune` to run), the default
  branch prints the clone, an unborn default branch without `--from` is refused. A folder in
  the way, or one differing only by case, is refused before anything is made. Branch
  creation is the lock: two callers never get one branch, the loser is told to rerun
  without `--from`, and a failure after it removes the folder this caller made when empty,
  and the branch when no worktree holds it nor another `get`'s folder is there to, saying
  so. Nothing is copied or run (17).
- **`repos [--porcelain]`.** The index times the disk, one row per key, sorted: `desc`,
  whether cloned and on which branch, `local only` when the clone has no remote-tracking
  branch, its worktrees, and each stray with the command that fixes it: no `desc`; a clone
  no entry lists; a clone not on its default branch (`refs/remotes/origin/HEAD`, skipped
  when none); a worktree whose folder does not match its branch, or outside the layout; a
  detached worktree is listed, not a stray. `--porcelain`: key, desc, listed (`true` or
  `false`), cloned (`true` or `false`), branch; empty fields empty. Mentions of a key are
  `rg -l`.
- **`index set <key> <field>=<value>...`.** Write fields into `.repos.index`, creating the
  file and the entry. A field name is `[A-Za-z0-9_-]+`, not `repo`; a value is the rest of
  the argument as written, one line, not empty, a list its items separated by spaces. The
  one stanza is rewritten, the file written beside and renamed over; comments, order and
  unknown fields are kept. Says what it set and where.
- **`help [<command>]`, `<command> --help`.** Every core command with examples, then the
  extensions found, grouped by where each was found, one that shadows another saying so.
  `help <name>` of an extension runs `ken <name> --help`.
- **`version`.** The version of the package ken runs from, and the newest format it reads.
- **`ken <name> ...`.** Decision 12: the first `ken-<name>` in the lookup order, run with
  `KEN_ROOT` the real root, its arguments, stdio and exit status its own. Not found, ken
  names where it looked, in order, and says to add an executable `ken-<name>` to the
  root's `.bin/`; a match there that is not executable is named with the `chmod +x` to run.
  Outside any root the root's `.bin/` is skipped and `KEN_ROOT` is unset; the command says
  what it needs.

**Everything else is git**, run against the path `ken path` prints: `git worktree list`,
`git worktree remove` and `git branch -d` to finish a branch; `rm -rf "$(ken path code
<key>)"` to drop a clone, the entry staying so the repo is lazy again; `git init "$(ken path
code <key>)"` then `ken get <key>` for a new repo; `mv <old> "$(ken path code <key>)"` then
`ken get <key>` to adopt one. ken prevents at the one write it owns and detects everywhere
else, in `repos`.

**Guards.** A key is `<host>/<owner>/<repo>` with one slash each, each part letters, digits,
`.`, `_` and `-`, neither `.` nor `..`; a URL's `.git` is dropped and its userinfo never
printed. A branch must pass `git check-ref-format --branch`, and `@` is refused as `git
branch` refuses it. A `KEN_ROOT` that does not exist, or is not a folder, is an error naming
the path. `.repos/` not ignored by a root in git is refused at `get`. Relative worktree
paths (git 2.48) let a whole `<owner>/` folder, or the root itself, move with `mv`; moving
one repo folder alone needs `git worktree repair`, which `get` runs.

**Deliberately not in the core:** a `config` command (the file is the API); any knowledge
command (the file system is the interface: `rg`, `find` and the READMEs); editing any
Markdown; copying files or running a setup in a new worktree; tasks and branch naming;
anything about a harness but the one link (18); anything about GitHub beyond git; git
commands that carry no rule; lint rules, thresholds and flows; status, log, doctor, grep,
promote, ingest.

## The standard commands

`@unclex/ken` bundles six commands, each in the form of an extension, run by the runtime
that runs ken ([extensions](extensions.md)). A root's `.bin/` can replace any of them.

| Command                       | Does                                                                                                                      |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `status`                      | the session-start overview, and the session's `PATH` and pointers where the harness has a way ([templates](templates.md)) |
| `log <kind> <subject> <what>` | one line on `log.md`, the session's digest first (The knowledge base, below)                                              |
| `digest [<transcript>]`       | a harness's transcript to `.sessions/<id>.jsonl` ([templates](templates.md))                                              |
| `session <id> [<range>]`      | the entries of a digest                                                                                                   |
| `task <command>`              | plain-text tasks in one folder, a worktree per task ([`ken-task`](ken-task.md))                                           |
| `lint`                        | the knowledge-base lint: indexes, links, references ([`ken-lint`](ken-lint.md))                                           |

## The index: `.repos.index`

One text file per root, `.repos.index` at its top: a stanza per repo and one per owner
where owner-level facts have a home ([`files.md`](files.md)). Like `.ken` it is hidden,
which `rg` skips: the index is read by `ken repos`, never grepped for.

```
# .repos.index: what each repo is. Whether it exists is the remote's business.

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

- **A `README.md` per folder is the index** (decision 15). The front page says what the
  knowledge base is, links the few evergreen pages, which live in sections like any other,
  and gives one line per section. A section's README lists its pages one line each; over
  the cap it splits.
- **`log.md`** is the root's timeline, append-only, written by the agents as they act, not by
  the core: deciding what is worth a line takes judgment. One file at the root, whatever the
  current folder. One line per entry, `<time> <kind> <subject>: <what>`, through `ken log`:
  `2026-11-05T15:10+1300 query flow/README.md: how a task's worktree is cleaned up`. The time
  is local to the minute with its offset, stamped by `ken log` when the agent acts, not the
  commit time: a commit can hold a day of work, and an answered question changes no file. The
  kind is one of a closed list, `ingest`, `query`, `page`, `task`, `promote`; the subject is
  one word, a repo key, a path, a task path or a code reference. Never read whole: `ken
  status` shows the last 10 lines, sorted, and older ones are grepped by date, kind or
  subject. It is committed with the change it records, and `log.md merge=union` in
  `.gitattributes` merges two machines' appends without a conflict, sorting back into order
  where the lines share an offset. `git log` does not replace it. In a session whose start
  hook named it, `ken log` first writes the session's digest, `.sessions/<id>.jsonl`, and
  ends the line with `s=<id>`: one entry per line, the user's prompts and the agent's
  replies with their tool calls, a name and the head of the input, taken from the harness's
  transcript, never tool results, thinking or attachments. The transcript is deleted on the
  harness's schedule; the digest is the root's copy, committed with the line, read through
  `ken session <id>`, its last entries or a range of them, and searched with grep over
  `.sessions/*.jsonl`, one entry per line: ken holds no search of its own. It is
  a record of what happened, not knowledge: where it and a page disagree, the page wins.
  Hidden, so `ken lint` and `rg` skip it.
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

Per machine, the environment, and only `KEN_ROOT`: when set, the root, ahead of the nearest
`.ken` (decision 9); dispatch sets it for every extension. State ken keeps on a machine
belongs in `~/.local/state/ken`.

Per root, `.ken`, tracked, `key=value` lines ([`files.md`](files.md)):

```
ken.format=1
clone.blobless=true
task.folder=tasks
template.name=agents
```

`ken.format` is the one key that must be there (decision 4); every other key is optional.
A line ken cannot read stops every command that reads the file, naming the file, the line
and what it expects. A tool reads its key with `sed -n 's/^task\.folder=//p'
"$KEN_ROOT/.ken"`. Environment is direnv's job and the template's: see
[templates](templates.md).

## From before the rewrite

A `.ken` with no `ken.format` was made by the shell kernel: a copy of it in `.bin/`, the
index in the file `.repos`, checkouts in `$KEN_SRC` outside the root, perhaps layers. ken
stops on such a root and names this section. Migrating is by hand, once, with every agent
session of the root closed:

1. Install ken, and keep the old kernel reachable under another name until the end.
2. Make the file sync, if any, leave `.repos` alone, and check it does before any clone
   moves in.
3. `git mv .repos .repos.index`. Add `ken.format=1` to `.ken`. Remove its `layer.<name>`
   lines, each layer's link at the top and its line under `## Layers` in the front page; a
   layer still wanted is a root of its own, cloned beside this one. Add `.repos/` to
   `.gitignore`.
4. Empty `.bin/` of ken: remove `ken`, and `ken-status`, `ken-log`, `ken-digest` and
   `ken-session` where they are the template's copies, since a root's `.bin/` is ahead of
   the bundled commands and a copy there shadows them. `ken help` names what still shadows.
5. Run `npm create ken` in the root: it adds what is missing and names what differs; bring
   each hook to the one line of [templates](templates.md), and `AGENTS.md` to the
   template's wording, keeping the root's own lines.
6. Move the checkouts: `mkdir .repos`, then `mv "$KEN_SRC/<host>" .repos/`, whole host or
   owner folders so relative worktree paths hold, then `ken get <key>` for each listed repo,
   which repairs what the move broke, and `ken repos` to compare with before. A clone two roots used goes
   to one of them; the other clones it again.
7. Remove `$KEN_SRC/AGENTS.md`, `$KEN_SRC/CLAUDE.md` and `$KEN_SRC/.envrc`, and every
   export of `KEN_ROOT` or `KEN_SRC` in shells and launchers.
8. `ken lint`, `ken status` from a new session, and commit.

## Path length

The longest worktree path here is near 90 characters,
`/Users/me/ken/.repos/github.com/acme/join-api-step-functions.portal-print-web-views-to-pdf`,
against `PATH_MAX` of 1024 on macOS and 4096 on Linux. The one wall is a Unix socket created
inside the tree, 104 bytes on macOS, which the template's `.envrc` handles. If it ever
bites: a host alias such as `gh/` for `github.com/`, or a root at a shorter path.

## Out of scope for now

Windows (`MAX_PATH` 260, `core.longpaths`); `.org` pages; GitLab subgroups, an owner with
slashes; repos with submodules, no worktrees until git recommends them; one clone shared by
two roots; a Backstage export; splitting `log.md` into a `log/` folder by year or month,
decided when its size gets in the way; `ken-lint` checking `log.md` lines against the
format.

## Considered and rejected

- **Layers**: a root linked into another as a section, its index merged into the other's,
  its commands and skills run from it, its own layers nested inside it, offline where its
  clone was missing, all kept in step by a reconcile. Made for a team's base to arrive in a
  private one. It made three kernels able to answer one command, ran a layer's commands
  under another root's kernel, and needed derived links, a walk order, a first-wins merge,
  offline notes and a supply-chain rule for transitive commands. No knowledge-base tool
  looked at composes bases; each is installed once and federates flat. Two roots side by
  side give the team's base to everyone who clones it and keep it apart from the private
  one (2).
- **Checkouts in `$KEN_SRC`, outside every root.** One folder per machine, `~/src`,
  holding every checkout once, with the root's rules put above them in `AGENTS.md`,
  `CLAUDE.md` and an `.envrc` that exported `KEN_ROOT`. Chosen so the clones stayed out of
  a root under a file sync. One folder per machine carries one root's rules, so with two
  roots it cannot say whose a checkout is; and reaching the root from a checkout took
  `KEN_ROOT` exported three ways, by the session hook, by a launcher and by direnv. A sync
  that leaves `.repos` alone answers the reason, and inside the root the path says it all.
- **Hoisting with a link per clone in each layer's `.repos/`**, pnpm's mechanism, and its
  successor, a tracked relative link through a `.repos/` folder of links to the hoisted
  clone. Two links where one did, and a folder of untracked state; then layers went.
- **Code outside the root, linked in.** Through a symlink only the target's ancestors load
  context, so the cascade breaks.
- **The kernel travels with the root**, at `.bin/ken`, tracked like `gradlew`. `gradlew` is
  a launcher plus a pin, and works because builds do not compose; a root's copy and the one
  on `PATH` skewed, and with layers three could answer one command. Installed once, with a
  format the root declares, replaced it (3, 4).
- **One POSIX shell script, and git.** A file anyone reads, diffs and copies, for as long
  as a root had to carry it. Its JSON went through `jq`, its files through `awk` and `sed`,
  and the commands beside it were TypeScript anyway (20).
- **A template as a branch to clone**, split off by a workflow with the kernel copied in.
  Its copies had no update path but a diff the agent merged by hand; `create-ken` adds
  what is missing (19).
- **One card file per repo, named by key.** A stray rename makes a phantom repo; the key
  belongs inside a file.
- **Metadata inside the clone, tracked by the root.** Git never tracks files inside a nested
  repo, and the entry must outlive the clone for lazy cloning.
- **The index inside `.repos/`.** A sync that skips the folder would lose it, and `rm -rf`
  of the checkouts would take it along (7).
- **The index derived from mentions.** Coverage would rest on discipline; registration is
  the tool's job.
- **A folder per repo holding `main/`, `<branch>/`.** Tools that name a project after its
  folder show `main` for every repo; doubling the name lengthens every path.
- **A hidden clone root with a symlink view.** Generated state nobody owns, the `main`
  problem again, and `rg` finds everything twice.
- **Generated per-repo overview pages, a single `INDEX.md`, a `kb/` folder, knowledge
  commands in the core.** Stale copies, unbounded files, folders for one job; the root is
  the knowledge base and the file system is the interface.
- **Tasks in the core.** A Jira user must adopt ken without a task system; the seam is
  `get -b`.
- **Wrapping git: `clone`, `new`, `adopt`, `remove`, `worktree add|remove|ls`, `open`.**
  Commands whose only rule was the path. One idempotent `get`, one resolver, the rest git.
- **A personal branch, a fork, or git-crypt for private content.** Private only socially,
  public by construction, broken under worktrees.
- **Shallow clones.** Break the second worktree and every fetch.
- **Extensions as dependencies declared in `.ken` or a `package.json`.** Then ken must say
  how to get one, and an extension may be a monorepo folder, a closed binary or a Homebrew
  formula: defining acquisition is being a package manager. Like `git` and `kubectl`, ken
  finds `ken-<name>` on `PATH`; the standard commands are bundled, not fetched.
- **The core importing a standard command, or a command importing the core.** Then the two
  release together forever and a root cannot replace one; the process boundary is the
  contract (11, 12).
- **A compiled binary.** Asks for trust nobody can check, and a build to develop.
- **YAML for the files, or git's config format.** YAML: one dependency and a
  comment-preserving editor for values that never exceed a line. git config: free parsing
  and locking, but its semantics come along, keys allow no `_`, fold case, and `[include]`
  pulls in files. The line formats of `files.md` are owned here.
- **Owner-level context, `<host>/<owner>/AGENTS.md`.** An owner is a GitHub org, and an org
  has no business putting rules into every clone under it; a repo's rules are its own
  `AGENTS.md`, and what the root wants said in every checkout is its own `AGENTS.md`, above
  them all.
- **`ken config`, `ken path repos|bin|<file>`, `repos <key>`.** Each restated a rule: the
  file is the API, `cd` is the scope, `rg -l` finds mentions.
- **Copy and setup in `get -b`, and a per-repo `.ken`.** Not a rule, the core's only
  execution of configured commands, and a `.ken` in a clone would read as a root marker.
- **The core editing `README.md`.** The agent writes the front page; the lint checks it.
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
  git ships its own subcommands in `git-core` the same way.
- git's `core.repositoryformatversion` and SQLite's file header: one tool installed, the
  data declaring its format, new code reading every old file. Terraform's
  `required_version`: one binary, nested pieces only declaring what they need.
- ghq, gwq, worktrunk, git-repo-manager: `<root>/<host>/<owner>/<repo>` placement, one verb
  that puts a repo in place, worktrees beside the clone. vibe-kanban, git-town, Linear,
  `gh issue develop`: the identifier in the branch name is the join key.
- `npm create vite`, the `create-<name>` convention: a starter written by a package run once.
- `deb822` and `/etc/os-release`: the stanza and `key=value` formats.
- git's repository discovery: the nearest root is the scope, and outside one a command
  stops.
