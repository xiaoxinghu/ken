# ken-task — PRD

Plain-text tasks in one folder of a ken root, tied to code by repo key and branch name.
Published as `@unclex/ken-task`, installed by the user beside `ken`; its binary `ken-task`
is found on `PATH` by `ken` dispatch, so it reads as `ken task <command>`. A root or layer
that relies on it says so in its `AGENTS.md`. It depends on `ken` for `config`, `which`,
`path code` and `get -b`, runs git itself for the rest. `ken` never depends on it. This
document says what is true; git is its history.

## Problem

Agents and people need a task list that survives sessions, orders work by dependency, and
maps a task to a branch. The predecessor, `ws`, recognised a task by its denote file name.
Measured on its own volume: one file with a scalar where a list belonged, an unclosed front
matter or a duplicated ID aborted every listing; a keyword typo turned a task into a note
with no warning; a file not named by the scheme was invisible; fields from an earlier
scheme sat ignored in twenty files. The naming grammar was a contract nobody but denote
users knew.

Requirements: a text file dropped into the folder is a task with no markup; a mistake
degrades to a flagged row, never to a hidden state or an aborted listing; the tool writes
one strict shape; every rule is one sentence a person or agent can hold; the knowledge base
never depends on the task system.

## Decisions

1. **One folder.** `task.folder` in `.ken.yaml`, relative to the root or absolute, default
   `tasks`. Every file in it, at any depth, is a task, except `README.md` and dot
   entries. Nothing outside it is ever a task; nothing in it is read by `ken`. A listing
   opens every file in the folder (about 20 µs each), so the folder, not the knowledge
   base, bounds the cost, and the archive keeps it bounded.
2. **One file is one task.** A file has a stable name for a branch to carry; two agents on
   two tasks touch two files, so stock git and any sync merge them; done is one line,
   grouping is a folder, archive is a move; the body grows into the spec. A `- [ ]` line in
   the body is a step: no identity, no state. A folder is a group and nothing more.
3. **The path is the identity.** The file's path relative to the folder, extension
   included: `portal/print-web-views-to-pdf.md`. Two tasks with one title are one task
   twice, so duplicates cannot exist and no ID is minted. A team whose names come from
   elsewhere names the file after them: `PROJ-123.md`. The branch name is the path without
   extension, `portal/print-web-views-to-pdf`.
4. **References are markdown-link paths.** A value in `blocked-by` is written as a link in
   that file's body would be: relative to the file, with extension, so a bare name is a
   sibling and `../ken/x.md` is in the next folder, as every markdown tool reads it.
   `ken-task` resolves it as an editor does and requires the result to be in the folder or
   its archive. Tasks cite knowledge pages root-relative, `ken`'s address for a page. Pages
   never cite tasks: a task is a snapshot, a page is what is true now; what a task learns
   is distilled into a page before the task is archived.
5. **Status is a front matter line; absent means `todo`.** One place for one fact, so no
   precedence rule and no conflict rule. Nothing computable is stored: claimed, landing,
   blocked, later and ready are derived on every run, so nothing derived can go stale.
6. **Read anything, write one shape.** Every command that writes produces the canonical
   file below. The reader accepts the deviations listed under Tolerance, lists the file
   anyway, and `lint` names the upgrade. A file that cannot be fully read is a row in the
   `problem` state, shown as open: a task that nags is better than one that disappears.
7. **Nothing is inferred from git history.** The user says done; the tool checks that the
   branch is an ancestor of the default branch and refuses if not. A squash merge hides a
   merge and a rebase rewrites commits, so landing is a rebase and a merge that keeps the
   commits.
8. **The archive is a permanent record.** `<folder>/.archive/<relative path>`. Only `purge`
   deletes from it, run by a person. A reference is a name, not a location, so archiving
   rewrites no file; resolution looks in the folder, then the archive. `rename` is the only
   command that changes a name, so the only one that rewrites references.
9. **Primitive commands.** Eleven, each one rule, each printing a path or nothing so the
   next command can take it. `done`, `next`, `context`, `unarchive`, bulk archive and
   search are chains of these with `jq`, `xargs`, `cat`, `mv` and `grep`, never commands.
10. **Every message is a next step**: what is the case, why it matters, what to run, with
    real paths filled in.
11. **TypeScript, in this monorepo**, no build step, `node:fs` behind one module.

## The file

```
tasks/portal/print-web-views-to-pdf.md
```

