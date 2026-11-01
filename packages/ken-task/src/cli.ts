#!/usr/bin/env node
// The task system, an external subcommand of ken: see docs/ken-task.md.
import { spawnSync } from 'node:child_process'
import { statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { addTask } from './add.ts'
import { archiveTasks, purgeArchive } from './archive.ts'
import { finishTask } from './finish.ts'
import { lintTasks } from './lint.ts'
import { formatRows, listTasks, localDate, readyTasks } from './list.ts'
import { renameTask } from './rename.ts'
import { resolveTask } from './resolve.ts'
import { setTask } from './set.ts'

const HELP = `ken task <command>

Plain-text tasks in one folder of the ken root: task.folder in .ken.yaml, relative to the
root or absolute, default tasks. Every file in it, at any depth, is a task, except
README.md and dot entries; its path is its identity.

A command that names a task takes any path that reaches the file: absolute, from here,
from the root or from the folder, with or without its extension when one file has that
stem.

Commands:
  list [--json]   every task with its state, what it waits on, and what needs you
  ready           the paths of the ready tasks, in the order to take them
  path <task>     the absolute path of a task, live or archived
  add <path> [-r <key>] [-b <task>]...
                  create a task file, print its path
  set <task> <field> <value>
                  rewrite one front matter line: status, repo, blocked-by, scheduled, due
  rename <task> <path>
                  move a task file, rewriting every blocked-by that names it
  finish <task>   remove the worktree and branch of a done or wontfix task
  lint [--fix]    every file not in the canonical shape, with the upgrade
  archive <task>...
                  move closed tasks into the folder's .archive/, print the new paths
  purge --older-than <days>
                  delete archived tasks closed more than <days> ago; for a person to run

Examples:
  ken task list
  ken task ready | head -1
  ken task add portal/fix-login -b portal/web-view-profiles
  ken path "$(ken task path tasks/portal/print-web-views-to-pdf)"
  ken task set tasks/portal/print-web-views-to-pdf status done
  ken task rename tasks/portal/print-web-views-to-pdf portal/print-to-pdf
  ken task finish tasks/portal/print-web-views-to-pdf
  ken task lint --fix
  ken task archive tasks/portal/print-web-views-to-pdf

Run \`ken task <command> --help\` for one command.`

const LIST_HELP = `ken task list [--json]

Every task in the folder, by path: its state, the blockers it waits on, and what needs
you. Always exits 0: a file that cannot be fully read is a row, never an abort.

States, in this order. A task's branch is its path in the folder without extension, in
the clone of its repo that \`ken path code <repo>\` prints:
  problem   the file could not be fully read; its note says the fix
  landing   status: done, but its branch exists and is not on the default branch
  done      status: done
  wontfix   status: wontfix
  claimed   open, and its branch exists
  blocked   a blocked-by entry is open, landing, or found in neither the folder nor its
            .archive/
  later     scheduled is after today
  ready     none of the above

A repo not cloned here has no branches, said once on stderr.

Notes under a row: overdue; open more than 90 days, by created, else the date git added
the file, else its mtime; landing; closed but its branch remains; claimed but its
worktree is missing or holds another branch; uncommitted changes in its worktree; a
problem with its fix; a deviation from the canonical shape, read anyway, with the
upgrade.

  --json    one array of objects: path, title, every field read, other (the fields
            ken-task does not know), state, unmet blockers and notes

Examples:
  ken task list
  ken task list --json | jq -r '.[] | select(.state == "blocked") | .path'
  ken task list --json | jq '.[] | select(.notes | length > 0) | {path, notes}'`

const READY_HELP = `ken task ready

The absolute paths of the ready tasks, one per line, in the order to take them: earliest
due (none last), then earliest created (else the date git added the file, else its
mtime), then path. A task is ready when it is open, no blocker is open or missing, and
it is not scheduled after today. Nothing ready prints nothing and exits 0.

Examples:
  ken task ready
  ken task ready | head -1
  ken task ready | xargs -n1 head -5`

const PATH_HELP = `ken task path <task>

The absolute path of the task file, in the folder or its .archive/. <task> is any path
that reaches it: absolute, from here, from the root or from the folder, with or without its extension
when exactly one file has that stem. A path outside the folder is refused; a task found
nowhere exits 1.

Examples:
  ken task path tasks/portal/print-web-views-to-pdf.md
  cd tasks && ken task path portal/print-web-views-to-pdf
  ken path "$(ken task path tasks/portal/print-web-views-to-pdf)"   # its README chain`

const ADD_HELP = `ken task add <path> [-r <key>] [-b <task>]...

Create the task file and print its absolute path. <path> is where it goes in the folder:
absolute, from here, from the root or from the folder; it is a .md, the one format with
front matter, so .md is added when it has no extension and any other is refused; folders
on the way are made. A task's path is its branch name, so it is
lowercased and spaces become dashes, said on stderr; other punctuation is refused with
the name to use instead. The file is:

  ---
  status: todo
  created: <today>
  repo: <key>                 with -r, or inside a clone
  blocked-by: [<task>, ...]   with -b
  ---

  # <the name, dashes as spaces>

  -r <key>    the repo the work is in, <host>/<owner>/<repo>; inside a clone or worktree
              it defaults to the key \`ken which\` prints there
  -b <task>   a task this one waits on, any path that reaches it, live or archived;
              repeat for more; written relative to the new file

Refused before anything is written: a path outside the folder; a file that exists, or
another extension of the same name; a -b found nowhere; a -r that is no repo key.

Examples:
  ken task add portal/fix-login
  ken task add "Fix Login"                                # tasks/fix-login.md
  ken task add portal/fix-login -r github.com/acme/portal -b portal/web-view-profiles
  echo 'Login fails after a password reset.' >> "$(ken task add portal/fix-login)"`

const SET_HELP = `ken task set <task> <field> <value>

Rewrite the one front matter line of <field> in the task file and print its absolute
path. Every other byte stays: other fields, comments on the line, the body, the line
endings. A missing line is added to the front matter; a file with none gets one at the
top. An empty value removes the line.

Fields:
  status      todo, done or wontfix; done or wontfix also writes closed: <today>, todo
              removes closed
  repo        a repo key, <host>/<owner>/<repo>, e.g. github.com/acme/join-web
  blocked-by  comma-separated tasks, each any path that reaches the file from here, the
              root or the folder, found live or archived; written relative to the file
  scheduled   YYYY-MM-DD, the day the task becomes ready
  due         YYYY-MM-DD, its deadline

Only a .md has front matter; another file is refused, as is one \`ken task list\` shows
as a problem, until the fix its note names is made. status done is refused on a task
whose branch, its path in the folder without extension, exists in its repo and is not on
the default branch: done means landed, by a rebase then a merge that keeps the commits.

Examples:
  ken task set tasks/portal/print-web-views-to-pdf status done
  ken task set tasks/portal/print-web-views-to-pdf repo github.com/xiaoxinghu/portal
  ken task set tasks/portal/print-web-views-to-pdf blocked-by tasks/portal/a,tasks/ken/b.md
  ken task set tasks/portal/print-web-views-to-pdf due 2026-11-30
  ken task set tasks/portal/print-web-views-to-pdf scheduled ''   # remove the line`

/** The root and the task folder, absolute, through `ken config --json` (PRD decision 11). */
function settings(): { root: string; folder: string } {
	const r = spawnSync('ken', ['config', '--json'], { encoding: 'utf8' })
	if (r.error) {
		throw new Error(
			`ken-task reads the root and task.folder from \`ken config --json\`, but ken could not be run: ${r.error.message}. ` +
				'Install @unclex/ken so `ken` is on PATH, then rerun.'
		)
	}
	if (r.status !== 0) {
		throw new Error(
			`ken-task reads the root and task.folder from \`ken config --json\`, which failed:\n${r.stderr.trim()}`
		)
	}
	const config = JSON.parse(r.stdout) as { root: { value: string }; task?: unknown }
	const root = config.root.value
	const task = config.task ?? {}
	const folder =
		typeof task === 'object' && !Array.isArray(task)
			? ((task as { folder?: unknown }).folder ?? 'tasks')
			: undefined
	if (typeof folder !== 'string' || !folder) {
		throw new Error(
			`task.folder in ${join(root, '.ken.yaml')} must be a folder, relative to the root or absolute, like \`task: { folder: tasks }\`; ` +
				`got ${JSON.stringify(task)}, so ken-task cannot find the tasks. Fix it, then run \`ken config --json | jq .task\` to check.`
		)
	}
	return { root, folder: resolve(root, folder) }
}

/** Whether `folder` is a folder; one that cannot be looked at counts, so its error is a row. */
function isFolder(folder: string): boolean {
	try {
		return statSync(folder, { throwIfNoEntry: false })?.isDirectory() ?? false
	} catch {
		return true
	}
}

function list(args: string[]): void {
	const json = args[0] === '--json'
	if (args.length > (json ? 1 : 0)) {
		throw new Error(
			`ken task list takes only --json, got ${JSON.stringify(args.join(' '))}. Run \`ken task list\` or \`ken task list --json\`.`
		)
	}
	const { root, folder } = settings()
	const found = isFolder(folder)
	const rows = found ? listTasks(root, folder, localDate(new Date())) : []
	if (!rows.length) {
		process.stderr.write(
			`${found ? `No tasks in ${folder}` : `${folder} is not a folder, so there are no tasks`}. ` +
				`Add one by writing a file there, e.g. \`mkdir -p ${folder} && echo '# Do the thing' > ${folder}/do-the-thing.md\`, ` +
				'or point task.folder in .ken.yaml at your tasks.\n'
		)
	}
	if (json) process.stdout.write(`${JSON.stringify(rows, null, 2)}\n`)
	else if (rows.length) process.stdout.write(`${formatRows(rows)}\n`)
}

function ready(args: string[]): void {
	if (args.length) {
		throw new Error(
			`ken task ready takes no arguments, got ${JSON.stringify(args.join(' '))}. Run \`ken task ready\`.`
		)
	}
	const { root, folder } = settings()
	const paths = readyTasks(root, folder, localDate(new Date()))
	if (paths.length) process.stdout.write(`${paths.join('\n')}\n`)
	else {
		process.stderr.write(
			`No task in ${folder} is ready. Run \`ken task list\` to see what each task waits on.\n`
		)
	}
}

function path(args: string[]): void {
	if (args.length !== 1) {
		throw new Error(
			`ken task path takes one task, got ${args.length}. Run \`ken task path <task>\`, e.g. \`ken task path tasks/do-the-thing.md\`.`
		)
	}
	const { root, folder } = settings()
	process.stdout.write(`${resolveTask(root, folder, process.cwd(), args[0] ?? '')}\n`)
}

function add(args: string[]): void {
	const usage =
		'Run `ken task add <path> [-r <key>] [-b <task>]...`, e.g. `ken task add portal/fix-login -b portal/web-view-profiles`.'
	const paths: string[] = []
	const blockedBy: string[] = []
	let repo: string | undefined
	for (let i = 0; i < args.length; i++) {
		const arg = args[i] ?? ''
		const value = args[i + 1]
		if ((arg === '-r' || arg === '-b') && value === undefined) {
			throw new Error(`${arg} takes a value, and none followed it. ${usage}`)
		}
		if (arg === '-r') {
			if (repo !== undefined)
				throw new Error(`-r is given twice, and a task has one repo. ${usage}`)
			repo = value
			i++
		} else if (arg === '-b') {
			blockedBy.push(value ?? '')
			i++
		} else if (arg.startsWith('-')) {
			throw new Error(`ken task add takes -r and -b, not ${arg}. ${usage}`)
		} else paths.push(arg)
	}
	if (paths.length !== 1) {
		throw new Error(
			`ken task add takes one path, got ${paths.length}: quote a name with spaces. ${usage}`
		)
	}
	const { root, folder } = settings()
	if (repo === undefined) {
		const r = spawnSync('ken', ['which', '--json'], { encoding: 'utf8' })
		repo = r.status === 0 ? (JSON.parse(r.stdout) as { key: string }).key : undefined
		if (repo) {
			process.stderr.write(
				`repo: ${repo}, the clone this runs in, as \`ken which\` says; pass -r <key> for another repo.\n`
			)
		}
	}
	const added = addTask(root, folder, process.cwd(), paths[0] ?? '', {
		repo,
		blockedBy,
		today: localDate(new Date())
	})
	if (added.renamed) process.stderr.write(`${added.renamed}\n`)
	process.stdout.write(`${added.path}\n`)
}

function set(args: string[]): void {
	const [task, field, value] = args
	if (args.length !== 3 || task === undefined || field === undefined || value === undefined) {
		throw new Error(
			`ken task set takes a task, a field and a value, got ${args.length} arguments. ` +
				"Run `ken task set <task> <field> <value>`, e.g. `ken task set tasks/do-the-thing.md status done`, or `''` as the value to remove the line."
		)
	}
	const { root, folder } = settings()
	const path = setTask(root, folder, process.cwd(), [task, field, value], localDate(new Date()))
	process.stdout.write(`${path}\n`)
	if (field === 'status' && value === 'done') {
		process.stderr.write(
			`Done. Before the task is archived, distil what it taught into the knowledge section its folder's README.md names; \`ken path "${path}"\` prints that README chain.\n`
		)
	}
}

const RENAME_HELP = `ken task rename <task> <path>

Move the task file to <path> and print its new absolute path. <path> is read as add reads
one: absolute, from here, from the root or from the folder; lowercased with dashes for
spaces, said on stderr; a .md, .md added when it has no extension; folders on the way are
made. A task's path is its identity, so rename keeps every reference true:

  - every live task whose blocked-by names it gets that value rewritten, relative to its
    own file, the rest of the line, a comment included, kept
  - moved to another folder, its own blocked-by is rewritten so each value still resolves

The heading is content and is left alone. Files in .archive/ are never touched, so a
reference from an archived task may go stale. The new file is made first and the old one
removed last; a write that fails midway is undone, so nothing is renamed.

Refused before anything is written: a task whose branch, its path in the folder without
extension, exists in its repo (claimed, landing, or not finished), since the branch
carries the old name: close it and run \`ken task finish\` first; an archived task; a link
to it, which the move would break, or whose blocked-by names it, since the file behind it
may be archived; a live task that cannot be fully read, a problem in \`ken task list\`,
since it may name it; a file of another extension whose text would read as other fields
once a .md; a target that exists, or another extension of its name; other punctuation
in <path>.

Examples:
  ken task rename tasks/fix-login tasks/fix-login-after-reset
  ken task rename tasks/fix-login portal/fix-login          # into tasks/portal/
  ken task rename "$(ken task ready | head -1)" portal/next-up`

const FINISH_HELP = `ken task finish <task>

Remove the worktree, then the branch, of a done or wontfix task: \`git worktree remove\`
then \`git branch -d\`, in the clone \`ken path code <repo>\` prints. The branch is the
task's path in the folder without extension. Run it from outside the worktree. Prints
nothing on stdout; stderr says what was removed. A task with no repo, or no branch here,
has nothing to remove.

Refused: an open task, so work in progress is never thrown away; set it done first.
Git's own refusals pass through, uncommitted changes in the worktree or commits not on
the default branch, with the --force form to run by hand when they are to go.

Examples:
  ken task set tasks/portal/print-web-views-to-pdf status done
  ken task finish tasks/portal/print-web-views-to-pdf
  ken task list --json | jq -r '.[] | select(.state == "done") | .path' | xargs -n1 ken task finish`

function rename(args: string[]): void {
	if (args.length !== 2) {
		throw new Error(
			`ken task rename takes a task and a path, got ${args.length} arguments: quote a name with spaces. ` +
				'Run `ken task rename <task> <path>`, e.g. `ken task rename tasks/fix-login.md portal/fix-login`.'
		)
	}
	const { root, folder } = settings()
	const renamed = renameTask(root, folder, process.cwd(), args[0] ?? '', args[1] ?? '')
	if (renamed.renamed) process.stderr.write(`${renamed.renamed}\n`)
	process.stdout.write(`${renamed.path}\n`)
}

function finish(args: string[]): void {
	if (args.length !== 1) {
		throw new Error(
			`ken task finish takes one task, got ${args.length}. Run \`ken task finish <task>\`, e.g. \`ken task finish tasks/do-the-thing.md\`.`
		)
	}
	const { root, folder } = settings()
	process.stderr.write(`${finishTask(root, folder, process.cwd(), args[0] ?? '')}\n`)
}

const LINT_HELP = `ken task lint [--fix]

Every file in the task folder not in the canonical shape, one line per deviation: its
absolute path, what deviates, and the upgrade, as a command or an edit. Exits 0 when
nothing deviates, 1 otherwise, so a hook can run it. The archive is not linted.

  --fix   apply the upgrades that lose nothing, each printed as done; the rest stay
          listed, and the exit code says whether any is left

Applied by --fix, through the one-line writer of \`ken task set\`, every other byte kept:
  no status line                    status: todo
  no created line                   created: <the date git added it, else its mtime>
  status done or wontfix, no closed closed: <its mtime>
  blocked_by, blockedBy, depends_on, depends-on, a single value, a block list
                                    blocked-by: [a.md, b.md]
  a blocked-by path that resolves only from the folder or the root
                                    the path relative to the file

Only named, for you to fix: a status other than todo, done or wontfix; front matter with
no closing ---; a blocked-by found nowhere; a file that is not a .md; a file \`ken task
list\` shows as a problem. The body is never touched.

Examples:
  ken task lint
  ken task lint --fix
  ken task lint | cut -d: -f1 | sort -u      # the files that deviate`

function lint(args: string[]): void {
	const fix = args[0] === '--fix'
	if (args.length > (fix ? 1 : 0)) {
		throw new Error(
			`ken task lint takes only --fix, got ${JSON.stringify(args.join(' '))}. Run \`ken task lint\` or \`ken task lint --fix\`.`
		)
	}
	const { root, folder } = settings()
	if (!isFolder(folder)) return
	const { lines, deviates } = lintTasks(root, folder, fix)
	if (lines.length) process.stdout.write(`${lines.join('\n')}\n`)
	if (deviates) process.exitCode = 1
}

const ARCHIVE_HELP = `ken task archive <task>...

Move each task to <folder>/.archive/<its path in the folder> and print its new absolute
path. Nothing else is read or written: a blocked-by naming it still resolves, through the
archive, and an archived blocker blocks nothing. A name already in the archive keeps its
file; the new one takes a numeric suffix before its extension, fix-login-2.md, said on
stderr. To bring one back, \`mv\` it.

Refused, every task checked before any is moved: an open task (todo, an unknown status,
or a file that could not be fully read), since its dependents would become ready; a task
whose branch still exists in its repo here, to remove first with \`ken task finish\`; a
task already archived.

Examples:
  ken task archive tasks/portal/print-web-views-to-pdf
  ken task archive tasks/portal/a.md tasks/portal/b.md
  ken task list --json | jq -r '.[] | select(.state == "done" or .state == "wontfix") | .path' | xargs ken task archive`

function archive(args: string[]): void {
	if (!args.length) {
		throw new Error(
			'ken task archive takes one task or more, got none. Run `ken task archive <task>...`, e.g. `ken task archive tasks/do-the-thing.md`.'
		)
	}
	const { root, folder } = settings()
	for (const { path, renamed } of archiveTasks(root, folder, process.cwd(), args)) {
		if (renamed) process.stderr.write(`${renamed}\n`)
		process.stdout.write(`${path}\n`)
	}
}

const PURGE_HELP = `ken task purge --older-than <days>

Delete every file in <folder>/.archive/ whose closed date, else its mtime, is more than
<days> days before today, and print each path deleted. Then say once whether the folder
is in a git work tree: if it is, its history holds what was committed of them; if not,
nothing holds a copy. --older-than has no default. The one command that deletes a task:
run it by hand, never from a hook or an agent.

Examples:
  ken task purge --older-than 365
  ken task purge --older-than 90 | wc -l`

function purge(args: string[]): void {
	const [flag, days] = args
	if (args.length !== 2 || flag !== '--older-than' || !/^\d+$/.test(days ?? '')) {
		throw new Error(
			`ken task purge takes --older-than <days>, a whole number with no default, since it deletes; got ${JSON.stringify(args.join(' '))}. ` +
				'Run `ken task purge --older-than <days>`, e.g. `ken task purge --older-than 365`.'
		)
	}
	const { folder } = settings()
	const { deleted, said } = purgeArchive(folder, Number(days), new Date())
	if (deleted.length) process.stdout.write(`${deleted.join('\n')}\n`)
	process.stderr.write(`${said}\n`)
}

const COMMANDS: Record<string, [help: string, run: (args: string[]) => void]> = {
	list: [LIST_HELP, list],
	ready: [READY_HELP, ready],
	path: [PATH_HELP, path],
	add: [ADD_HELP, add],
	set: [SET_HELP, set],
	rename: [RENAME_HELP, rename],
	finish: [FINISH_HELP, finish],
	lint: [LINT_HELP, lint],
	archive: [ARCHIVE_HELP, archive],
	purge: [PURGE_HELP, purge]
}

const [command, ...args] = process.argv.slice(2)
const help = (a: string[]) => a.includes('--help') || a.includes('-h')
const found = command !== undefined && Object.hasOwn(COMMANDS, command) && COMMANDS[command]
try {
	if (command === undefined || command === 'help' || help([command])) {
		process.stdout.write(`${HELP}\n`)
	} else if (found) {
		const [text, run] = found
		if (help(args)) process.stdout.write(`${text}\n`)
		else run(args)
	} else {
		throw new Error(
			`${JSON.stringify(command)} is not a ken task command. Run \`ken task --help\` for the commands.`
		)
	}
} catch (e) {
	process.stderr.write(`ken task: ${e instanceof Error ? e.message : String(e)}\n`)
	process.exit(1)
}
