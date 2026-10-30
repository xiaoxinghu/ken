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

const run = (env: NodeJS.ProcessEnv, args: string[], cwd?: string) => {
	const r = spawnSync(process.execPath, [join(import.meta.dirname, 'cli.ts'), ...args], {
		encoding: 'utf8',
		env,
		cwd
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

	it('fails on a word it does not resolve and no file has, pointing at its help', () => {
		const r = ken('path', 'rot')
		expect(r).toMatchObject({ status: 1, stdout: '' })
		expect(r.stderr).toContain('Run `ken path --help`')
	})
})

describe('ken path: layers, code references and README chains', () => {
	// <root>/sales-atlas links to the layer's clone, whose systems/ has a README and a page
	let root: string
	const layer = () => join(root, '.repos/github.com/acme/sales-atlas')
	const ken = (...args: string[]) => run({ ...process.env, KEN_ROOT: root }, args)

	beforeAll(() => {
		root = join(realpathSync.native(mkdtempSync(join(tmpdir(), 'ken-path-'))), 'ken')
		mkdirSync(join(layer(), 'systems'), { recursive: true })
		mkdirSync(join(root, 'flows/deep'), { recursive: true })
		mkdirSync(join(root, '.repos/github.com/acme/join-web'), { recursive: true })
		writeFileSync(
			join(root, '.ken.yaml'),
			'layers:\n  - name: sales-atlas\n    key: github.com/acme/sales-atlas\n'
		)
		symlinkSync(layer(), join(root, 'sales-atlas'))
		for (const readme of ['README.md', 'flows/deep/README.md']) {
			writeFileSync(join(root, readme), '')
		}
		for (const file of ['README.md', 'systems/README.md', 'systems/x.md']) {
			writeFileSync(join(layer(), file), '')
		}
		writeFileSync(join(root, 'flows/deep/page.md'), '')
		writeFileSync(join(root, 'root'), '')
	})

	it("prints a layer's clone by its name, and lists the layers for an unknown one", () => {
		expect(ken('path', 'layer', 'sales-atlas')).toMatchObject({
			status: 0,
			stdout: `${layer()}\n`
		})
		const r = ken('path', 'layer', 'atlas')
		expect(r.status).toBe(1)
		expect(r.stderr).toContain('the layers in .ken.yaml are sales-atlas')
	})

	it('resolves a reference into a cloned repo to the file, the symbol left to the reader', () => {
		expect(ken('path', 'github.com/Acme/join-web:src/join.ts#submit')).toEqual({
			status: 0,
			stdout: `${root}/.repos/github.com/acme/join-web/src/join.ts\n`,
			stderr: ''
		})
	})

	it('prints the URL of an uncloned repo, exit 0, and says on stderr to get it', () => {
		const r = ken('path', 'github.com/acme/join-api:src/x.ts#run')
		expect(r).toMatchObject({ status: 0, stdout: 'https://github.com/acme/join-api.git\n' })
		expect(r.stderr).toContain('github.com/acme/join-api is not cloned')
		expect(r.stderr).toContain('`ken get github.com/acme/join-api`')
	})

	it('refuses a reference that climbs out of its repo', () => {
		const r = ken('path', 'github.com/acme/join-web:../join-api/x.ts')
		expect(r).toMatchObject({ status: 1, stdout: '' })
		expect(r.stderr).toContain('points outside its repo')
	})

	it('skips a missing middle README, and a folder ends with its own', () => {
		expect(ken('path', join(root, 'flows/deep/page.md')).stdout).toBe(
			[`${root}/README.md`, `${root}/flows/deep/README.md`, `${root}/flows/deep/page.md`, ''].join(
				'\n'
			)
		)
		expect(ken('path', join(root, 'flows/deep')).stdout).toBe(
			`${root}/README.md\n${root}/flows/deep/README.md\n`
		)
	})

	it("goes through a layer's link as written, from a relative path in the shell's cwd too", () => {
		const chain = [
			`${root}/README.md`,
			`${root}/sales-atlas/README.md`,
			`${root}/sales-atlas/systems/README.md`,
			`${root}/sales-atlas/systems/x.md`,
			''
		].join('\n')
		expect(ken('path', join(root, 'sales-atlas/systems/x.md')).stdout).toBe(chain)
		const cwd = join(root, 'sales-atlas/systems')
		const r = run({ ...process.env, KEN_ROOT: root, PWD: cwd }, ['path', 'x.md'], cwd)
		expect(r.stdout).toBe(chain)
	})

	it('reaches a file named like a word as ./root', () => {
		expect(ken('path', join(root, 'root')).stdout).toBe(`${root}/README.md\n${root}/root\n`)
		const r = run({ ...process.env, KEN_ROOT: root, PWD: root }, ['path', './root'], root)
		expect(r.stdout).toBe(`${root}/README.md\n${root}/root\n`)
	})

	it('refuses a file outside the root, naming the root', () => {
		const outside = join(root, '..', 'notes.md')
		writeFileSync(outside, '')
		const r = ken('path', outside)
		expect(r).toMatchObject({ status: 1, stdout: '' })
		expect(r.stderr).toContain(`is not under the ken root ${root}`)
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
})
