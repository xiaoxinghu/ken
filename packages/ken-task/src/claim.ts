import { spawnSync } from 'node:child_process'
import { branchOf, codePath, git, isClone } from './git.ts'
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
			if (!row.repo || !isClone(codePath(row.repo))) continue
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
	if (!isClone(clone)) {
		throw new Error(
			`${repo} is not cloned here (${clone}), so there is no clone to make the branch of ${path} in. ` +
				`Run \`ken get ${repo}\`, which clones it or says what is in its place, then \`ken task claim ${path}\`.`
		)
	}
	return repo
}

/** `ken get <args>`, its stderr passed through: its stdout, or a throw saying what to do after it. */
function kenGet(args: string[], next: string): string {
	const r = spawnSync('ken', ['get', ...args], {
		encoding: 'utf8',
		stdio: ['inherit', 'pipe', 'inherit']
	})
	if (r.status !== 0) {
		throw new Error(`${r.error ? `ken could not be run (${r.error.message}): ` : ''}${next}`)
	}
	return r.stdout.trim()
}

/**
 * Make branch `name` in the clone of `key` from its default branch as it stands, no fetch,
 * then its worktree with `ken get -b`, and return the worktree; undefined when the branch
 * exists already, which means another caller won it. `ken get` checks the clone first, so a
 * clone it would refuse, such as a link to a repo elsewhere, gets no branch.
 */
function claim(key: string, name: string): string | undefined {
	const clone = kenGet(
		[key],
		`\`ken get ${key}\` refused the clone of ${key}, as said above, so no branch was made for ${name}. Fix what it names, then rerun.`
	)
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
	return kenGet(
		[key, '-b', name],
		`branch ${name} is made in ${clone}, so the task is claimed, but its worktree is not ready. ` +
			`Finish by hand as said above, or fix the cause and run \`ken get ${key} -b ${name}\`, which prints the worktree.`
	)
}