```markdown
---

status: todo
created: 2026-11-01
repo: github.com/xiaoxinghu/portal
blocked-by: [web-view-profiles.md, ../ken/path-for-tasks.md]
---

# Print web views to PDF

What to do, why, and how to check it is done.
```

| Field        | Written by                              | Absent means                                          |
| ------------ | --------------------------------------- | ----------------------------------------------------- |
| `status`     | `add`, `set`                            | `todo`                                                |
| `created`    | `add`                                   | the git date the file was added, else its mtime       |
| `closed`     | `set status done`, `set status wontfix` | not closed                                            |
| `repo`       | `add -r`, `set`                         | not code work: `claim` refuses and says how to set it |
| `blocked-by` | `add -b`, `set`                         | nothing blocks it                                     |
| `scheduled`  | `set`                                   | no start date                                         |
| `due`        | `set`                                   | no deadline                                           |

`status` is `todo`, `done` or `wontfix`. Dates are `YYYY-MM-DD`, local. `repo` is a repo
key, `<host>/<owner>/<repo>`. The title is the first `# ` heading, else the file name with
dashes as spaces. Front matter is YAML, written only when a field is set, and only the line
of the field being set changes, with the lines that continue its value, a trailing comment
kept; an alias of `blocked-by` is that line, written back as `blocked-by`. Unknown fields
are kept byte for byte, so new metadata needs no migration. `set status todo` removes
`closed`. A file whose format has no front matter, a `.txt`, is a task with every default;
`set` refuses it, saying to make it a `.md`. `set` also refuses a file `list` shows as a
`problem`, front matter not closed, and front matter that is one `{...}` mapping, with the
fix: what it writes must read back as written, which it checks before renaming the new text
over the file.

## States

Decided in this order, derived on every run:

| State         | When                                                                          |
| ------------- | ----------------------------------------------------------------------------- |
| problem       | the file could not be fully read; listed with the fix                         |
| landing       | done, but branch `<name>` exists in its repo and is not on the default branch |
| done, wontfix | `status` says so                                                              |
| claimed       | branch `<name>` exists in its repo on this machine                            |
| blocked       | a blocker is open, landing, or missing                                        |
| later         | `scheduled` is after today                                                    |
| ready         | none of the above                                                             |

A blocker holds a task back until it is landed, not merely done. **Resolution** of a
reference is a stat of two paths: live in the folder, its state applies; in the archive,
closed by construction, so it blocks nothing and is not opened; nowhere, missing, which
blocks visibly, because a typo must not make work ready. In the archive means
`.archive/<path>` or `.archive/<stem>-<n><ext>`, the name `archive` gives a second file of
one path; a reference written into `.archive/` is looked up there the same way. **Order** among ready tasks:
earliest `due`, then earliest `created`, then path, so two runs agree. No priority, no
effort, no stored in-progress state.

## Tolerance

Read, never written. Front matter is read by a YAML parser, and tolerance is applied to
the values it gives: every deviation below is one of meaning, never of syntax, so YAML
decides quoting, comments and lists, and no home-made grammar can disagree with it. Each
is listed normally, named with its upgrade by `lint`, and fixed
by `lint --fix` when the fix loses nothing. All but the first and the last are flagged in
`list`: those two are how a file is dropped in, so they are no mistake.

- no front matter, or no `status`: open
- a `status` value that is not one of the three: open
- `blocked_by`, `blockedBy`, `depends_on`, `depends-on`: `blocked-by`
- a scalar where a list belongs; a YAML block list
- a path in `blocked-by` that resolves from the folder or the root but not from the file
- front matter not closed: treated as none, flagged, never fixed automatically
- a `.txt` or other extension: a task with every default

A `status: done` with no `closed` is closed; `lint --fix` adds `closed` from the file's
mtime. `lint --fix` never changes a value it does not understand and never touches the
body.

What a reader cannot settle makes the file a `problem`, each with its fix: the file
cannot be read, or is no regular file (a folder that cannot be opened, a link to nothing,
or a link to a folder, which is not followed, or to a pipe or device, which is never read,
each listed at its path); front matter that is not YAML, or not a mapping, named with its
line, or that holds a value containing itself through an alias; a known field written twice, an alias counting as
`blocked-by`; a known field that is not one value; a date that is not `YYYY-MM-DD`; a
`blocked-by` that is not a list of paths. Each row is made on its own, so whatever fails
while making one makes that row a problem, and nothing stops the listing.

## Commands

