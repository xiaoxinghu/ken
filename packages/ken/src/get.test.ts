import { spawnSync } from 'node:child_process'
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	renameSync,
	writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { git, requireGit } from './git.ts'
import { indexFile, readIndex } from './index.ts'

let tmp: string
let remote: string
let root: string
const KEY = 'example.com/acme/web'
const clone = () => join(root, '.repos', KEY)
const config = (dir: string, name: string) =>
	spawnSync('git', ['config', name], { cwd: dir, encoding: 'utf8' }).stdout.trim()

// remotes are bare repos under <tmp>/remotes, reached by key as https://example.com/<owner>/<repo>.git
// through url.insteadOf, so a key alone clones from a local file:// URL
const ken = (...args: string[]) =>
	spawnSync(process.execPath, [join(import.meta.dirname, 'cli.ts'), 'get', ...args], {
		encoding: 'utf8',
		env: {
			...process.env,
			KEN_ROOT: root,
			GIT_CONFIG_COUNT: '1',
			GIT_CONFIG_KEY_0: `url.file://${tmp}/remotes/.insteadOf`,
			GIT_CONFIG_VALUE_0: 'https://example.com/'
		}
	})

beforeAll(() => {
	tmp = realpathSync.native(mkdtempSync(join(tmpdir(), 'ken-get-')))
	remote = join(tmp, 'remotes/acme/web.git')
	mkdirSync(remote, { recursive: true })
	git(remote, 'init', '-q', '--bare', '-b', 'main')
	// a server must allow filters, or git clones in full and says nothing
	git(remote, 'config', 'uploadpack.allowFilter', 'true')
	git(remote, 'update-ref', 'refs/heads/main', git(remote, 'commit-tree', '-m', 'x', emptyTree()))
	mkdirSync(join(tmp, 'remotes/acme/empty.git'))
	git(join(tmp, 'remotes/acme/empty.git'), 'init', '-q', '--bare', '-b', 'trunk')
})

const emptyTree = () => git(remote, 'hash-object', '-t', 'tree', '-w', '--stdin')

beforeEach(() => {
	root = mkdtempSync(join(tmp, 'root-'))
})

describe('ken get', () => {
	it('clones blobless, registers the key and prints the path; a second get changes nothing', () => {
		const first = ken(KEY)
		expect(first).toMatchObject({ status: 0, stdout: `${clone()}\n` })
		expect(config(clone(), 'remote.origin.promisor')).toBe('true')
		expect(config(clone(), 'worktree.useRelativePaths')).toBe('true')
		expect(readIndex(indexFile(root))).toEqual({ [KEY]: {} })
		expect(first.stderr).toContain(`\`ken index set ${KEY} desc="..."\``)

		const index = readFileSync(indexFile(root), 'utf8')
		const head = git(clone(), 'rev-parse', 'origin/main')
		// the remote moves on; get uses the clone as it is, with no fetch
		git(remote, 'update-ref', 'refs/heads/main', git(remote, 'commit-tree', '-m', 'y', emptyTree()))
		expect(ken(KEY)).toMatchObject({ status: 0, stdout: `${clone()}\n`, stderr: '' })
		expect(readFileSync(indexFile(root), 'utf8')).toBe(index)
		expect(git(clone(), 'rev-parse', 'origin/main')).toBe(head)
	})

	it('makes a full clone when .ken.yaml says clone.blobless: false', () => {
		writeFileSync(join(root, '.ken.yaml'), 'clone:\n  blobless: false\n')
		expect(ken(KEY).status).toBe(0)
		expect(config(clone(), 'remote.origin.promisor')).toBe('')
	})

	it('clones an empty remote onto its unborn default branch', () => {
		const r = ken('example.com/acme/empty')
		const dir = join(root, '.repos/example.com/acme/empty')
		expect(r).toMatchObject({ status: 0, stdout: `${dir}\n` })
		expect(git(dir, 'branch', '--show-current')).toBe('trunk')
		expect(spawnSync('git', ['rev-parse', '--verify', 'HEAD'], { cwd: dir }).status).not.toBe(0)
	})

	it('leaves no folder behind when the clone fails, and says what to rerun', () => {
		const r = ken('example.com/acme/missing')
		expect(r).toMatchObject({ status: 1, stdout: '' })
		expect(r.stderr).toContain('does not appear to be a git repository')
		expect(r.stderr).toContain('run `ken get example.com/acme/missing` again')
		expect(existsSync(join(root, '.repos/example.com/acme/missing'))).toBe(false)
		expect(existsSync(indexFile(root))).toBe(false)
	})

	it('refuses a plain folder in the way, naming it, and leaves it untouched', () => {
		mkdirSync(clone(), { recursive: true })
		writeFileSync(join(clone(), 'notes.md'), 'mine')
		const r = ken(KEY)
		expect(r).toMatchObject({ status: 1, stdout: '' })
		expect(r.stderr).toContain(`${clone()} is a folder that is not a git clone`)
		expect(r.stderr).toContain(`\`mv ${clone()} ~/web.aside\``)
		expect(readFileSync(join(clone(), 'notes.md'), 'utf8')).toBe('mine')
		expect(existsSync(join(clone(), '.git'))).toBe(false)
		expect(existsSync(indexFile(root))).toBe(false)
	})

	it("writes no root entry for a key a layer's index lists", () => {
		writeFileSync(
			join(root, '.ken.yaml'),
			'layers:\n  - name: atlas\n    key: example.com/acme/atlas\n'
		)
		const layerIndex = indexFile(join(root, '.repos/example.com/acme/atlas'))
		mkdirSync(join(layerIndex, '..'), { recursive: true })
		writeFileSync(layerIndex, 'example.com/acme:\n  repos:\n    web:\n      desc: The web app.\n')
		const r = ken(KEY)
		expect(r).toMatchObject({ status: 0, stderr: '' })
		expect(existsSync(indexFile(root))).toBe(false)
	})

	it('adopts a clone moved in with mv: relative worktrees, and its worktree repaired', () => {
		const elsewhere = join(tmp, `moved-${Date.now()}`)
		git(tmp, 'clone', '-q', `file://${remote}`, elsewhere)
		git(elsewhere, 'worktree', 'add', '-q', '-b', 'fix', `${elsewhere}.fix`)
		mkdirSync(join(clone(), '..'), { recursive: true })
		renameSync(elsewhere, clone())
		expect(ken(KEY)).toMatchObject({ status: 0, stdout: `${clone()}\n` })
		expect(config(clone(), 'worktree.useRelativePaths')).toBe('true')
		// the worktree's .git file pointed at the old place until the repair
		expect(git(`${elsewhere}.fix`, 'branch', '--show-current')).toBe('fix')
	})
})

describe('requireGit', () => {
	it('takes 2.48 and later, comparing numbers, and names the version it refuses', () => {
		expect(() => requireGit('git version 2.48.0')).not.toThrow()
		expect(() => requireGit('git version 2.100.1 (Apple Git-1)')).not.toThrow()
		expect(() => requireGit('git version 3.0.0')).not.toThrow()
		expect(() => requireGit('git version 2.47.1')).toThrow('git version 2.47.1 is too old')
	})
})
