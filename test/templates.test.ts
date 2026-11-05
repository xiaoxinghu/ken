// The templates, templates/<name>/ (docs/templates.md): each holds the rules a root starts
// from, and installs the way the workflow publishes its branch, with no ken on PATH.
import { spawnSync } from 'node:child_process'
import {
	copyFileSync,
	cpSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	readlinkSync,
	realpathSync,
	rmSync,
	writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'

const REPO = join(import.meta.dirname, '..')
const KEN = join(REPO, 'ken')
const TEMPLATES = join(REPO, 'templates')
const NAMES = readdirSync(TEMPLATES)
// no ken on PATH, no ~/ken: the root must be found and run through its own .bin/ken
const BARE = { PATH: '/usr/bin:/bin', HOME: '' }

let dir: string

// The template as the branch template/<name> holds it: the folder, with .bin/ken a copy of
// the kernel in place of the link, made a git repo.
const install = (name: string, as = name) => {
	const at = join(dir, as)
	cpSync(join(TEMPLATES, name), at, { recursive: true, verbatimSymlinks: true })
	rmSync(join(at, '.bin/ken'))
	copyFileSync(KEN, join(at, '.bin/ken'))
	spawnSync('git', ['init', '-q', '-b', 'main'], { cwd: at })
	return at
}
const sh = (cwd: string, env: Record<string, string>, ...args: string[]) => {
	const r = spawnSync('sh', args, { cwd, encoding: 'utf8', env: { ...BARE, ...env, HOME: dir } })
	return { status: r.status, stdout: r.stdout, stderr: r.stderr }
}

beforeAll(() => {
	dir = realpathSync.native(mkdtempSync(join(tmpdir(), 'ken-templates-')))
})

it('there is the one template docs/templates.md describes', () => {
	expect(NAMES).toEqual(['agents'])
})

describe.each(NAMES)('template %s', (name) => {
	const at = join(TEMPLATES, name)
	const read = (file: string) => readFileSync(join(at, file), 'utf8')

	it('holds what ken init makes, .bin/ken a link to the kernel the workflow copies in', () => {
		expect(readlinkSync(join(at, '.bin/ken'))).toBe('../../../ken')
		expect(read('.ken')).toContain(`\ntemplate.name=${name}\n`)
		expect(read('.repos/index')).toMatch(/^# \.repos\/index:/)
		expect(read('.gitignore').split('\n')).toEqual(
			expect.arrayContaining(['.repos/*/*/*/', '.env'])
		)
	})

	it('has a front page, and an AGENTS.md under 40 lines that says where the CLI is', () => {
		expect(read('README.md')).toContain('\n## Layers\n')
		expect(readlinkSync(join(at, 'CLAUDE.md'))).toBe('AGENTS.md')
		const agents = read('AGENTS.md')
		expect(agents.match(/\n/g)?.length).toBeLessThan(40) // lines as wc -l and ken lint count them
		expect(agents).toContain('`.bin/ken`')
		expect(agents).toContain('`ken help`')
	})

	it('installed, is a root already: init adds nothing, and ken runs from .bin with no PATH', () => {
		const root = install(name)
		const init = sh(root, {}, '.bin/ken', 'init')
		expect(init.status).toBe(0)
		expect(init.stdout).toContain('is a root already with every file ken owns: nothing was created')
		expect(sh(root, {}, '.bin/ken', 'path', 'root').stdout).toBe(`${root}\n`)
	})
})

describe('the agents template', () => {
	const at = join(TEMPLATES, 'agents')

	it('keeps one hooks object, copied into Claude Code settings and linked for Codex', () => {
		const hooks = JSON.parse(readFileSync(join(at, '.agents/hooks.json'), 'utf8'))
		const settings = JSON.parse(readFileSync(join(at, '.claude/settings.json'), 'utf8'))
		expect(settings.hooks).toEqual(hooks.hooks)
		expect(hooks.hooks.SessionStart[0].hooks[0].command).toBe('.bin/ken status')
		expect(readlinkSync(join(at, '.codex/hooks.json'))).toBe('../.agents/hooks.json')
	})

	it('.bin/ken status: a screen naming the CLI, exit 0, and ken on PATH through CLAUDE_ENV_FILE', () => {
		const root = install('agents', 'status')
		const envFile = join(dir, 'env.sh')
		writeFileSync(envFile, '')
		const r = sh(root, { CLAUDE_ENV_FILE: envFile }, '.bin/ken', 'status')
		expect(r.status).toBe(0)
		expect(r.stdout).toContain(`This is a ken root: ${root}.`)
		expect(r.stdout).toContain('`ken help`')
		expect(r.stdout).toContain('nothing to list')
		expect(r.stdout).toContain('  template.name=agents\n')
		// sourced before each shell command, it makes `ken` this root's kernel
		const sourced = sh(dir, {}, '-c', `. ${envFile} && command -v ken && ken path root`)
		expect(sourced.stdout).toBe(`${root}/.bin/ken\n${root}\n`)
	})

	it('.bin/ken status with no CLAUDE_ENV_FILE writes no file and still exits 0', () => {
		const root = install('agents', 'plain')
		mkdirSync(join(root, 'nowhere'))
		const r = sh(join(root, 'nowhere'), {}, '../.bin/ken', 'status')
		expect(r.status).toBe(0)
		expect(r.stdout).toContain(`This is a ken root: ${root}.`)
		expect(r.stdout).not.toContain('log.md')
	})

	describe('ken log', () => {
		let root: string
		beforeAll(() => {
			root = install('agents', 'log')
			mkdirSync(join(root, 'flow/deep'), { recursive: true })
		})
		const log = (...args: string[]) =>
			sh(join(root, 'flow/deep'), {}, '../../.bin/ken', 'log', ...args)
		const lines = () => readFileSync(join(root, 'log.md'), 'utf8').split('\n').slice(0, -1)

		it('from a subfolder, creates the root log.md with one line: local time and offset, kind, subject, what', () => {
			for (const shell of ['sh', 'dash']) {
				const r = spawnSync(
					shell,
					['../../.bin/ken', 'log', 'query', 'flow/README.md', 'answered', 'X'],
					{
						cwd: join(root, 'flow/deep'),
						encoding: 'utf8',
						env: { ...BARE, HOME: dir }
					}
				)
				expect(r.status).toBe(0)
				expect(r.stdout + r.stderr).toBe('')
			}
			expect(lines()).toHaveLength(2)
			for (const line of lines()) {
				expect(line).toMatch(
					/^\d{4}-\d\d-\d\dT\d\d:\d\d[+-]\d{4} query flow\/README\.md: answered X$/
				)
			}
		})

		it.each([
			[['nope', 'a', 'b'], "'nope' is not a kind"],
			[['ingest query', 'a', 'b'], "'ingest query' is not a kind"],
			[['page', 'a b', 'c'], "'a b' is not one word"],
			[['page', 'a', 'one\ntwo'], 'spans lines'],
			[['page', 'a', ' '], 'is empty'],
			[['page', 'a'], 'are needed']
		])('refuses %j, naming the rule and the kinds, and writes nothing', (args, rule) => {
			const before = lines().length
			const r = log(...args)
			expect(r.status).toBe(2)
			expect(r.stderr).toContain(rule)
			expect(r.stderr).toContain('ingest query page task promote layer')
			expect(lines()).toHaveLength(before)
		})

		it('ken status ends with the last 10 lines in time order and the current time', () => {
			const entries = Array.from(
				{ length: 12 },
				(_, i) => `2026-01-${String(i + 1).padStart(2, '0')}T09:00+1300 page p${i}.md: x`
			)
			// a union merge appends the other side after this one's: out of order
			writeFileSync(
				join(root, 'log.md'),
				`${[...entries.slice(6), ...entries.slice(0, 6)].join('\n')}\n`
			)
			const r = sh(root, {}, '.bin/ken', 'status')
			expect(r.status).toBe(0)
			expect(r.stdout).toMatch(/Recent, log\.md \(now \d{4}-\d\d-\d\dT\d\d:\d\d[+-]\d{4}\)/)
			expect(r.stdout.endsWith(`:\n${entries.slice(2).join('\n')}\n`)).toBe(true)
		})

		it('two branches that each append merge without a conflict, keeping both lines', () => {
			const git = (...args: string[]) =>
				spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], {
					cwd: root,
					encoding: 'utf8',
					env: { ...BARE, HOME: dir }
				})
			git('add', '-A')
			git('commit', '-qm', 'root')
			git('checkout', '-qb', 'other')
			log('task', 'tasks/b.md', 'added')
			git('commit', '-qam', 'b')
			git('checkout', '-q', 'main')
			log('task', 'tasks/a.md', 'added')
			git('commit', '-qam', 'a')
			const merge = git('merge', '-q', '-m', 'merge', 'other')
			expect(merge.status).toBe(0)
			const text = readFileSync(join(root, 'log.md'), 'utf8')
			expect(text).toContain('task tasks/a.md: added\n')
			expect(text).toContain('task tasks/b.md: added\n')
			expect(text).not.toContain('<<<<<<<')
		})
	})
})
