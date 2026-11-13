// create-ken as a person runs it, against temp folders, with a PATH on which no ken is installed;
// and the template's own rules (docs/templates.md).
import { spawnSync } from 'node:child_process'
import {
	appendFileSync,
	lstatSync,
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
import { describe, expect, it } from 'vitest'

const CLI = join(import.meta.dirname, 'cli.ts')
const PKG = join(import.meta.dirname, '..')
const TEMPLATE = join(PKG, 'template')
const KEN = join(PKG, '../ken/src/cli.ts')
const BASE = '/usr/bin:/bin'
const dir = realpathSync.native(mkdtempSync(join(tmpdir(), 'create-ken-')))
let n = 0

const env = (path = BASE): NodeJS.ProcessEnv => ({ PATH: path, HOME: dir, TZ: 'UTC' })
const run = (runtime: string, file: string, args: string[], cwd: string, path?: string) => {
	const r = spawnSync(runtime, [file, ...args], { cwd, env: env(path), encoding: 'utf8' })
	return { status: r.status, stdout: r.stdout, stderr: r.stderr }
}
const create = (args: string[], cwd = dir, runtime = process.execPath) =>
	run(runtime, CLI, args, cwd)
const ken = (args: string[], cwd: string) => run(process.execPath, KEN, args, cwd)
/** A new root made by create-ken, with a space in its path. */
const fresh = () => {
	const root = join(dir, `root ${++n}`)
	expect(create([root]).status).toBe(0)
	return root
}
const read = (root: string, file: string) => readFileSync(join(root, file), 'utf8')
const tread = (file: string) => readFileSync(join(TEMPLATE, file), 'utf8')
const HOOK =
	"if command -v ken >/dev/null 2>&1; then ken status; else echo 'This is a ken root, and ken is not installed: run npm install -g @unclex/ken, then start a new session.'; fi"
// every file a root gets from the template, the ignore file under the name it is written as
const FILES = [
	'.agents/hooks.json',
	'.claude/settings.json',
	'.envrc',
	'.gitattributes',
	'.gitignore',
	'.pi/extensions/ken-hooks.ts',
	'AGENTS.md',
	'README.md'
]

describe('create-ken', { timeout: 30_000 }, () => {
	it('makes a root that holds every file, the links as links, and passes ken lint and ken status', () => {
		const root = fresh()
		for (const file of FILES) expect(lstatSync(join(root, file)).isFile(), file).toBe(true)
		expect(readlinkSync(join(root, 'CLAUDE.md'))).toBe('AGENTS.md')
		expect(readlinkSync(join(root, '.codex/hooks.json'))).toBe('../.agents/hooks.json')
		expect(read(root, '.ken')).toMatch(/\nken\.format=1\ntemplate\.name=agents\n$/)
		expect(read(root, '.gitignore').split('\n')).toEqual(
			expect.arrayContaining(['.env', '.repos/', 'CLAUDE.local.md', 'node_modules'])
		)
		const lint = ken(['lint'], root)
		expect(lint.stderr).toBe('')
		expect(lint.status).toBe(0)
		const status = ken(['status'], root)
		expect(status.status).toBe(0)
		expect(status.stdout).toContain(`This is a ken root: ${root}.`)
		expect(status.stdout).toContain('  template.name=agents\n')
	})

	it('says what to do next: install ken, git init, the first commit', () => {
		const root = join(dir, `root ${++n}`)
		const r = create([root])
		expect(r.stdout).toContain('npm install -g @unclex/ken')
		expect(r.stdout).toContain(`git -C '${root}' init\n`)
		expect(r.stdout).toContain(`git -C '${root}' commit -m 'A ken root'`)
	})

	it('rerun, creates nothing and changes nothing', () => {
		const root = fresh()
		const before = readdirSync(root, { recursive: true }).sort()
		const ignore = read(root, '.gitignore')
		const r = create([], root)
		expect(r.status).toBe(0)
		expect(r.stdout).toContain(`${root} has every file of the template: nothing was made.`)
		expect(readdirSync(root, { recursive: true }).sort()).toEqual(before)
		expect(read(root, '.gitignore')).toBe(ignore)
		expect(read(root, '.ken').match(/template\.name/g)).toHaveLength(1)
	})

	it('in a root missing a file, makes only that one', () => {
		const root = fresh()
		rmSync(join(root, '.pi'), { recursive: true })
		rmSync(join(root, 'CLAUDE.md'))
		const r = create([root])
		expect(r.stdout).toContain(
			':\n  .pi/extensions/ken-hooks.ts\n  CLAUDE.md -> AGENTS.md\nLeft alone'
		)
		expect(read(root, '.pi/extensions/ken-hooks.ts')).toBe(tread('.pi/extensions/ken-hooks.ts'))
		expect(readlinkSync(join(root, 'CLAUDE.md'))).toBe('AGENTS.md')
	})

	it('leaves a changed file, or a file where a link goes, as it is and names it with the diff to run', () => {
		const root = fresh()
		appendFileSync(join(root, 'AGENTS.md'), '- A line of my own.\n')
		const mine = read(root, 'AGENTS.md')
		rmSync(join(root, 'CLAUDE.md'))
		writeFileSync(join(root, 'CLAUDE.md'), 'mine\n')
		const r = create([root])
		expect(r.status).toBe(0)
		expect(read(root, 'AGENTS.md')).toBe(mine)
		expect(read(root, 'CLAUDE.md')).toBe('mine\n')
		expect(r.stdout).toContain(
			`  AGENTS.md: \`diff ${join(TEMPLATE, 'AGENTS.md')} '${root}/AGENTS.md'\`\n`
		)
		expect(r.stdout).toContain('  CLAUDE.md: not the link CLAUDE.md -> AGENTS.md')
	})

	it('adds its ignore lines to a .gitignore of the folder, keeping the lines there', () => {
		const root = join(dir, `root ${++n}`)
		mkdirSync(root)
		writeFileSync(join(root, '.gitignore'), 'dist')
		expect(create([root]).status).toBe(0)
		expect(read(root, '.gitignore')).toBe('dist\n.env\n.repos/\nCLAUDE.local.md\nnode_modules\n')
	})

	it('in a folder ken init refuses, inside another root, writes nothing', () => {
		const outer = fresh()
		const r = create([join(outer, 'notes')])
		expect(r.status).toBe(1)
		expect(r.stderr).toContain('roots do not nest')
		expect(readdirSync(outer)).not.toContain('notes')
	})

	it('refuses a second folder or an option, naming the usage', () => {
		expect(create(['a', 'b']).stderr).toContain('takes one folder, got 2 arguments')
		expect(create(['--force']).status).toBe(1)
		expect(create(['--help']).stdout).toContain('Usage: create-ken [<dir>]')
	})

	const bun = spawnSync('sh', ['-c', 'command -v bun'], { encoding: 'utf8' }).stdout.trim()
	if (!bun) console.warn('bun is not on PATH, so the create-ken smoke test under bun is skipped.')
	it.skipIf(!bun)('runs under bun', () => {
		const root = join(dir, `root ${++n}`)
		expect(create([root], dir, bun).status).toBe(0)
		expect(readlinkSync(join(root, 'CLAUDE.md'))).toBe('AGENTS.md')
	})

	it('packs the ignore file under its stored name, and every template file', () => {
		const r = spawnSync('npm', ['pack', '--dry-run', '--json'], { cwd: PKG, encoding: 'utf8' })
		const packed: string[] = JSON.parse(r.stdout)[0].files.map((f: { path: string }) => f.path)
		expect(packed).toContain('template/gitignore')
		for (const file of readdirSync(TEMPLATE, { recursive: true }) as string[])
			if (lstatSync(join(TEMPLATE, file)).isFile()) expect(packed).toContain(`template/${file}`)
	})
})

describe('the template', () => {
	it('has a front page with sections and no layers', () => {
		expect(tread('README.md')).toMatch(/\n## Sections\n/)
		expect(tread('README.md')).not.toContain('Layers')
	})

	it('has an AGENTS.md under 40 lines whose first paragraph says where the CLI is and how to install it', () => {
		const agents = tread('AGENTS.md')
		expect(agents.match(/\n/g)?.length).toBeLessThan(40) // lines as wc -l and ken lint count them
		const first = agents.split('\n\n')[1]
		expect(first).toContain('ken root')
		expect(first).toContain('`ken help`')
		expect(first).toContain('`npm install -g @unclex/ken`')
		for (const gone of ['.bin/ken', 'KEN_SRC', 'layer']) expect(agents).not.toContain(gone)
		expect(agents).toContain("this root's `CLAUDE.md` hides a checkout's AGENTS.md")
	})

	it('keeps one hooks object, the one constant line, copied into Claude Code settings', () => {
		const hooks = JSON.parse(tread('.agents/hooks.json'))
		expect(JSON.parse(tread('.claude/settings.json'))).toEqual(hooks)
		expect(hooks.hooks.SessionStart).toEqual([{ hooks: [{ type: 'command', command: HOOK }] }])
	})

	it('the hook with no ken on PATH prints the install line and exits 0; with ken, ken status', () => {
		const root = fresh()
		const none = spawnSync('sh', ['-c', HOOK], { cwd: root, env: env(), encoding: 'utf8' })
		expect([none.status, none.stdout]).toEqual([
			0,
			'This is a ken root, and ken is not installed: run npm install -g @unclex/ken, then start a new session.\n'
		])
		const bin = join(dir, 'bin')
		mkdirSync(bin, { recursive: true })
		writeFileSync(join(bin, 'ken'), `#!/bin/sh\nexec '${process.execPath}' '${KEN}' "$@"\n`, {
			mode: 0o755
		})
		const r = spawnSync('sh', ['-c', HOOK], {
			cwd: join(root, '.claude'),
			env: env(`${bin}:${BASE}`),
			encoding: 'utf8'
		})
		expect(r.status).toBe(0)
		expect(r.stdout).toContain(`This is a ken root: ${root}.`)
	})

	it('ignores secrets and the checkouts, and merges log.md by union', () => {
		expect(tread('gitignore').split('\n')).toEqual(expect.arrayContaining(['.env', '.repos/']))
		expect(tread('.gitattributes')).toBe('log.md merge=union\n')
	})
})
