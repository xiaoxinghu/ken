// The one place ken-task meets a repo's git: the git CLI, run in the clone `ken path code` prints.
import { spawnSync } from 'node:child_process'
import { join, relative } from 'node:path'
import { real } from './resolve.ts'

/** Run `command` with `args` in `cwd`; its stdout, trimmed, or a throw with what it said. */
function run(command: string, args: string[], cwd?: string): string {
	const r = spawnSync(command, args, { cwd, encoding: 'utf8' })
	if (r.error) {
		throw new Error(
			`ken-task runs ${command}, which could not be started: ${r.error.message}. Install it so it is on PATH, then rerun`
		)
	}
	if (r.status !== 0) throw new Error(`\`${command} ${args.join(' ')}\` failed: ${r.stderr.trim()}`)
	return r.stdout.trim()
}

/** `git <args>` in `cwd`. */
export const git = (cwd: string, ...args: string[]): string => run('git', args, cwd)

/** What `ken path code <key> [<branch>]` prints: the clone, or the worktree of `branch` beside it. */
export const codePath = (key: string, branch?: string): string =>
	run('ken', ['path', 'code', key, ...(branch === undefined ? [] : [branch])])

/**
 * Whether `path` is a clone: git, asked there, finds its own `.git` folder. A plain folder
 * inside the root's own repo would otherwise send every git command to that repo.
 */
export function isClone(path: string): boolean {
	const r = spawnSync('git', ['rev-parse', '--absolute-git-dir'], { cwd: path, encoding: 'utf8' })
	return r.status === 0 && real(r.stdout.trim()) === real(join(path, '.git'))
}

/** A clone, asked about branch `<name>`, the task's path in the folder without extension. */
export type Repo = {
	key: string
	clone: string
	/** Whether branch `name` exists. */
	exists(name: string): boolean
	/** Whether branch `name` is an ancestor of the default branch, the one the clone holds. */
	landed(name: string): boolean
	/** The worktree that has branch `name` checked out, as git lists it. */
	worktree(name: string): string | undefined
	/** The branch checked out in the worktree at `path`, if git lists one there. */
	holds(path: string): string | undefined
}

/**
 * The repo of each key, each asked of git once per run, its answers as of then: one
 * `for-each-ref` for its branches, one for those on the default branch and one `worktree
 * list`, each the first time it is needed. A key whose clone is not on this machine has no
 * repo, so its tasks have no branch; that is said once on stderr, unless `quiet`.
 */
export function repos(quiet = false): (key: string) => Repo | undefined {
	const seen = new Map<string, Repo | undefined>()
	return (key) => {
		if (!seen.has(key)) seen.set(key, open(key, quiet))
		return seen.get(key)
	}
}

function open(key: string, quiet: boolean): Repo | undefined {
	const clone = codePath(key)
	if (!isClone(clone)) {
		if (quiet) return undefined
		process.stderr.write(
			`${key} is not cloned on this machine (${clone}), so ken-task sees no branch of it: its tasks show the state their status gives. ` +
				`Run \`ken get ${key}\` to clone it, or to be told what is in its place.\n`
		)
		return undefined
	}
	const lazy = <T>(read: () => T) => {
		let value: T | undefined
		return () => {
			value ??= read()
			return value
		}
	}
	const heads = (...args: string[]) =>
		new Set(
			git(clone, 'for-each-ref', '--format=%(refname:lstrip=2)', ...args, 'refs/heads/')
				.split('\n')
				.filter(Boolean)
		)
	const branches = lazy(() => heads())
	const merged = lazy(() => heads('--merged=HEAD'))
	// path -> branch, NUL-separated, since a path may hold a newline
	const worktrees = lazy(() => {
		const found = new Map<string, string | undefined>()
		let path = ''
		for (const line of git(clone, 'worktree', 'list', '--porcelain', '-z').split('\0')) {
			if (line.startsWith('worktree ')) {
				path = line.slice(9)
				found.set(path, undefined)
			} else if (line.startsWith('branch refs/heads/')) found.set(path, line.slice(18))
		}
		return found
	})
	return {
		key,
		clone,
		exists: (name) => branches().has(name),
		landed: (name) => merged().has(name),
		worktree: (name) => [...worktrees()].find(([, branch]) => branch === name)?.[0],
		holds: (path) => worktrees().get(path)
	}
}

/** The branch of the task at `path` in `folder`, a real path: its path there without extension. */
export const branchOf = (folder: string, path: string): string =>
	relative(folder, path).replace(/(.)\.[^./]*$/, '$1')

/** Whether the worktree at `path` has uncommitted changes, untracked files included. */
export const dirty = (path: string): boolean => git(path, 'status', '--porcelain') !== ''
