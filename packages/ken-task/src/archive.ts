import {
	lstatSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	renameSync,
	rmSync,
	statSync
} from 'node:fs'
import { basename, dirname, extname, join, relative } from 'node:path'
import { branchOf, git, repos } from './git.ts'
import { localDate } from './list.ts'
import { readTask } from './read.ts'
import { real, resolveTask } from './resolve.ts'

/**
 * `ken task archive`: move each task `args` name to `.archive/<its path in the folder>`,
 * after every one is checked: closed, not already archived, and with no branch left on this
 * machine. A name already archived keeps its file; the new one takes the first free numeric
 * suffix before its extension, which `renamed` says. Only the named files are touched:
 * a reference still resolves, through the archive.
 */
export function archiveTasks(
	root: string,
	configured: string,
	cwd: string,
	args: string[]
): { path: string; renamed?: string }[] {
	const folder = real(configured)
	const archive = join(folder, '.archive')
	const repo = repos()
	const paths = [...new Set(args.map((arg) => resolveTask(root, configured, cwd, arg)))]
	for (const path of paths) {
		if (path.startsWith(`${archive}/`)) {
			throw new Error(
				`${path} is already in the archive, so nothing is moved. Run \`ken task list\` for the live tasks; to bring it back, \`mv\` it to its path in ${folder}.`
			)
		}
		const { fields, problems } = readTask(basename(path), readFileSync(path, 'utf8'))
		if (problems.length || (fields.status !== 'done' && fields.status !== 'wontfix')) {
			throw new Error(
				`${path} is open (${problems.length ? 'it could not be fully read' : `status ${fields.status}`}), ` +
					'and the archive holds closed tasks only: an archived task blocks nothing, so archiving open work would make its dependents ready. ' +
					`If it is finished, run \`ken task set ${path} status done\`, then rerun. Nothing was moved.`
			)
		}
		const name = branchOf(folder, path)
		if (fields.repo && repo(fields.repo)?.exists(name)) {
			throw new Error(
				`${path} still has its branch ${name} in ${fields.repo}, and an archived task's branch would be left behind with nothing listing it. ` +
					`Run \`ken task finish ${path}\` to remove its worktree and branch, then rerun. Nothing was moved.`
			)
		}
	}
	return paths.map((path) => {
		const rel = relative(folder, path)
		const ext = extname(rel)
		let target = join(archive, rel)
		for (let n = 2; lstatSync(target, { throwIfNoEntry: false }); n++) {
			target = join(archive, dirname(rel), `${basename(rel, ext)}-${n}${ext}`)
		}
		mkdirSync(dirname(target), { recursive: true })
		renameSync(path, target)
		const renamed =
			target === join(archive, rel)
				? undefined
				: `${join(archive, rel)} was already archived, so ${path} is archived as ${target}; a reference to ${rel} still resolves to one of them.`
		return { path: target, renamed }
	})
}

/** Every regular file under `dir`, at any depth; none if it cannot be read. */
function files(dir: string): string[] {
	try {
		return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
			e.isDirectory() ? files(join(dir, e.name)) : e.isFile() ? [join(dir, e.name)] : []
		)
	} catch {
		return []
	}
}

/**
 * `ken task purge`: delete each file in the archive whose `closed`, else its mtime, is
 * before `today` less `days`, and say whether the folder is in a git work tree, which then
 * holds what was committed of them; else nothing does.
 */
export function purgeArchive(
	configured: string,
	days: number,
	today: Date
): { deleted: string[]; said: string } {
	const folder = real(configured)
	const archive = join(folder, '.archive')
	const cutoff = localDate(new Date(today.getTime() - days * 864e5))
	const deleted = files(archive).filter((path) => {
		let closed: string | undefined
		try {
			closed = readTask(basename(path), readFileSync(path, 'utf8')).fields.closed
		} catch {}
		return (closed ?? localDate(statSync(path).mtime)) < cutoff
	})
	for (const path of deleted) rmSync(path)
	if (!deleted.length) {
		return {
			deleted,
			said: `Nothing in ${archive} was closed, else last modified, before ${cutoff}, so nothing was deleted.`
		}
	}
	let top: string | undefined
	try {
		top = git(folder, 'rev-parse', '--show-toplevel')
	} catch {}
	const what = `Deleted ${deleted.length} archived task${deleted.length > 1 ? 's' : ''} closed, else last modified, before ${cutoff}.`
	return {
		deleted,
		said: top
			? `${what} ${folder} is in the git work tree ${top}, so its history holds what was committed of them: ` +
				`\`git -C ${top} log --oneline -- ${archive}\` lists those commits, and \`git -C ${top} add -A ${archive}\` stages the deletion to commit.`
			: `${what} ${folder} is in no git work tree, so nothing else holds a copy: they are gone.`
	}
}
