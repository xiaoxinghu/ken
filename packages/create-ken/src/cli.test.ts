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
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'

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

describe('create-ken', () => {
	it('makes a git repo holding what ken init makes and CLAUDE.md, then refuses to run into it again', () => {
		const r = create(root)
		expect(r.stderr).toBe('')
		expect(r.status).toBe(0)
		// minimal assumes nothing about what the root is for: the skeleton, and nothing more
		expect(readdirSync(root).sort()).toEqual([
			'.bin',
			'.git',
			'.gitignore',
			'.ken.yaml',
			'.repos',
			'AGENTS.md',
			'CLAUDE.md',
			'README.md'
		])
		expect(existsSync(join(root, '.repos/index.yaml'))).toBe(true)
		// npm publishes no symlink, so create-ken makes it
		expect(lstatSync(join(root, 'CLAUDE.md')).isSymbolicLink()).toBe(true)
		expect(readlinkSync(join(root, 'CLAUDE.md'))).toBe('AGENTS.md')

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

	it('makes a root that, pushed, another root adds as a layer as it is: there is no layer template', () => {
		const team = join(dir, 'team')
		expect(create(team).status).toBe(0)
		const front = readFileSync(join(team, 'README.md'), 'utf8')
		writeFileSync(join(team, 'README.md'), front.replace(/^A knowledge base.*$/m, 'The acme team.'))
		const git = (cwd: string, ...args: string[]) =>
			expect(spawnSync('git', args, { cwd, env }).status).toBe(0)
		git(team, 'add', '-A')
		git(team, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'x')
		git(dir, 'clone', '-q', '--bare', team, join(dir, 'remotes/example.com/acme/team.git'))

		expect(create(root).status).toBe(0)
		const require = createRequire(import.meta.url)
		const pkg = require.resolve('@unclex/ken/package.json')
		const ken = (...args: string[]) =>
			spawnSync(process.execPath, [join(dirname(pkg), require(pkg).bin.ken), ...args], {
				encoding: 'utf8',
				// the key reaches the bare remote through url.insteadOf
				env: {
					...env,
					KEN_ROOT: root,
					GIT_CONFIG_COUNT: '1',
					GIT_CONFIG_KEY_0: `url.file://${dir}/remotes/.insteadOf`,
					GIT_CONFIG_VALUE_0: 'https://'
				}
			})
		const add = ken('layer', 'add', 'example.com/acme/team')
		expect(add.status, add.stderr).toBe(0)
		expect(readFileSync(join(root, 'README.md'), 'utf8')).toContain(
			'- [team](team/README.md): The acme team.'
		)
		expect(ken('repos', '--layer', 'team').status).toBe(0)
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
