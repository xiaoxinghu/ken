import {
	lstatSync,
	mkdirSync,
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
	const text = readFileSync(source, 'utf8')
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
	const tasks = new Set(walk(folder))
	const moves = dirname(dest) !== dirname(source)
	const writes = new Map<string, string>()
	for (const path of tasks) {
		const own = path === source
		let before: string
		try {
			before = own ? text : statSync(path).isFile() ? readFileSync(path, 'utf8') : ''
		} catch {
			// unreadable, so it names no task; the listing shows it as a problem
			continue
		}
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
		writes.set(own ? dest : realpathSync(path), next)
	}

	mkdirSync(dirname(dest), { recursive: true })
	try {
		writeFileSync(dest, writes.get(dest) ?? text, { flag: 'wx', mode: stat.mode & 0o777 })
	} catch (e) {
		if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e
		throw new Error(
			`${dest} exists, made since this rename looked: read it with \`cat ${dest}\`, or run \`ken task rename ${source} <another path>\`.`
		)
	}
	// a move keeps the file's age, which counts from its mtime when nothing else dates it
	utimesSync(dest, stat.atime, stat.mtime)
	try {
		for (const [file, next] of writes) if (file !== dest) replaceFile(file, next)
		unlinkSync(source)
	} catch (e) {
		throw new Error(
			`${(e as Error).message}; ${source} and ${dest} both exist now, each reference resolving to one of them: ` +
				`\`rm ${dest}\`, fix what failed, then rerun \`ken task rename ${source} ${to}\``
		)
	}
	return target
}
