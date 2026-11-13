// Shared by the tests: `ken task` run through `ken` dispatch, packages/ken, which bundles it,
// against temp roots.
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { localDate } from './list.ts'

export const dir = realpathSync.native(mkdtempSync(join(tmpdir(), 'ken-task-')))

// `ken` on PATH as a user installs it, so `ken task` goes through dispatch
const repo = join(import.meta.dirname, '../../..')
mkdirSync(join(dir, 'bin'))
writeFileSync(
	join(dir, 'bin/ken'),
	`#!/bin/sh\nexec '${process.execPath}' '${join(repo, 'packages/ken/src/cli.ts')}' "$@"\n`,
	{ mode: 0o755 }
)

/** The environment for the root `root`. */
export const env = (root: string) => ({
	...process.env,
	KEN_ROOT: root,
	PATH: `${join(dir, 'bin')}:${dirname(process.execPath)}:${process.env.PATH}`
})

/** `ken <args>` in the root `root`, run from `cwd`, with `extra` in its environment. */
const ken = (root: string, args: string[], cwd = root, extra: NodeJS.ProcessEnv = {}) => {
	const r = spawnSync('ken', args, { cwd, encoding: 'utf8', env: { ...env(root), ...extra } })
	return { status: r.status, stdout: r.stdout, stderr: r.stderr }
}

/** `ken get <key> <args>` in the root `root`; https://example.com/ clones from `dir/remotes/`. */
export const kenGet = (root: string, key: string, ...args: string[]): string => {
	const r = ken(root, ['get', key, ...args], root, {
		GIT_CONFIG_COUNT: '1',
		GIT_CONFIG_KEY_0: `url.file://${dir}/remotes/.insteadOf`,
		GIT_CONFIG_VALUE_0: 'https://example.com/'
	})
	if (r.status !== 0) throw new Error(r.stderr)
	return r.stdout.trim()
}

/** Where the clone of `key` goes in the root `root`, as `ken path code` prints it. */
export const clonePath = (root: string, key: string) =>
	ken(root, ['path', 'code', key]).stdout.trim()

/** `ken task <args>` in the root `root`, run from `cwd`. */
export const kenTask = (root: string, args: string[], cwd = root) =>
	ken(root, ['task', ...args], cwd)

/** A root holding `.ken`, its settings `settings`, as `key=value` lines, as `ken init` leaves
 * one: with its format and `.repos/` ignored. */
export const newRoot = (settings = '') => {
	const root = mkdtempSync(join(dir, 'root-'))
	writeFileSync(join(root, '.ken'), `ken.format=1\n${settings}`)
	writeFileSync(join(root, '.gitignore'), '.repos/\n')
	return root
}

export const write = (file: string, text: string | Buffer) => {
	mkdirSync(dirname(file), { recursive: true })
	writeFileSync(file, text)
}

/** Today shifted by `offset` days, as `YYYY-MM-DD`. */
export const day = (offset: number) => localDate(new Date(Date.now() + offset * 864e5))
