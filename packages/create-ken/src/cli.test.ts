import { spawnSync } from 'node:child_process'
import {
	existsSync,
	lstatSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	readlinkSync,
	realpathSync,
	writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'

const MINIMAL = join(import.meta.dirname, '..', 'templates', 'minimal')

let dir: string
let root: string
let env: NodeJS.ProcessEnv

beforeEach(() => {
	dir = realpathSync.native(mkdtempSync(join(tmpdir(), 'create-ken-')))
	root = join(dir, 'ken')
	const { KEN_ROOT: _, ...rest } = process.env
	env = { ...rest, HOME: join(dir, 'home'), XDG_CONFIG_HOME: join(dir, 'config') }
})

// stdin is a pipe, not a terminal, so the CLI asks nothing
const create = (...args: string[]) =>
	spawnSync(process.execPath, [join(import.meta.dirname, 'cli.ts'), ...args], {
		env,
		encoding: 'utf8'
	})

/** Every file under `folder`, relative to it. */
const files = (folder: string): string[] =>
	readdirSync(folder, { recursive: true, withFileTypes: true })
		.filter((e) => !e.isDirectory())
		.map((e) => relative(folder, join(e.parentPath, e.name)))

describe('create-ken', () => {
	it('makes a git repo holding the template and ken init, then refuses to run into it again', () => {
		const r = create(root)
		expect(r.stderr).toBe('')
		expect(r.status).toBe(0)
		expect(existsSync(join(root, '.git'))).toBe(true)
		for (const file of files(MINIMAL)) {
			expect(existsSync(join(root, file === 'gitignore' ? '.gitignore' : file))).toBe(true)
		}
		expect(existsSync(join(root, 'gitignore'))).toBe(false)
		// npm publishes no symlink, so the copy makes it
		expect(lstatSync(join(root, 'CLAUDE.md')).isSymbolicLink()).toBe(true)
		expect(readlinkSync(join(root, 'CLAUDE.md'))).toBe('AGENTS.md')
		expect(existsSync(join(root, '.repos/index.yaml'))).toBe(true)
		// the PRD caps the root AGENTS.md: it costs tokens on every turn
		expect(readFileSync(join(root, 'AGENTS.md'), 'utf8').split('\n').length).toBeLessThan(40)

		// git ignores the clones, worktrees and secrets, and nothing the root tracks
		mkdirSync(join(root, '.repos/github.com/acme/web.feat-x'), { recursive: true })
		mkdirSync(join(root, '.repos/github.com/acme/web'))
		writeFileSync(join(root, '.repos/github.com/acme/web/x'), '')
		writeFileSync(join(root, '.repos/github.com/acme/web.feat-x/x'), '')
		writeFileSync(join(root, '.repos/github.com/acme/AGENTS.md'), '')
		writeFileSync(join(root, '.repos/github.com/acme/.envrc'), '')
		writeFileSync(join(root, '.env'), '')
		const status = spawnSync(
			'git',
			['status', '--porcelain', '--ignored', '--untracked-files=all', '-z'],
			{ cwd: root, encoding: 'utf8' }
		).stdout.split('\0')
		expect(status.filter((l) => l.startsWith('!! ')).sort()).toEqual([
			'!! .env',
			'!! .repos/github.com/acme/web.feat-x/x',
			'!! .repos/github.com/acme/web/x'
		])
		for (const file of [
			'.repos/index.yaml',
			'.repos/github.com/acme/AGENTS.md',
			'.repos/github.com/acme/.envrc',
			'.gitignore',
			'.envrc',
			'CLAUDE.md'
		]) {
			expect(status).toContain(`?? ${file}`)
		}

		expect(r.stdout).toContain(`export KEN_ROOT=${root}`)
		expect(r.stdout).toContain(`cd ${root}`)
		const again = create(root)
		expect(again.status).toBe(1)
		expect(again.stderr).toContain(`${root} is not empty`)
	})

	it('prints no KEN_ROOT line when the new root is the configured one', () => {
		env.KEN_ROOT = root
		const r = create(root)
		expect(r.status).toBe(0)
		expect(r.stdout).not.toContain('KEN_ROOT')
	})

	it('off a terminal, refuses a missing directory with the command to run, and writes nothing', () => {
		const r = create()
		expect(r.status).toBe(1)
		expect(r.stderr).toContain(
			`Run \`npm create ken ${join(dir, 'home', 'ken')} -- --template minimal\``
		)
		expect(existsSync(join(dir, 'home'))).toBe(false)
	})

	it('refuses a template it does not have, naming those it has, before writing', () => {
		const r = create(root, '--template', 'nope')
		expect(r.status).toBe(1)
		expect(r.stderr).toContain('there is no template "nope"; this create-ken has minimal')
		expect(existsSync(root)).toBe(false)
	})
})
