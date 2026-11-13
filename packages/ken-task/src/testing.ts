// Shared by the tests: `ken task` run through `ken` dispatch, against temp roots, under either
// kernel: the old one, the sh script at the repo's root, which finds ken-task on PATH, or the
// new one, packages/ken, which bundles it.
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { localDate } from './list.ts'

export const dir = realpathSync.native(mkdtempSync(join(tmpdir(), 'ken-task-')))

export type Kernel = 'old' | 'new'
/** Both kernels, for the suites that touch a checkout, until the old one is removed. */
export const KERNELS: Kernel[] = ['old', 'new']

// `ken`, and for the old kernel `ken-task`, on PATH as a user installs them, so `ken task` goes
// through dispatch
const repo = join(import.meta.dirname, '../../..')
for (const kernel of KERNELS) mkdirSync(join(dir, 'bin', kernel), { recursive: true })
symlinkSync(join(repo, 'ken'), join(dir, 'bin/old/ken'))
symlinkSync(join(import.meta.dirname, 'cli.ts'), join(dir, 'bin/old/ken-task'))
writeFileSync(
	join(dir, 'bin/new/ken'),
	`#!/bin/sh\nexec '${process.execPath}' '${join(repo, 'packages/ken/src/cli.ts')}' "$@"\n`,
	{ mode: 0o755 }
)

/** The tests' `ken`, `ken task` and roots under `kernel`; the checkouts of a root are where that
 * kernel puts them, never the user's ~/src. */
export function harness(kernel: Kernel) {
	/** The environment for the root `root`; the old kernel's checkouts in `<root>.src` beside it. */
	const env = (root: string) => ({
		...process.env,
		KEN_ROOT: root,
		KEN_SRC: `${root}.src`,
		PATH: `${join(dir, 'bin', kernel)}:${dirname(process.execPath)}:${process.env.PATH}`
	})

	/** `ken <args>` in the root `root`, run from `cwd`, with `extra` in its environment. */
	const ken = (root: string, args: string[], cwd = root, extra: NodeJS.ProcessEnv = {}) => {
		const r = spawnSync('ken', args, { cwd, encoding: 'utf8', env: { ...env(root), ...extra } })
		return { status: r.status, stdout: r.stdout, stderr: r.stderr }
	}

	/** `ken get <key> <args>` in the root `root`; https://example.com/ clones from `dir/remotes/`. */
	const kenGet = (root: string, key: string, ...args: string[]): string => {
		const r = ken(root, ['get', key, ...args], root, {
			GIT_CONFIG_COUNT: '1',
			GIT_CONFIG_KEY_0: `url.file://${dir}/remotes/.insteadOf`,
			GIT_CONFIG_VALUE_0: 'https://example.com/'
		})
		if (r.status !== 0) throw new Error(r.stderr)
		return r.stdout.trim()
	}

	/** Where the clone of `key` goes in the root `root`, as `ken path code` prints it. */
	const clonePath = (root: string, key: string) => ken(root, ['path', 'code', key]).stdout.trim()

	/** `ken task <args>` in the root `root`, run from `cwd`. */
	const kenTask = (root: string, args: string[], cwd = root) => ken(root, ['task', ...args], cwd)

	/** A root holding `.ken`, its settings `settings`, as `key=value` lines, as the kernel's
	 * `ken init` leaves one: the new kernel's with its format and `.repos/` ignored. */
	const newRoot = (settings = '') => {
		const root = mkdtempSync(join(dir, 'root-'))
		if (kernel === 'old') writeFileSync(join(root, '.ken'), settings)
		else {
			writeFileSync(join(root, '.ken'), `ken.format=1\n${settings}`)
			writeFileSync(join(root, '.gitignore'), '.repos/\n')
		}
		return root
	}

	return { env, kenGet, clonePath, kenTask, newRoot }
}

/** The new kernel's, for the suites that touch no checkout. */
export const { env, kenTask, newRoot } = harness('new')

export const write = (file: string, text: string | Buffer) => {
	mkdirSync(dirname(file), { recursive: true })
	writeFileSync(file, text)
}

/** Today shifted by `offset` days, as `YYYY-MM-DD`. */
export const day = (offset: number) => localDate(new Date(Date.now() + offset * 864e5))