Every argument that names a task is any path that reaches the file: absolute, relative to
the shell's directory, to the root, or to the folder, tried in that order, with or without
the extension when exactly one file has that stem, live or else archived. The file must be
in the folder or its `.archive/`; any other path is refused, naming the folder. Output paths are absolute, so
output feeds the next command unchanged. `--json` on `list` is one array of objects, by path: `path`,
`title`, every known field as read (`status` is `todo` when absent), `other` with the
unknown fields as YAML reads them, `state`, `unmet` (each `{ ref, path, reason }`, `reason` `open` or
`missing`, only on an open task) and `notes`. Without `--json` a row is the state, the path
and the unmet blockers, each note indented under it. A missing or empty folder lists
nothing, says on stderr how to add a task, and exits 0. Open more than 90 days counts from
`created`, else the date the root's git first added the path (renames not followed), else
the mtime.

| Command                                | Does                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Refuses                                                                                                                                                                                                                        |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `list [--json]`                        | Every task: path, state, unmet blockers, and what needs you: overdue; open more than 90 days; landing; done but branch remains; claimed but the worktree is missing or holds another branch; uncommitted changes in the worktree; problems with their fix. Always exits 0.                                                                                                                                                                                                                                                                                                                                             | nothing                                                                                                                                                                                                                        |
| `ready`                                | Paths of ready tasks, in order. Nothing ready prints nothing, says on stderr to run `list`, and exits 0.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |                                                                                                                                                                                                                                |
| `path <task>`                          | The file, live or archived. `ken path "$(ken task path <task>)"` gives the README chain.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | a path outside the folder and its archive; a name found nowhere; a stem two files share                                                                                                                                        |
| `add <path> [-r <key>] [-b <task>]...` | Create the file with `status: todo`, `created`, and `repo` and `blocked-by` when given, each blocker written relative to the file; the heading is the name with dashes as spaces; always a `.md`, the one format with front matter, so `.md` is added when no extension is given; folders on the way are made. `<path>` is read as a task argument is, the first reading in the folder taken. The one normalisation is lowercase and spaces to dashes, said on stderr; a name is letters, digits and dashes. Inside a clone or worktree, `-r` defaults to the key `ken which` prints, said on stderr. Prints the path. | a path outside the folder; an extension other than `.md`; a file, or another extension of its stem, that exists; other punctuation in the name, naming the name to use; a blocker found nowhere; a `-r` that is not a repo key |
| `set <task> <field> <value>`           | Rewrite one line of `status`, `repo`, `blocked-by`, `scheduled` or `due`, inserting front matter if there is none. `blocked-by` takes paths as typed and writes them relative to the file. `status done` or `wontfix` also writes `closed`. An empty value removes the line.                                                                                                                                                                                                                                                                                                                                           | `status done` on a repo task whose branch is not on the default branch; an unknown field; an invalid key, date or path; a blocker found nowhere; a file with no front matter format                                            |
| `rename <task> <path>`                 | Move the file, across folders too, and rewrite every live `blocked-by` that named it and the moved file's own `blocked-by` if its folder changed. The heading is content, left alone. The only command that writes a file other than the one named.                                                                                                                                                                                                                                                                                                                                                                    | a claimed or landing task; a target that exists                                                                                                                                                                                |
| `archive <task>...`                    | Move each to `.archive/` at its relative path; a name already there gets a numeric suffix, printed. Touches one file per name.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | an open task; a task whose branch exists: run `finish` first                                                                                                                                                                   |
| `purge --older-than <days>`            | Delete archived files whose `closed`, else mtime, is older. Prints each file, and whether the folder is in git, so nobody purges on the wrong assumption. The one destructive command; never run by a hook.                                                                                                                                                                                                                                                                                                                                                                                                            |                                                                                                                                                                                                                                |
| `claim [<task>]`                       | `git branch <name>` from the clone's default branch as it stands (atomic: the ref lock), then `ken get <key> -b <name>` for the worktree, print its path. Without a task, the first ready repo task; losing the race, the next.                                                                                                                                                                                                                                                                                                                                                                                        | not ready; no `repo`; repo not cloned here                                                                                                                                                                                     |
| `finish <task>`                        | `git worktree remove` then `git branch -d` for a closed task, at the path `ken path code` prints. Git's refusals (uncommitted changes, unmerged commits) pass through.                                                                                                                                                                                                                                                                                                                                                                                                                                                 | an open task                                                                                                                                                                                                                   |
| `lint [--fix]`                         | Every file not in the canonical shape, with the exact upgrade. `--fix` applies the lossless ones.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |                                                                                                                                                                                                                                |

