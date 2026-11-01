#!/usr/bin/env node
// The task system, an external subcommand of ken: see docs/ken-task.md.
import { spawnSync } from 'node:child_process'
import { statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { addTask } from './add.ts'
import { formatRows, listTasks, localDate, readyTasks } from './list.ts'
import { resolveTask } from './resolve.ts'

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

Examples:
  ken task list
  ken task ready | head -1
  ken task add portal/fix-login -b portal/web-view-profiles
  ken path "$(ken task path tasks/portal/print-web-views-to-pdf)"

Run \`ken task <command> --help\` for one command.`

const LIST_HELP = `ken task list [--json]

Every task in the folder, by path: its state, the blockers it waits on, and what needs
you. Always exits 0: a file that cannot be fully read is a row, never an abort.

States, in this order:
  problem   the file could not be fully read; its note says the fix
  done      status: done
  wontfix   status: wontfix
  blocked   a blocked-by entry is open, or found in neither the folder nor its .archive/
  later     scheduled is after today
  ready     none of the above

Notes under a row: overdue; open more than 90 days, by created, else the date git added
the file, else its mtime; a problem with its fix; a deviation from the canonical shape,
read anyway, with the upgrade.

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

function list(args: string[]): void {
	const json = args[0] === '--json'
	if (args.length > (json ? 1 : 0)) {
		throw new Error(
			`ken task list takes only --json, got ${JSON.stringify(args.join(' '))}. Run \`ken task list\` or \`ken task list --json\`.`
		)
	}
	const { root, folder } = settings()
	// a folder that cannot be looked at is listed, as a problem row
	let isFolder: boolean
	try {
		isFolder = statSync(folder, { throwIfNoEntry: false })?.isDirectory() ?? false
	} catch {
		isFolder = true
	}
	const rows = isFolder ? listTasks(root, folder, localDate(new Date())) : []
	if (!rows.length) {
		process.stderr.write(
			`${isFolder ? `No tasks in ${folder}` : `${folder} is not a folder, so there are no tasks`}. ` +
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

const COMMANDS: Record<string, [help: string, run: (args: string[]) => void]> = {
	list: [LIST_HELP, list],
	ready: [READY_HELP, ready],
	path: [PATH_HELP, path],
	add: [ADD_HELP, add]
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
