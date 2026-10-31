import { spawnSync } from 'node:child_process'
import { redact } from './key.ts'

/** Run git in `cwd`: the one place ken calls git. Returns stdout, trimmed; throws with git's stderr. */
export function git(cwd: string, ...args: string[]): string {
	return gitWith(process.env, cwd, ...args)
}

/** `git`, run with the environment `env`. */
export function gitWith(env: NodeJS.ProcessEnv, cwd: string, ...args: string[]): string {
	const r = spawnSync('git', args, { cwd, encoding: 'utf8', env })
	if (r.error) {
		throw new Error(
			`ken runs git, which failed to start: ${r.error.message}. Install git, then retry.`
		)
	}
	if (r.status !== 0) {
		throw new Error(
			`\`git ${redact(args.join(' '))}\` failed in ${cwd}: ${redact(r.stderr.trim())}`
		)
	}
	return r.stdout.trim()
}

/** The oldest git with `worktree.useRelativePaths`, which lets an owner folder move with `mv`. */
const MIN_GIT = [2, 48] as const

/** Throw unless `version`, as `git --version` prints it, is new enough for the layout. */
export function requireGit(version: string): void {
	const [major = 0, minor = 0] = (/(\d+)\.(\d+)/.exec(version) ?? []).slice(1).map(Number)
	const [needMajor, needMinor] = MIN_GIT
	if (major > needMajor || (major === needMajor && minor >= needMinor)) return
	throw new Error(
		`${version.trim() || 'this git'} is too old: ken needs git ${needMajor}.${needMinor} or newer, ` +
			'for worktree.useRelativePaths, which keeps worktrees working when their owner folder moves. ' +
			'Install a newer git (e.g. `brew install git`), check `git --version`, then rerun.'
	)
}
