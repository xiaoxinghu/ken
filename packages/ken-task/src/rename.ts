import {
	closeSync,
	lstatSync,
	mkdirSync,
	openSync,
	readFileSync,
	realpathSync,
	statSync,
	unlinkSync,
	utimesSync,
	writeFileSync
} from 'node:fs'
import { basename, dirname, relative, resolve } from 'node:path'
import { type Added, newPath } from './add.ts'
import { branchOf, repos } from './git.ts'
import { resolveRef, walk } from './list.ts'
import { readTask } from './read.ts'
import { real, resolveTask } from './resolve.ts'
import { flowList, replaceFile, withField } from './set.ts'

/**
 * `ken task rename`: move the live task `arg` names to `to`, a new path as `add` takes one,
 * and keep every reference true: each live task whose `blocked-by` resolves to it gets that
 * value rewritten relative to its own file, and the moved file's own `blocked-by` is
 * rewritten when its folder changes. Refused for a task whose branch exists, since the
 * branch carries the old name. Everything is checked first; then the new file is made, the
 * references rewritten, and the old file removed last, so at every step each reference
 * resolves to a file that exists.
 */
export function renameTask(
	root: string,
	configured: string,
	cwd: string,
	arg: string,
	to: string
): Added {
	const folder = real(configured)
	const found = resolveTask(root, folder, cwd, arg)
	if (relative(folder, found).startsWith('.archive/')) {
		throw new Error(
			`${found} is archived, and the archive is a permanent record that rename never touches: ` +
				`to work on it again, move it back with \`mv ${found} ${folder}/<path>\`, then \`ken task rename ${folder}/<path> ${to}\`.`
		)
	}
	const stat = lstatSync(found)
	if (!stat.isFile()) {
		throw new Error(
			`${found} is not a regular file, and rename moves the file itself: \`ls -ld ${found}\` shows what it is; move it by hand.`
		)
	}
	// as the disk names it, the way the listing names each task
	const source = real(found)
	// the bytes, so a file that is not UTF-8 moves unchanged when nothing in it is rewritten
	const sourceBytes = readFileSync(source)
	const text = sourceBytes.toString('utf8')
	const { fields, problems } = readTask(basename(source), text)
	if (problems.length) {
		throw new Error(
			`${source} could not be fully read, so its branch and blocked-by cannot be checked: ${problems.join('; ')}. Then rerun.`
		)
	}
	const target = newPath(root, folder, cwd, to, `ken task rename ${source}`)
	const dest = target.path
	const name = branchOf(folder, source)
	if (fields.repo && repos()(fields.repo)?.exists(name)) {
		throw new Error(
			`${source} has a branch, ${name} of ${fields.repo}, and a branch carries its task's name, so after a rename neither \`ken task list\` nor \`ken task finish\` would find it: ` +
				`close the task first, by landing it and \`ken task set ${source} status done\` (or \`status wontfix\`), then \`ken task finish ${source}\`; then rerun.`
		)
	}

	// the new text of each file whose blocked-by changes, the moved file's at its new path
	// sorted, so the files are written, and on a failure restored, in one order
	const tasks = new Set(walk(folder).sort())
	const moves = dirname(dest) !== dirname(source)
	const writes = new Map<string, [before: string, next: string]>()
	for (const path of tasks) {
		const own = path === source
		// a link's file is elsewhere, maybe in the archive, maybe the task itself: rename moves
		// and writes only files, so a link that would break or be written through is refused
		const link = own ? undefined : linkTo(path)
		if (link === source) {
			throw new Error(
				`${path} is a link to ${source}, so the rename would leave it pointing nowhere, along with every blocked-by that names it: ` +
					`remove it with \`rm ${path}\`, naming ${source} instead wherever it was named, then rerun.`
			)
		}
		let bytes: Buffer
		try {
			// walk lists a folder only when it cannot be read; a pipe or device is never read
			if (!own && lstatSync(path).isDirectory())
				throw new Error('it is a folder that cannot be read')
			if (!own && !statSync(path).isFile()) continue
			bytes = own ? sourceBytes : readFileSync(path)
		} catch (e) {
			// a link to nothing names no task
			if ((e as NodeJS.ErrnoException).code === 'ENOENT') continue
			throw new Error(
				`${path} cannot be read (${(e as Error).message}), so whether its blocked-by names ${source} is unknown, and renaming could leave that reference stale: ` +
					`make it readable, or move it out of the folder, then rerun; \`ls -ld ${path}\` shows it.`
			)
		}
		const before = bytes.toString('utf8')
		const read = readTask(basename(path), before)
		let changed = false
		const refs = read.fields['blocked-by'].map((ref) => {
			const hit = resolveRef(root, folder, tasks, path, ref)
			const named = hit?.live === source
			if (!named && !(own && moves)) return ref
			changed = true
			// a reference found nowhere keeps naming the path it named
			const at = named ? dest : (hit?.target ?? resolve(dirname(path), ref))
			return relative(dirname(own ? dest : path), at)
		})
		if (!changed) continue
		if (!Buffer.from(before).equals(bytes)) {
			throw new Error(
				`${path} is not UTF-8 text, so rewriting its blocked-by would change other bytes in it: ` +
					`convert it to UTF-8, e.g. with \`iconv\`, then rerun.`
			)
		}
		if (link) {
			throw new Error(
				`${path} names ${source} in blocked-by, but is a link to ${link}, and rename writes only the task files themselves: ` +
					`replace the link with its file, \`rm ${path} && cp ${link} ${path}\`, or take the task out of its blocked-by, then rerun.`
			)
		}
		if (read.problems.length) {
			throw new Error(
				`${path} names ${source} in blocked-by, but could not be fully read, so it cannot be rewritten: ${read.problems.join('; ')}. Then rerun.`
			)
		}
		const next = withField(before, 'blocked-by', flowList(refs))
		const back = readTask(basename(own ? dest : path), next)
		const same = (r: typeof read) => JSON.stringify({ ...r.fields, 'blocked-by': [] })
		if (
			back.problems.length ||
			same(back) !== same(read) ||
			JSON.stringify(back.fields['blocked-by']) !== JSON.stringify(refs)
		) {
			throw new Error(
				`blocked-by in ${path}, written as ${flowList(refs)}, would not read back as written, so nothing is renamed: ` +
					`write it as \`blocked-by: [<path>, ...]\` on one line by hand, then rerun`
			)
		}
		writes.set(own ? dest : path, [before, next])
	}

	mkdirSync(dirname(dest), { recursive: true })
	let fd: number
	try {
		fd = openSync(dest, 'wx', stat.mode & 0o777)
	} catch (e) {
		if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e
		throw new Error(
			`${dest} exists, made since this rename looked: read it with \`cat ${dest}\`, or run \`ken task rename ${source} <another path>\`.`
		)
	}
	// from here the new file is this rename's own, so a failure removes it
	const done: string[] = []
	try {
		try {
			writeFileSync(fd, writes.get(dest)?.[1] ?? sourceBytes)
		} finally {
			closeSync(fd)
		}
		// a move keeps the file's age, which counts from its mtime when nothing else dates it
		utimesSync(dest, stat.atime, stat.mtime)
		for (const [file, [, next]] of writes) {
			if (file === dest) continue
			replaceFile(file, next)
			done.push(file)
		}
		unlinkSync(source)
	} catch (e) {
		const failed = (e as Error).message
		// undone, so every reference names the old file again, which still exists
		try {
			for (const file of done) replaceFile(file, writes.get(file)?.[0] ?? '')
			unlinkSync(dest)
		} catch (undo) {
			throw new Error(
				`${failed}; undoing it failed too (${(undo as Error).message}), so ${source} and ${dest} both exist, each reference resolving to one of them: ` +
					`finish the move by hand, rewriting blocked-by to name ${dest} in ${[...writes.keys()].filter((f) => f !== dest).join(', ')} where it does not yet, then \`rm ${source}\`.`
			)
		}
		throw new Error(
			`${failed}; so nothing is renamed, every file as it was: fix what failed, then rerun \`ken task rename ${source} ${to}\`.`
		)
	}
	return target
}

/** The file the link at `path` leads to, as the disk names it; undefined for no link, or a link to nothing. */
function linkTo(path: string): string | undefined {
	try {
		return lstatSync(path).isSymbolicLink() ? realpathSync.native(path) : undefined
	} catch {
		return undefined
	}
}
