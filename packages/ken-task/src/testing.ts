// Shared by the tests: `ken task` run through `ken` dispatch, against temp roots.
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { localDate } from './list.ts'

export const dir = realpathSync.native(mkdtempSync(join(tmpdir(), 'ken-task-')))

// `ken` and `ken-task` on PATH as a user installs them, so `ken task` goes through dispatch
const bin = join(dir, 'bin')
mkdirSync(bin)
symlinkSync(join(import.meta.dirname, '../../../ken'), join(bin, 'ken'))
symlinkSync(join(import.meta.dirname, 'cli.ts'), join(bin, 'ken-task'))

/** How the tests run `ken`: the script at the repo root under sh, and the environment for the root `root`. */
export const ken = join(import.meta.dirname, '../../../ken')
export const env = (root: string) => ({
	...process.env,
	KEN_ROOT: root,
	PATH: `${bin}:${dirname(process.execPath)}:${process.env.PATH}`
})

/** `ken get <key> <args>` in the root `root`; https://example.com/ clones from `dir/remotes/`. */
export const kenGet = (root: string, key: string, ...args: string[]): string => {
	const r = spawnSync('sh', [ken, 'get', key, ...args], {
		encoding: 'utf8',
		env: {
			...env(root),
			GIT_CONFIG_COUNT: '1',
			GIT_CONFIG_KEY_0: `url.file://${dir}/remotes/.insteadOf`,
			GIT_CONFIG_VALUE_0: 'https://example.com/'
		}
	})
	if (r.status !== 0) throw new Error(r.stderr)
	return r.stdout.trim()
}

/** `ken task <args>` in the root `root`, run from `cwd`. */
export const kenTask = (root: string, args: string[], cwd = root) => {
	const r = spawnSync('sh', [ken, 'task', ...args], {
		cwd,
		encoding: 'utf8',
		env: env(root)
	})
	return { status: r.status, stdout: r.stdout, stderr: r.stderr }
}

export const write = (file: string, text: string | Buffer) => {
	mkdirSync(dirname(file), { recursive: true })
	writeFileSync(file, text)
}

/** A root holding `.ken`, its settings `settings`, as `key=value` lines. */
export const newRoot = (settings = '') => {
	const root = mkdtempSync(join(dir, 'root-'))
	writeFileSync(join(root, '.ken'), settings)
	return root
}

/** Today shifted by `offset` days, as `YYYY-MM-DD`. */
export const day = (offset: number) => localDate(new Date(Date.now() + offset * 864e5))
