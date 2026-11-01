import { spawnSync } from 'node:child_process'
import { type Dirent, existsSync, lstatSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { branchOf, codePath, dirty, type Repo, repos } from './git.ts'
import { CANONICAL, type Fields, type Read, readTask } from './read.ts'
import { archived, real } from './resolve.ts'

export type State =
	| 'problem'
	| 'landing'
	| 'done'
	| 'wontfix'
	| 'claimed'
	| 'blocked'
	| 'later'
	| 'ready'

/** A blocker that holds a task back: `path` is where it was found, absent when `missing`. */
export type Unmet = { ref: string; path?: string; reason: 'open' | 'landing' | 'missing' }

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
export function walk(folder: string): string[] {
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
export function load(path: string): Read {
	try {
		// a link may lead to a folder, a pipe or a device, which a read would fail on, block on
		// or never finish
		if (!statSync(path).isFile()) throw new Error('it is not a regular file')
		return readTask(basename(path), readFileSync(path, 'utf8'))
	} catch (e) {
		const read = readTask(basename(path), '')
		read.problems.push(
			`it could not be read (${(e as Error).message}): make it a readable file, or remove it; \`ls -ld ${path}\` shows it`
		)
		return read
	}
}

const isOpen = (read: Read): boolean =>
	read.problems.length > 0 || (read.fields.status !== 'done' && read.fields.status !== 'wontfix')

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

/** When a task in `folder` was created, and by what: `created`, else the date git added it, else its mtime. */
type Since = (path: string, created?: string) => [date: string, by: string]

export function since(root: string, folder: string): Since {
	let added: Map<string, string> | undefined
	return (path, created) => {
		if (created) return [created, 'created']
		added ??= addedDates(root, folder)
		const git = added.get(path)
		return git ? [git, 'the date git added it'] : [localDate(lstatSync(path).mtime), 'its mtime']
	}
}

/**
 * Where `ref`, written in the file at `path` in `folder`, a folder of `root`, leads:
 * `target`, its live task, one of `live`, unless it is archived, and `from` what it resolved
 * from when that is not the file; undefined if nowhere.
 */
export function resolveRef(
	root: string,
	folder: string,
	live: { has(path: string): boolean },
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
		const found = live.has(target) ? target : real(target)
		if (live.has(found)) return { target, live: found, from }
		if (archived(folder, rel)) return { target, from }
	}
}

/**
 * The paths of the ready tasks in `configured` as of `today`, in the order to take them:
 * earliest `due`, then earliest created, then path, so two runs agree.
 */
export function readyTasks(root: string, configured: string, today: string): string[] {
	const created = since(root, real(configured))
	const key = (row: Row) => [row.due ?? '~', created(row.path, row.created)[0], row.path]
	return listTasks(root, configured, today, created)
		.filter((row) => row.state === 'ready')
		.map((row) => ({ path: row.path, key: key(row) }))
		.sort((a, b) => (a.key.join('\0') < b.key.join('\0') ? -1 : 1))
		.map((row) => row.path)
}

/**
 * Every task in `folder`, a folder of the root `root`, by path, with its state as of
 * `today`. Each row is made on its own: whatever throws while making one makes that row a
 * problem, so no file can stop the listing.
 */
export function listTasks(
	root: string,
	configured: string,
	today: string,
	created: Since = since(root, real(configured))
): Row[] {
	// the real path, as the root is, so that every path compares as the disk names it
	const folder = real(configured)
	const tasks = new Map(walk(folder).map((path) => [path, load(path)]))
	const repo = repos()
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

	/** The repo of the task at `path` and its branch, when the branch exists on this machine. */
	function branch(path: string, read: Read): { repo: Repo; name: string } | undefined {
		const found = read.fields.repo && !read.problems.length ? repo(read.fields.repo) : undefined
		const name = branchOf(folder, path)
		return found?.exists(name) ? { repo: found, name } : undefined
	}

	/** Done, but its branch exists and is not on the default branch: not landed yet. */
	function isLanding(path: string, read: Read): boolean {
		const b = read.fields.status === 'done' ? branch(path, read) : undefined
		return !!b && !b.repo.landed(b.name)
	}

	function row(path: string, read: Read): Row {
		const { title, fields, problems } = read
		const flags = [...read.flags, ...read.reshape.map((what) => `${what}: ${CANONICAL}`)]
		const unmet = fields['blocked-by'].flatMap((ref): Unmet[] => {
			const found = resolveRef(root, folder, tasks, path, ref)
			if (!found) return [{ ref, reason: 'missing' }]
			if (found.from) {
				flags.push(
					`blocked-by ${ref} resolves from ${found.from}, not from this file: write it as ${relative(dirname(path), found.target)}`
				)
			}
			const live = found.live && tasks.get(found.live)
			if (!found.live || !live) return []
			if (isOpen(live)) return [{ ref, path: found.live, reason: 'open' }]
			return isLanding(found.live, live) ? [{ ref, path: found.live, reason: 'landing' }] : []
		})
		const open = isOpen(read)
		const b = branch(path, read)
		const state: State = problems.length
			? 'problem'
			: isLanding(path, read)
				? 'landing'
				: fields.status === 'done' || fields.status === 'wontfix'
					? fields.status
					: b
						? 'claimed'
						: unmet.length
							? 'blocked'
							: fields.scheduled && fields.scheduled > today
								? 'later'
								: 'ready'
		const notes = [
			...problems.map((p) => `problem: ${p}`),
			...flags.map((f) => `flagged: ${f}; \`ken task lint\` names the upgrade`)
		]
		if (b) notes.push(...branchNotes(path, state, b.repo, b.name))
		if (open && fields.due && fields.due < today) notes.push(`overdue: due ${fields.due}`)
		// a problem row's note is its fix; it is never asked its age, so it cannot fail again
		if (open && !problems.length) {
			const [from, by] = created(path, fields.created)
			const age = days(from, today)
			if (age > 90) notes.push(`open ${age} days, since ${from} by ${by}: finish it, or close it`)
		}
		return { path, title, ...fields, state, unmet: open ? unmet : [], notes }
	}
}

/** What needs you about the branch `name` of the task at `path`, in state `state`. */
function branchNotes(path: string, state: State, repo: Repo, name: string): string[] {
	const { key, clone } = repo
	const notes: string[] = []
	const finish = `\`ken task finish ${path}\` removes its worktree and branch`
	if (state === 'landing') {
		notes.push(
			`landing: branch ${name} of ${key} is not on the default branch, and dependents wait until it is: ` +
				`rebase it onto the default branch, then \`git -C ${clone} merge --no-ff ${name}\`; then ${finish}`
		)
	} else if (state === 'done' || state === 'wontfix') {
		notes.push(`${state}, but its branch ${name} remains in ${key}: ${finish}`)
	}
	const worktree = repo.worktree(name)
	if (state === 'claimed') {
		const expected = codePath(key, name)
		const held = repo.holds(expected)
		if (held && held !== name) {
			notes.push(
				`claimed, but its worktree ${expected} holds branch ${held}, so work there lands on the wrong branch: ` +
					`\`git -C ${expected} switch ${name}\``
			)
		} else if (!worktree || !existsSync(worktree)) {
			notes.push(
				`claimed, but its worktree ${expected} is missing, so no one can be working on it: ` +
					`\`git -C ${clone} worktree prune && ken get ${key} -b ${name}\` makes it again`
			)
		}
	}
	if (worktree && existsSync(worktree) && dirty(worktree)) {
		notes.push(
			`uncommitted changes in ${worktree}, which finishing it would refuse to remove: commit them on ${name}, or discard them; \`git -C ${worktree} status\` shows them`
		)
	}
	return notes
}

/** The rows as `ken task list` prints them: state, path, unmet blockers, then each note indented. */
export function formatRows(rows: Row[]): string {
	const width = Math.max(...rows.map((r) => r.state.length))
	return rows
		.map((row) => {
			const waits = row.unmet.map(
				(u) =>
					`${u.ref} (${u.reason === 'missing' ? 'missing: no such file in the folder or its archive' : u.reason})`
			)
			const line = `${row.state.padEnd(width)}  ${row.path}${waits.length ? `  blocked by ${waits.join(', ')}` : ''}`
			return [line, ...row.notes.map((n) => `${' '.repeat(width + 2)}${n}`)].join('\n')
		})
		.join('\n')
}
