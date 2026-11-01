import { spawnSync } from 'node:child_process'
import { type Dirent, lstatSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from 'node:path'
import { type Fields, type Read, readTask } from './read.ts'

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
 * Every task under `folder` by absolute path: every file or symlink except README.md and
 * dot entries, told apart by what `readdir` says, so nothing is looked at twice. A folder
 * that cannot be read is itself an entry, which then fails to read as a task.
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
		return entry.isFile() || entry.isSymbolicLink() ? [path] : []
	})
}

/** The task at `path`; whatever stops it being read makes it a problem, with the fix. */
function load(path: string): Read {
	try {
		return readTask(basename(path), readFileSync(path, 'utf8'))
	} catch (e) {
		const read = readTask(basename(path), '')
		read.problems.push(
			`it could not be read (${(e as Error).message}): make it a readable file, or remove it; \`ls -ld ${path}\` shows it`
		)
		return read
	}
}

/** `path` as the disk names it, which on a case-insensitive disk may differ in case. */
function real(path: string): string {
	try {
		return realpathSync.native(path)
	} catch {
		return path
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
	const found = [basename(rel), ...entries.filter((e) => name.test(e))]
		.map((e) => join(dir, e))
		.find((path) => statSync(path, { throwIfNoEntry: false })?.isFile())
	return found
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

/**
 * Every task in `folder`, a folder of the root `root`, by path, with its state as of
 * `today`. Each row is made on its own: whatever throws while making one makes that row a
 * problem, so no file can stop the listing.
 */
export function listTasks(root: string, configured: string, today: string): Row[] {
	// the real path, as the root is, so that every path compares as the disk names it
	const folder = real(configured)
	const tasks = new Map(walk(folder).map((path) => [path, load(path)]))
	let added: Map<string, string> | undefined
	const addedDate = (path: string) => {
		added ??= addedDates(root, folder)
		return added.get(path)
	}
	return [...tasks.entries()]
		.sort(([a], [b]) => (a < b ? -1 : 1))
		.map(([path, read]) => {
			try {
				return row(path, read)
			} catch (e) {
				const failed = readTask(basename(path), '')
				failed.problems.push(
					`ken-task could not list it (${(e as Error).message}): fix what that names, then rerun \`ken task list\``
				)
				return row(path, failed)
			}
		})

	/**
	 * Where `ref`, written in the file at `path`, leads: `target`, its live task unless it is
	 * archived, and `from` what it resolved from when that is not the file; undefined if nowhere.
	 */
	function resolveRef(
		path: string,
		ref: string
	): { target: string; live?: string; from: string } | undefined {
		for (const [base, from] of [
			[dirname(path), ''],
			[folder, 'the folder'],
			[root, 'the root']
		] as const) {
			const target = resolve(base, ref)
			const rel = relative(folder, target)
			if (rel === '..' || rel.startsWith('../') || isAbsolute(rel)) continue
			// a reference into the archive names the archived file, at any suffix, as a live one would
			if (rel.startsWith('.archive/')) {
				if (archived(folder, rel.slice('.archive/'.length))) return { target, from }
				continue
			}
			// the path as written, else as the disk names it, which may differ in case
			const live = tasks.has(target) ? target : real(target)
			if (tasks.has(live)) return { target, live, from }
			if (archived(folder, rel)) return { target, from }
		}
	}

	function row(path: string, read: Read): Row {
		const { title, fields, problems } = read
		const flags = [...read.flags]
		const unmet = fields['blocked-by'].flatMap((ref): Unmet[] => {
			const found = resolveRef(path, ref)
			if (!found) return [{ ref, reason: 'missing' }]
			if (found.from) {
				flags.push(
					`blocked-by ${ref} resolves from ${found.from}, not from this file: write it as ${relative(dirname(path), found.target)}`
				)
			}
			const live = found.live && tasks.get(found.live)
			return live && isOpen(live) ? [{ ref, path: found.live, reason: 'open' }] : []
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
		// a problem row's note is its fix; it is never asked its age, so it cannot fail again
		if (open && !problems.length) {
			const git = fields.created ? undefined : addedDate(path)
			const [since, by] = fields.created
				? [fields.created, 'created']
				: git
					? [git, 'the date git added it']
					: [localDate(lstatSync(path).mtime), 'its mtime']
			const age = days(since, today)
			if (age > 90) notes.push(`open ${age} days, since ${since} by ${by}: finish it, or close it`)
		}
		return { path, title, ...fields, state, unmet: open ? unmet : [], notes }
	}
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
