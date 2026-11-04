import { lstatSync, readdirSync, realpathSync, statSync } from 'node:fs'
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from 'node:path'

/**
 * `path` as the disk names it, which on a case-insensitive disk may differ in case; the part
 * that does not exist is kept as written, under the real path of the part that does.
 */
export function real(path: string): string {
	try {
		return realpathSync.native(path)
	} catch {
		const parent = dirname(path)
		return parent === path ? path : join(real(parent), basename(path))
	}
}

const literal = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** The archived file for `rel`, a path relative to the folder: `.archive/<rel>`, at any numeric suffix. */
export function archived(folder: string, rel: string): string | undefined {
	const dir = join(folder, '.archive', dirname(rel))
	const ext = extname(rel)
	const stem = basename(rel, ext)
	const name = new RegExp(`^${literal(stem)}(-\\d+)?${literal(ext)}$`)
	let entries: string[]
	try {
		entries = readdirSync(dir)
	} catch {
		return undefined
	}
	return [basename(rel), ...entries.filter((e) => name.test(e))]
		.map((e) => join(dir, e))
		.find((path) => statSync(path, { throwIfNoEntry: false })?.isFile())
}

const isTaskName = (name: string) => name !== 'README.md' && !name.startsWith('.')

/** The task files in `dir` other than README.md and dot entries; none if it cannot be read. */
function files(dir: string): string[] {
	try {
		return readdirSync(dir, { withFileTypes: true })
			.filter((e) => !e.isDirectory() && isTaskName(e.name))
			.map((e) => e.name)
	} catch {
		return []
	}
}

/** `name` in `dir` stands for each of `names`; guessing would act on the wrong task. */
const ambiguous = (dir: string, name: string, names: string[]) =>
	new Error(
		`${join(dir, name)} names ${names.length} files, ${names.join(', ')}, so which task is meant is unclear: ` +
			`name one with its extension, e.g. ${join(dir, names[0] ?? '')}`
	)

/**
 * The file in `dir` that `name` names: the entry itself, else the one task file whose stem it
 * is. More than one such file is refused, naming them, since guessing would act on the wrong task.
 */
function named(dir: string, name: string): string | undefined {
	const exact = join(dir, name)
	if (lstatSync(exact, { throwIfNoEntry: false })?.isDirectory() === false) return exact
	const entries = files(dir).filter((e) => e.replace(/(.)\.[^.]*$/, '$1') === name)
	if (entries.length > 1) throw ambiguous(dir, name, entries)
	return entries[0] && join(dir, entries[0])
}

/** The task at `rel`, relative to the folder: live, else archived; a path into `.archive/` looks only there. */
function lookup(folder: string, rel: string): string | undefined {
	const inArchive = rel.startsWith('.archive/')
	const name = inArchive ? rel.slice('.archive/'.length) : rel
	if (!name.split('/').every(isTaskName)) return undefined
	if (!inArchive) {
		const live = named(join(folder, dirname(name)), basename(name))
		if (live) return live
	}
	const found = archived(folder, name)
	if (found) return found
	// without its extension: the one extension archived under that name, at any numeric suffix
	const dir = join(folder, '.archive', dirname(name))
	const base = basename(name)
	const stem = new RegExp(`^${literal(base)}(?:-\\d+)?(\\.[^.]+)$`)
	const exts = [...new Set(files(dir).flatMap((e) => stem.exec(e)?.[1] ?? []))]
	if (exts.length > 1)
		throw ambiguous(
			dir,
			base,
			exts.map((ext) => base + ext)
		)
	return exts[0] && archived(folder, name + exts[0])
}

/**
 * Where `arg` leads in the task folder, relative to it: read as a path absolute, from `cwd`,
 * from `root` and from the folder, in that order, keeping each reading that is in the folder.
 */
export function inFolder(root: string, folder: string, cwd: string, arg: string): string[] {
	return [...new Set([resolve(cwd, arg), resolve(root, arg), resolve(folder, arg)])]
		.map((target) => relative(folder, join(real(dirname(target)), basename(target))))
		.filter((rel) => rel && rel !== '..' && !rel.startsWith('../') && !isAbsolute(rel))
}

/** `arg` reaches no path in the task folder `folder`, so it can name no task. */
export const outside = (root: string, folder: string, arg: string) =>
	new Error(
		`${arg} is not in the task folder ${folder}, nor its .archive/, so it is no task: ` +
			`name a file there, absolute, or from here, the root ${root} or the folder. Run \`ken task list\` to see the tasks.`
	)

/**
 * The absolute path of the task `arg` names, live or archived: any path that reaches the
 * file, absolute, from `cwd`, from `root` or from the folder, with or without its extension.
 * The file must be in `configured`, the task folder, or its `.archive/`; anything else is
 * refused, naming it.
 */
export function resolveTask(root: string, configured: string, cwd: string, arg: string): string {
	const folder = real(configured)
	const rels = inFolder(root, folder, cwd, arg)
	if (!rels.length) throw outside(root, folder, arg)
	for (const rel of rels) {
		const found = lookup(folder, rel)
		if (found) return found
	}
	throw new Error(
		`No task ${arg} in ${folder} or its .archive/, read as a path from here, from the root ${root} and from the folder, ` +
			'with or without its extension. Run `ken task list` to see the tasks.'
	)
}

/**
 * The task file `file`, then the README.md of each folder from its own up to `root`, root
 * last, the missing ones skipped. An archived task reads the chain of the folder it was
 * archived from, whose README.md holds its conventions; a task folder outside the root goes
 * up to the folder, then the root.
 */
export function readmeChain(root: string, configured: string, file: string): string[] {
	const folder = real(configured)
	const top = real(root)
	const rel = relative(folder, dirname(file)).replace(/^\.archive(\/|$)/, '')
	const up = (from: string, to: string) => {
		const dirs = [from]
		for (let dir = from; dir !== to && dir !== dirname(dir); dir = dirname(dir))
			dirs.push(dirname(dir))
		return dirs
	}
	const fromTop = relative(top, folder)
	const inRoot = fromTop !== '..' && !fromTop.startsWith('../')
	const dirs = inRoot ? up(join(folder, rel), top) : [...up(join(folder, rel), folder), top]
	const readmes = dirs
		.map((dir) => join(dir, 'README.md'))
		.filter((path) => statSync(path, { throwIfNoEntry: false })?.isFile())
	return [file, ...readmes]
}
