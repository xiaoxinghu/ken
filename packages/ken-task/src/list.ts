import { spawnSync } from 'node:child_process'
import { type Dirent, lstatSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from 'node:path'
import { type Fields, isDate, type Read, readTask } from './read.ts'

export type State = 'problem' | 'done' | 'wontfix' | 'blocked' | 'later' | 'ready'

/** A blocker that holds a task back: `path` is where it was found, absent when `missing`. */
export type Unmet = { ref: string; path?: string; reason: 'open' | 'missing' }

/** One row of `ken task list`: the file, its fields, its state and what a human needs to know. */
export type Row = { path: string; title: string } & Fields & {
		state: State
		unmet: Unmet[]
		notes: string[]
	}

/** `date` as `YYYY-MM-DD`, local. */
export const localDate = (date: Date): string =>
	`${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`

/**
 * Every task under `folder` by absolute path: every file except README.md and dot entries.
 * A folder or entry that cannot be read is kept, so that `load` lists it as a problem.
 */
function walk(folder: string): string[] {
	let entries: Dirent[]
	try {
		entries = readdirSync(folder, { withFileTypes: true })
	} catch {
		return [folder]
	}
	return entries.flatMap((entry) => {
		const path = join(folder, entry.name)
		if (entry.name.startsWith('.') || entry.name === 'README.md') return []
		if (entry.isDirectory()) return walk(path)
		try {
			return statSync(path, { throwIfNoEntry: false })?.isFile() ? [path] : []
		} catch {
			return [path]
		}
	})
}

function load(path: string): Read {
	try {
		return readTask(basename(path), readFileSync(path, 'utf8'))
	} catch (e) {
		const read = readTask(basename(path), '')
		read.problems.push(
			`it could not be read (${(e as Error).message}): make it a readable file or folder, or remove it; \`ls -ld ${path}\` shows it`
		)
		return read
	}
}

const isOpen = (read: Read): boolean =>
	read.problems.length > 0 || (read.fields.status !== 'done' && read.fields.status !== 'wontfix')

/** The archived file for `rel`, a path relative to the folder: `.archive/<rel>`, at any numeric suffix. */
function archived(folder: string, rel: string): string | undefined {
	const dir = join(folder, '.archive', dirname(rel))
	const ext = extname(rel)
	const stem = basename(rel, ext)
	const literal = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
	const name = new RegExp(`^${literal(stem)}(-\\d+)?${literal(ext)}$`)
	let entries: string[]
	try {
		entries = readdirSync(dir)
	} catch {
		return undefined
	}
	const found = entries.includes(basename(rel)) ? basename(rel) : entries.find((e) => name.test(e))
	return found && join(dir, found)
}

/** When the root's git added each file under `folder`, by absolute path; empty outside git. */
function addedDates(root: string, folder: string): Map<string, string> {
	const dates = new Map<string, string>()
	const r = spawnSync(
		'git',
		[
			...['-c', 'core.quotePath=false', 'log', '--no-renames', '--diff-filter=A', '--relative'],
			...['--name-only', '--format=%x00%as', '--', folder]
		],
		{ cwd: root, encoding: 'utf8' }
	)
	if (r.status !== 0) return dates
	let date = ''
	// newest commit first, so the last date set for a path is the first time it was added
	for (const line of r.stdout.split('\n')) {
		if (line.startsWith('\0')) date = line.slice(1)
		else if (line) dates.set(resolve(root, line), date)
	}
	return dates
}

const days = (from: string, to: string): number =>
	Math.round((Date.parse(to) - Date.parse(from)) / 864e5)

/** Every task in `folder`, a folder of the root `root`, by path, with its state as of `today`. */
export function listTasks(root: string, folder: string, today: string): Row[] {
	const tasks = new Map(walk(folder).map((path) => [path, load(path)]))
	let added: Map<string, string> | undefined
	return [...tasks.keys()].sort().map((path) => {
		const read = tasks.get(path) as Read
		const { title, fields, problems } = read
		const flags = [...read.flags]
		const unmet = fields['blocked-by'].flatMap((ref): Unmet[] => {
			for (const [base, from] of [
				[dirname(path), ''],
				[folder, 'the folder'],
				[root, 'the root']
			] as const) {
				const target = resolve(base, ref)
				const rel = relative(folder, target)
				if (rel === '..' || rel.startsWith('../') || isAbsolute(rel)) continue
				// a reference into the archive names the archived file, at any suffix, as a live one would
				const name = rel.startsWith('.archive/') ? rel.slice('.archive/'.length) : undefined
				const live = name === undefined ? tasks.get(target) : undefined
				if (!live && !archived(folder, name ?? rel)) continue
				if (from) {
					flags.push(
						`blocked-by ${ref} resolves from ${from}, not from this file: write it as ${relative(dirname(path), target)}`
					)
				}
				return live && isOpen(live) ? [{ ref, path: target, reason: 'open' }] : []
			}
			return [{ ref, reason: 'missing' }]
		})
		const open = isOpen(read)
		const state: State = problems.length
			? 'problem'
			: fields.status === 'done' || fields.status === 'wontfix'
				? fields.status
				: unmet.length
					? 'blocked'
					: fields.scheduled && fields.scheduled > today
						? 'later'
						: 'ready'
		const notes = [
			...problems.map((p) => `problem: ${p}`),
			...flags.map((f) => `flagged: ${f}; \`ken task lint\` names the upgrade`)
		]
		if (open && fields.due && fields.due < today) notes.push(`overdue: due ${fields.due}`)
		if (open) {
			let since = fields.created && isDate(fields.created) ? fields.created : undefined
			let by = 'created'
			if (!since) {
				added ??= addedDates(root, folder)
				since = added.get(path)
				by = 'the date git added it'
			}
			if (!since) {
				// lstat, which answers for a symlink loop too
				since = localDate(lstatSync(path).mtime)
				by = 'its mtime'
			}
			const age = days(since, today)
			if (age > 90) notes.push(`open ${age} days, since ${since} by ${by}: finish it, or close it`)
		}
		return { path, title, ...fields, state, unmet: open ? unmet : [], notes }
	})
}

/** The rows as `ken task list` prints them: state, path, unmet blockers, then each note indented. */
export function formatRows(rows: Row[]): string {
	const width = Math.max(...rows.map((r) => r.state.length))
	return rows
		.map((row) => {
			const waits = row.unmet.map(
				(u) =>
					`${u.ref} (${u.reason === 'open' ? 'open' : 'missing: no such file in the folder or its archive'})`
			)
			const line = `${row.state.padEnd(width)}  ${row.path}${waits.length ? `  blocked by ${waits.join(', ')}` : ''}`
			return [line, ...row.notes.map((n) => `${' '.repeat(width + 2)}${n}`)].join('\n')
		})
		.join('\n')
}
