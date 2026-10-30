import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { COMMANDS } from './commands.ts'

let root: string

beforeAll(() => {
	root = join(realpathSync.native(mkdtempSync(join(tmpdir(), 'ken-cli-'))), 'ken')
	mkdirSync(root)
})

const run = (env: NodeJS.ProcessEnv, args: string[]) => {
	const r = spawnSync(process.execPath, [join(import.meta.dirname, 'cli.ts'), ...args], {
		encoding: 'utf8',
		env
	})
	return { status: r.status, stdout: r.stdout, stderr: r.stderr }
}
const ken = (...args: string[]) => run({ ...process.env, KEN_ROOT: root }, args)

describe('ken path', () => {
	it('prints the worktree folder of a key and branch, lowercase, / as -', () => {
		const r = ken('path', 'code', 'github.com/Acme/Join-Web', 'feat/login')
		expect(r).toMatchObject({ status: 0, stderr: '' })
		expect(r.stdout).toBe(`${root}/.repos/github.com/acme/join-web.feat-login\n`)
	})

	it('prints the clone of a URL, the repos and the bin folders', () => {
		expect(ken('path', 'code', 'git@github.com:acme/join-web.git').stdout).toBe(
			`${root}/.repos/github.com/acme/join-web\n`
		)
		expect(ken('path', 'repos').stdout).toBe(`${root}/.repos\n`)
		expect(ken('path', 'bin').stdout).toBe(`${root}/.bin\n`)
	})

	it.each(['https://user:s3cret@github.com/a/b.git', ' s3cret@github.com:owner/repo.git'])(
		'never shows the userinfo of %j given as the branch',
		(url) => {
			const r = ken('path', 'code', 'github.com/acme/repo', url)
			expect(r.status).toBe(1)
			expect(r.stderr).toContain('is not a branch name')
			expect(r.stderr).not.toContain('s3cret')
		}
	)

	it('fails on a form it does not resolve, pointing at its help', () => {
		const r = ken('path', 'layer', 'x')
		expect(r).toMatchObject({ status: 1, stdout: '' })
		expect(r.stderr).toContain('Run `ken path --help`')
	})
})

describe('ken config', () => {
	const tempRoot = () => {
		const dir = realpathSync.native(mkdtempSync(join(tmpdir(), 'ken-config-')))
		mkdirSync(join(dir, 'ken'))
		return join(dir, 'ken')
	}

	it("prints the PRD's example with its sources, each layer's hints and the task section intact", () => {
		const root = tempRoot()
		writeFileSync(
			join(root, '.ken.yaml'),
			[
				'orgs:',
				'  me: github.com/xiaoxinghu',
				'clone:',
				'  blobless: true',
				'layers:',
				'  - name: sales-atlas',
				'    key: github.com/acme/sales-atlas',
				"task: # ken-task's section; ken keeps it and prints it, nothing more",
				'  volume: me',
				'  branch: "{id}"'
			].join('\n')
		)
		symlinkSync(join(root, 'elsewhere'), join(root, 'sales-atlas'))
		const r = run({ ...process.env, KEN_ROOT: root }, ['config', '--json'])
		expect(r).toMatchObject({ status: 0, stderr: '' })
		expect(JSON.parse(r.stdout)).toEqual({
			root: { value: root, source: 'environment' },
			clone: { blobless: { value: true, source: '.ken.yaml' } },
			orgs: { me: 'github.com/xiaoxinghu' },
			layers: [
				{ name: 'sales-atlas', key: 'github.com/acme/sales-atlas', cloned: false, linked: true }
			],
			task: { volume: 'me', branch: '{id}' }
		})
	})

	it('gives the defaults, each with source default, without KEN_ROOT, a config file or .ken.yaml', () => {
		const root = tempRoot()
		const home = join(root, '..')
		const { KEN_ROOT: _, ...env } = process.env
		const r = run({ ...env, HOME: home, XDG_CONFIG_HOME: join(home, 'config') }, [
			'config',
			'--json'
		])
		expect(r).toMatchObject({ status: 0, stderr: '' })
		expect(JSON.parse(r.stdout)).toEqual({
			root: { value: root, source: 'default' },
			clone: { blobless: { value: true, source: 'default' } },
			orgs: {},
			layers: []
		})
	})
})

describe('ken help', () => {
	it('lists every command with its examples, the same ones `ken <command> --help` prints', () => {
		const overview = ken('help').stdout
		for (const [name, command] of Object.entries(COMMANDS)) {
			const own = ken(name, '--help')
			expect(own.status).toBe(0)
			expect(overview).toContain(command.usage)
			for (const example of command.examples) {
				expect(overview).toContain(example)
				expect(own.stdout).toContain(example)
			}
			expect(ken('help', name).stdout).toBe(own.stdout)
		}
		expect(ken().stdout).toBe(overview)
	})

	it('points an unknown command at ken help', () => {
		const r = ken('frobnicate')
		expect(r.status).toBe(1)
		expect(r.stderr).toContain('"frobnicate" is not a ken command')
		expect(r.stderr).toContain('run `ken help`')
	})
})
