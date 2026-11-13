// git, the core's one dependency beyond the runtime (PRD 20).
import { spawnSync } from 'node:child_process'
import { die } from './die.ts'

/** `git -C <cwd> <args>`: whether it succeeded, its stdout without the last newline, its stderr. */
export const git = (cwd: string, ...args: string[]) => {
	const r = spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8' })
	return { ok: r.status === 0, out: (r.stdout ?? '').replace(/\n$/, ''), err: r.stderr ?? '' }
}

/** Stop unless git 2.48 or newer is on PATH, for worktree.useRelativePaths; `again` is the
 * command to rerun. */
export const checkGit = (again: string) => {
	const r = spawnSync('git', ['--version'], { encoding: 'utf8' })
	if (r.status !== 0)
		die(
			'git is not on PATH, and ken get clones with it. Install git 2.48 or newer',
			`(e.g. \`brew install git\`), then run \`${again}\` again.`
		)
	const version = r.stdout.trim()
	const [major = 0, minor = 0] = (/(\d+)\.(\d+)/.exec(version) ?? []).slice(1).map(Number)
	if (major < 2 || (major === 2 && minor < 48))
		die(
			`${version} is too old: ken needs git 2.48 or newer, for worktree.useRelativePaths, which lets`,
			'a whole <owner>/ folder, or the root, move. Install it (e.g. `brew install git`), check',
			`\`git --version\`, then run \`${again}\` again.`
		)
}

/** Block for `ms` milliseconds: ken is synchronous, and a wait on another ken is rare. */
export const sleep = (ms: number) =>
	Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)

/** Whether the process `pid` is running. */
export const alive = (pid: number) => {
	try {
		process.kill(pid, 0)
		return true
	} catch (e) {
		return (e as NodeJS.ErrnoException).code === 'EPERM'
	}
}
