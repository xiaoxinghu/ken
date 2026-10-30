import { spawnSync } from 'node:child_process'

/** Run git in `cwd`: the one place ken calls git. Returns stdout, trimmed; throws with git's stderr. */
export function git(cwd: string, ...args: string[]): string {
	const r = spawnSync('git', args, { cwd, encoding: 'utf8' })
	if (r.error) {
		throw new Error(
			`ken runs git, which failed to start: ${r.error.message}. Install git, then retry.`
		)
	}
	if (r.status !== 0) {
		throw new Error(`\`git ${args.join(' ')}\` failed in ${cwd}: ${r.stderr.trim()}`)
	}
	return r.stdout.trim()
}
