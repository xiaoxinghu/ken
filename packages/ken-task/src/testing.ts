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
symlinkSync(join(import.meta.dirname, '../../ken/src/cli.ts'), join(bin, 'ken'))
symlinkSync(join(import.meta.dirname, 'cli.ts'), join(bin, 'ken-task'))

/** `ken task <args>` in the root `root`, run from `cwd`. */
export const kenTask = (root: string, args: string[], cwd = root) => {
	const r = spawnSync(
		process.execPath,
		[join(import.meta.dirname, '../../ken/src/cli.ts'), 'task', ...args],
		{
			cwd,
			encoding: 'utf8',
			env: {
				...process.env,
				KEN_ROOT: root,
				PATH: `${bin}:${dirname(process.execPath)}:${process.env.PATH}`
			}
		}
	)
	return { status: r.status, stdout: r.stdout, stderr: r.stderr }
}

export const write = (file: string, text: string) => {
	mkdirSync(dirname(file), { recursive: true })
	writeFileSync(file, text)
}

export const newRoot = (kenYaml = '') => {
	const root = mkdtempSync(join(dir, 'root-'))
	writeFileSync(join(root, '.ken.yaml'), kenYaml)
	return root
}

/** Today shifted by `offset` days, as `YYYY-MM-DD`. */
export const day = (offset: number) => localDate(new Date(Date.now() + offset * 864e5))
