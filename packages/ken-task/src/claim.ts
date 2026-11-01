import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { branchOf, codePath, git } from './git.ts'
import { listTasks, type Row, readyTasks } from './list.ts'
import { real, resolveTask } from './resolve.ts'

/**
 * `ken task claim [<task>]`: give the task `arg` names, or without it the first ready repo
 * task whose repo is cloned here, its branch and worktree, and return the worktree. The
 * branch is made first: git's ref lock on it is the claim, so of two callers only one wins;
 * without a task, the loser goes on to the next.
 */
export function claimTask(
	root: string,
	configured: string,
	cwd: string,
	arg: string | undefined,
	today: string
): string {
	const folder = real(configured)
	if (arg === undefined) {
		for (const row of readyTasks(root, configured, today)) {
			if (!row.repo || !existsSync(codePath(row.repo))) continue
			const worktree = claim(row.repo, branchOf(folder, row.path))
			if (worktree) return worktree
		}
		throw new Error(
			'No ready task with a repo cloned here is left to claim. ' +
				'Run `ken task list` to see what each task waits on; a ready task with no repo takes `ken task set <task> repo <key>`, one whose repo is not here `ken get <key>`.'
		)
	}
	const path = resolveTask(root, configured, cwd, arg)
	const row = listTasks(root, configured, today).find((r) => r.path === path)
	const name = branchOf(folder, path)
	const key = requireClaimable(path, name, row)
	const worktree = claim(key, name)
	if (worktree) return worktree
	throw new Error(
		`${path} was claimed by another caller first: its branch ${name} now exists in ${key}. ` +
			'Run `ken task claim` for the next ready task.'
	)
}

/** The repo key of the task at `path`, listed as `row`, or a throw saying why it cannot be claimed. */
function requireClaimable(path: string, name: string, row: Row | undefined): string {
	const next = 'Run `ken task claim` for the next ready task, or `ken task list` to see each state.'
	if (!row)
		throw new Error(`${path} is archived, so it is closed and there is nothing to claim. ${next}`)
	const { state, repo } = row
	if (state === 'claimed' && repo) {
		throw new Error(
			`${path} is claimed: its branch ${name} exists in ${repo}. ` +
				`Work in its worktree, \`cd "$(ken get ${repo} -b ${name})"\`, or run \`ken task claim\` for the next ready task.`
		)
	}
	if (state !== 'ready') {
		const why =
			state === 'blocked'
				? `, waiting on ${row.unmet.map((u) => `${u.ref} (${u.reason})`).join(', ')}`
				: state === 'later'
					? `, scheduled for ${row.scheduled}`
					: state === 'problem'
						? `: ${row.notes.join('; ')}`
						: ''
		throw new Error(`${path} is ${state}${why}, and only a ready task can be claimed. ${next}`)
	}
	if (!repo) {
		throw new Error(
			`${path} has no repo, so there is no clone to make its branch in. ` +
				`Run \`ken task set ${path} repo <host>/<owner>/<repo>\`, then \`ken task claim ${path}\`.`
		)
	}
	const clone = codePath(repo)
	if (!existsSync(clone)) {
		throw new Error(
			`${repo} is not cloned here (${clone}), so there is no clone to make the branch of ${path} in. ` +
				`Run \`ken get ${repo}\`, then \`ken task claim ${path}\`.`
		)
	}
	return repo
}

/**
 * Make branch `name` in the clone of `key` from its default branch as it stands, no fetch,
 * then its worktree with `ken get -b`, and return the worktree; undefined when the branch
 * exists already, which means another caller won it.
 */
function claim(key: string, name: string): string | undefined {
	const clone = codePath(key)
	let main: string
	try {
		main = git(clone, 'symbolic-ref', '-q', 'HEAD')
	} catch {
		throw new Error(
			`${clone} has a detached HEAD, so its default branch, the one the clone holds, is unknown and there is nothing to branch ${name} from. ` +
				`Check it out there, e.g. \`git -C ${clone} switch main\`, then rerun.`
		)
	}
	try {
		// the full ref name: the short one turns ambiguous once a tag of the same name exists
		git(clone, 'branch', name, main)
	} catch (e) {
		if (git(clone, 'branch', '--list', name)) return undefined
		throw new Error(`could not create branch ${name} in ${clone}: ${(e as Error).message}`)
	}
	const get = `ken get ${key} -b ${name}`
	const r = spawnSync('ken', ['get', key, '-b', name], {
		encoding: 'utf8',
		stdio: ['inherit', 'pipe', 'inherit']
	})
	if (r.status !== 0) {
		throw new Error(
			`branch ${name} is made in ${clone}, so the task is claimed, but its worktree is not ready` +
				`${r.error ? `: ken could not be run (${r.error.message})` : ''}. ` +
				`Finish by hand as said above, or fix the cause and run \`${get}\`, which prints the worktree.`
		)
	}
	return r.stdout.trim()
}
