import { readFileSync } from 'node:fs'
import { basename, isAbsolute, relative } from 'node:path'
import { branchOf, git, repos } from './git.ts'
import { readTask } from './read.ts'
import { real, resolveTask } from './resolve.ts'

/** Run `git` in `clone`; its refusal passes through, with `next` after it. */
function pass(clone: string, args: string[], next: string): void {
	try {
		git(clone, ...args)
	} catch (e) {
		throw new Error(`${(e as Error).message}\n${next}`)
	}
}

/**
 * `ken task finish`: remove the worktree, then the branch, of the closed task `arg` names,
 * in the clone `ken path code` prints, and say what was removed. Its status is all that
 * counts; git's own refusals pass through, with the `--force` form to run by hand.
 */
export function finishTask(root: string, folder: string, cwd: string, arg: string): string {
	const path = resolveTask(root, folder, cwd, arg)
	const { fields, problems } = readTask(basename(path), readFileSync(path, 'utf8'))
	if (problems.length || (fields.status !== 'done' && fields.status !== 'wontfix')) {
		throw new Error(
			`${path} is open (${problems.length ? 'it could not be fully read' : `status ${fields.status ?? 'todo'}`}), ` +
				'and ken task finish removes the worktree and branch of a done or wontfix task only, so work in progress is never thrown away. ' +
				`Once it has landed, run \`ken task set ${path} status done\`, then \`ken task finish ${path}\`.`
		)
	}
	if (!fields.repo) return `${path} has no repo, so it has no branch or worktree to remove.`
	const repo = repos()(fields.repo)
	const name = branchOf(real(folder), path)
	if (!repo?.exists(name)) {
		return `${path} has no branch ${name} in ${fields.repo} on this machine, so there is nothing to remove.`
	}
	const { clone } = repo
	const worktree = repo.worktree(name)
	const rerun = `then rerun \`ken task finish ${path}\``
	if (worktree) {
		const rel = relative(real(worktree), real(cwd))
		if (rel !== '..' && !rel.startsWith('../') && !isAbsolute(rel)) {
			throw new Error(
				`You are in ${worktree}, the worktree ken task finish would remove from under you: \`cd ${clone}\`, ${rerun}.`
			)
		}
		pass(
			clone,
			['worktree', 'remove', worktree],
			`Commit or discard what git names; to throw it away, \`git -C ${clone} worktree remove --force ${worktree}\`; ${rerun}.`
		)
	}
	pass(
		clone,
		['branch', '-d', name],
		`Its commits are not on the default branch: land them, or, if they are to go (a squash merge, a wontfix), \`git -C ${clone} branch -D ${name}\`.`
	)
	return `Finished ${path}: removed ${worktree ? `its worktree ${worktree} and ` : ''}its branch ${name} of ${fields.repo}.`
}
