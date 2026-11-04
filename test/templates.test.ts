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

it('there are the two templates docs/templates.md describes', () => {
	expect(NAMES.sort()).toEqual(['agents', 'minimal'])
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
	})
})