Not commands, by decision 9: `next` is `ready | head -1`; `done` is `set <task> status
done`; archive every closed task is `list --json | jq -r '.[] | select(.state=="done" or
.state=="wontfix") | .path' | xargs ken task archive`; `context` is `cat $(ken path $(ken
task path <task>))` and `git log <default>..<name>`; `unarchive` is `mv`; search is `grep`.

## Concurrency

Several agents on one machine; atomic operations, no lock files. `add` creates with the
exclusive-create flag: the path is the lock, and a loser is told the file exists. `claim`
is atomic through git's ref lock on `git branch`; `ken get -b` is idempotent, so the branch
is made first. `set` and `rename` write a temp file beside the target and rename over it.
Two writers to one body: last wins; in practice only the claim owner edits a task. A synced
folder is the same problem with more delay, out of scope.

## Workflow

`cd "$(ken task claim)"`; read the task and what `ken path` prints for it; commit on
branch `<name>` with a `Task: <name>` trailer; `ken task set <task> status done`. After the
merge, from outside the worktree, `ken task finish <task>`, then distil what is worth
keeping into the knowledge section the folder's `README.md` names: the task will be
archived and the page is what lasts. `set status done` prints that reminder.

## Configuration

```yaml
task:
  folder: tasks # default; relative to the root, or absolute
```

Read through `ken config --json`. Nothing else. Per-repo files to copy and the setup
command for a new worktree are `ken`'s, in the repo's `.ken.yaml`, applied by `get -b`.

## Out of scope for now

- Syncing the folder and more than one machine: `claimed` is read from this machine.
- Root-relative paths in `blocked-by` as a written form; accepted on read.
- A `split` that explodes a dropped-in checklist into files, until a checklist is dropped in.
- Notes, reports and review rounds as their own files: they are sections of the task, or pages.
- Formats beyond Markdown front matter for metadata; other extensions are tasks with defaults.
- An Emacs or editor front end; the folder is ordinary Markdown.

## Considered and rejected

- **Denote names and timestamp IDs.** Right for notes, where titles repeat and change;
  wrong for tasks, where a repeated title is a duplicate. A grammar nobody but denote users
  knew, and a rename on every status change.
- **Status in the file name**, alone or beside front matter. `ls` as a task list was the
  gain; two homes for one fact, and a rename that invalidates every open buffer and path,
  the cost. `ken task list` is the listing.
- **Checkbox items as tasks.** Identity by line number moves when the line above is edited;
  a dependency has nowhere to live; `claim` needs a file.
- **An `id` field, minted on demand or as an override.** The path already is the identity;
  a Jira key is a file name.
- **Notes with states derived from the tasks that mention them, and mentions by grep over
  the knowledge base.** The one operation that read every file in the root, and a link from
  evergreen pages to snapshots. Pages never cite tasks; the question "what work is pending
  on this page" is a scan of the small folder.
- **`done`, `next`, `context` as commands.** Each a chain of primitives; each a contract to
  keep.
- **Rewriting `blocked-by` on archive.** A name still resolves through the archive, so
  nothing needs rewriting, and undo is a plain move.
- **Relying on git history as the archive.** A task can be created and closed between
  commits, and the folder may live on a file share. The archive is the record; git is a
  second copy when it exists.
- **A cache or index.** Linear over a bounded folder stays under 100 ms for any list a
  person would read; an index is what made beads and Taskwarrior stop being plain text.
- **Making every tolerated form express every feature.** The canonical form expresses
  everything; the tool upgrades to it on demand and says so.

## Prior art

- `ws` and its `task` predecessor: claim by branch, folder READMEs as context, readiness
  from dependencies, `list` as the health report, every message a next step. Its denote
  recognition is what this replaces; the measurements above are from its volume.
- todo.txt, TaskPaper: no line is invalid; unrecognised syntax is text. The model for
  "absent status is todo" and "unknown status is open".
- Obsidian Tasks: an unknown status symbol is an open task named Unknown; an invalid date is
  excluded from date queries and found by a query, not an error.
- Taskwarrior orphan UDAs, fpperri/kanban: keep what you do not understand, render it raw.
- Hugo: date from front matter, then file name, then mtime, then git: the fallback chain
  for `created`.
- dstask, git-issue, Backlog.md: one file per task merges with stock git; beads and
  Taskwarrior 3 moved truth into a database and lost hand-editing.
- howm, denote: write fragmentarily, read collectively; identity never rewritten.
- Markdown relative links, as GitHub, Obsidian and VS Code resolve them: the reference form.
