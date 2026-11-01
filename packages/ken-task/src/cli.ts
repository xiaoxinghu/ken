#!/usr/bin/env node
// The task system, an external subcommand of ken: see docs/ken-task.md.
import { spawnSync } from 'node:child_process'
import { statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { formatRows, listTasks, localDate } from './list.ts'

const HELP = `ken task <command>

Plain-text tasks in one folder of the ken root: task.folder in .ken.yaml, relative to the
root or absolute, default tasks. Every file in it, at any depth, is a task, except
README.md and dot entries; its path is its identity.

Commands:
  list [--json]   every task with its state, what it waits on, and what needs you

Examples:
  ken task list
  ken task list --json | jq -r '.[] | select(.state == "ready") | .path'

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

const [command, ...args] = process.argv.slice(2)
const help = (a: string[]) => a.includes('--help') || a.includes('-h')
try {
	if (command === undefined || command === 'help' || help([command])) {
		process.stdout.write(`${HELP}\n`)
	} else if (command === 'list') {
		if (help(args)) process.stdout.write(`${LIST_HELP}\n`)
		else list(args)
	} else {
		throw new Error(
			`${JSON.stringify(command)} is not a ken task command. Run \`ken task --help\` for the commands.`
		)
	}
} catch (e) {
	process.stderr.write(`ken task: ${e instanceof Error ? e.message : String(e)}\n`)
	process.exit(1)
}
