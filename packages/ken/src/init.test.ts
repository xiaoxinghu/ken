import { spawnSync } from 'node:child_process'
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	symlinkSync,
	writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { init } from './init.ts'

let dir: string
let root: string
let env: NodeJS.ProcessEnv

beforeEach(() => {
	dir = realpathSync.native(mkdtempSync(join(tmpdir(), 'ken-init-')))
	root = join(dir, 'ken')
	env = { HOME: join(dir, 'home'), XDG_CONFIG_HOME: join(dir, 'config'), KEN_ROOT: root }
})

const read = (file: string) => readFileSync(join(root, file), 'utf8')
const SKELETON = ['.repos/index.yaml', '.ken.yaml', '.gitignore', '.bin', 'README.md', 'AGENTS.md']

describe('ken init', () => {
	it('creates every file of the skeleton in a fresh folder', () => {
		const out = init(root, env)
		for (const file of SKELETON) expect(existsSync(join(root, file))).toBe(true)
		expect(out).toContain(`Created in ${root}:`)
		expect(read('.gitignore')).toBe('.repos/*/*/*/\n.env\n')
		expect(read('.repos/index.yaml')).toBe(
			"# .repos/index.yaml: what each repo is. Whether it exists is the remote's business.\n"
		)
		// ken layer add writes under these headings, so they must be exact
		expect(read('README.md')).toMatch(/^## Sections$[\s\S]*^## Layers$/m)
		expect(read('AGENTS.md').split('\n').length).toBeLessThan(40)
	})

	it('creates nothing on a second run, and says so', () => {
		init(root, env)
		const before = SKELETON.filter((f) => f !== '.bin').map(read)
		expect(init(root, env)).toContain('Nothing to create')
		expect(SKELETON.filter((f) => f !== '.bin').map(read)).toEqual(before)
	})

	it('leaves an existing README.md, AGENTS.md and .ken.yaml untouched, filling in the rest', () => {
		mkdirSync(root)
		for (const file of ['README.md', 'AGENTS.md', '.ken.yaml']) {
			writeFileSync(join(root, file), `mine: ${file}\n`)
		}
		const out = init(root, env)
		for (const file of ['README.md', 'AGENTS.md', '.ken.yaml']) {
			expect(read(file)).toBe(`mine: ${file}\n`)
			expect(out).not.toContain(`  ${file}`)
		}
		expect(out).toContain('  .repos/index.yaml')
	})

	it('adds to an existing .gitignore only the lines it lacks', () => {
		mkdirSync(root)
		writeFileSync(join(root, '.gitignore'), 'node_modules/\n.env')
		expect(init(root, env)).toContain('.repos/*/*/*/ in .gitignore')
		expect(read('.gitignore')).toBe('node_modules/\n.env\n.repos/*/*/*/\n')
	})

	it('ignores the clones and worktrees, and tracks the index and owner context', () => {
		mkdirSync(root)
		spawnSync('git', ['init', '-q', root])
		init(root, env)
		mkdirSync(join(root, '.repos/github.com/a/b'), { recursive: true })
		writeFileSync(join(root, '.repos/github.com/a/AGENTS.md'), '')
		const ignored = (path: string) =>
			spawnSync('git', ['check-ignore', '-q', path], { cwd: root }).status === 0
		expect(ignored('.repos/github.com/a/b/')).toBe(true)
		expect(ignored('.repos/index.yaml')).toBe(false)
		expect(ignored('.repos/github.com/a/AGENTS.md')).toBe(false)
	})

	it.each([
		['a section', 'systems'],
		['a clone', '.repos/github.com/a/b'],
		['a section reached through a link', 'link']
	])('refuses a folder inside a root, in %s, naming the root', (_, inside) => {
		init(root, env)
		mkdirSync(join(root, 'systems'))
		symlinkSync(join(root, 'systems'), join(dir, 'link'))
		const target = inside === 'link' ? join(dir, 'link') : join(root, inside)
		expect(() => init(target, env)).toThrow(`is inside the ken root ${root}`)
		expect(existsSync(join(target, '.ken.yaml'))).toBe(false)
	})

	it('gives the line that points ken at a root that is not the configured one', () => {
		const out = init(root, { ...env, KEN_ROOT: undefined })
		expect(out).toContain(`not the configured root, ${join(dir, 'home/ken')} (from the default)`)
		expect(out).toContain(`export KEN_ROOT="${root}"`)
		expect(out).toContain(`{"root": "${root}"} in ${join(dir, 'config/ken/config.json')}`)
		expect(init(root, env)).not.toContain('KEN_ROOT')
	})

	it('initialises the current folder when given none', () => {
		mkdirSync(root)
		const r = spawnSync(process.execPath, [join(import.meta.dirname, 'cli.ts'), 'init'], {
			cwd: root,
			encoding: 'utf8',
			env: { ...process.env, ...env }
		})
		expect(r).toMatchObject({ status: 0, stderr: '' })
		for (const file of SKELETON) expect(existsSync(join(root, file))).toBe(true)
	})
})
