import { spawnSync } from 'node:child_process'
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	realpathSync,
	symlinkSync,
	writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { git } from './git.ts'
import { locate } from './which.ts'

let root: string
let clone: string
let worktree: string

// a root that is itself a git repo, as every root is, with github.com/a/b cloned on main and its
// branch feat/login in a worktree beside it
beforeAll(() => {
	root = join(realpathSync.native(mkdtempSync(join(tmpdir(), 'ken-which-'))), 'ken')
	clone = join(root, '.repos/github.com/a/b')
	worktree = `${clone}.feat-login`
	mkdirSync(join(clone, 'src'), { recursive: true })
	git(root, 'init', '-q', '-b', 'main')
	git(clone, 'init', '-q', '-b', 'main')
	git(
		clone,
		'-c',
		'user.name=t',
		'-c',
		'user.email=t@t',
		'commit',
		'-q',
		'--allow-empty',
		'-m',
		'x'
	)
	git(clone, 'worktree', 'add', '-q', '-b', 'feat/login', worktree)
	mkdirSync(join(worktree, 'src'))
	writeFileSync(join(root, '.repos/github.com/a/AGENTS.md'), '')
	symlinkSync(clone, join(root, 'handbook'))
})

describe('locate', () => {
	it('names the clone and its branch, from a subfolder or a file not created yet', () => {
		const place = { key: 'github.com/a/b', kind: 'clone', branch: 'main' }
		expect(locate(clone, root)).toEqual(place)
		expect(locate(join(clone, 'src/new.ts'), root)).toEqual(place)
	})

	it("names a worktree by its clone's key and its own branch", () => {
		const place = { key: 'github.com/a/b', kind: 'worktree', branch: 'feat/login' }
		expect(locate(worktree, root)).toEqual(place)
		expect(locate(join(worktree, 'src'), root)).toEqual(place)
	})

	it('answers a repo not cloned yet from its shape, with no branch', () => {
		expect(locate(join(root, '.repos/github.com/a/new/src/x.ts'), root)).toEqual({
			key: 'github.com/a/new',
			kind: 'clone',
			branch: null
		})
	})

	it('takes a folder not made yet beside a clone as its worktree, not as a repo of that name', () => {
		const place = { key: 'github.com/a/b', kind: 'worktree', branch: null }
		expect(locate(`${clone}.fix-1/src`, root)).toEqual(place)
		// the worktree b.feat-login is beside it too, but is no clone to key b.feat-login.x by
		expect(locate(`${worktree}.x/src`, root)).toEqual(place)
	})

	it("keys a worktree outside its clone's owner folder by the clone, host and owner included", () => {
		const elsewhere = join(root, '.repos/github.com/z/b.fix')
		git(clone, 'worktree', 'add', '-q', '-b', 'fix', elsewhere)
		expect(locate(elsewhere, root)).toEqual({
			key: 'github.com/a/b',
			kind: 'worktree',
			branch: 'fix'
		})
	})

	it("resolves a path through a layer's section link to the clone it points at", () => {
		expect(locate(join(root, 'handbook/src'), root)).toMatchObject({ key: 'github.com/a/b' })
	})

	it.skipIf(!existsSync(tmpdir().toUpperCase()))('resolves a path in a different case', () => {
		expect(locate(join(root, '.repos/GitHub.com/A/B.Feat-Login'), root)).toMatchObject({
			key: 'github.com/a/b',
			branch: 'feat/login'
		})
	})

	it.each([
		['the root itself', ''],
		['a page', 'README.md'],
		['the owner-level AGENTS.md', '.repos/github.com/a/AGENTS.md'],
		['an owner folder', '.repos/github.com/a']
	])('says %s is outside every checkout', (_, path) => {
		expect(() => locate(join(root, path), root)).toThrow('outside .repos/')
	})

	it("refuses a folder where a checkout belongs that is not one, rather than answer with the root's repo", () => {
		mkdirSync(join(root, '.repos/github.com/a/plain'))
		expect(() => locate(join(root, '.repos/github.com/a/plain'), root)).toThrow(
			'not a git checkout'
		)
	})

	it('names the root a path outside it is not under', () => {
		expect(() => locate(tmpdir(), root)).toThrow(`not under the ken root ${root}`)
	})
})

describe('ken which', () => {
	const ken = (cwd: string, ...args: string[]) =>
		spawnSync(process.execPath, [join(import.meta.dirname, 'cli.ts'), 'which', ...args], {
			cwd,
			encoding: 'utf8',
			env: { ...process.env, KEN_ROOT: root }
		})

	it('prints one line for the current directory, and an object with --json', () => {
		expect(ken(join(worktree, 'src')).stdout).toBe('github.com/a/b worktree feat/login\n')
		expect(JSON.parse(ken(root, '--json', '.repos/github.com/a/new/x.ts').stdout)).toEqual({
			key: 'github.com/a/new',
			kind: 'clone',
			branch: null
		})
	})

	it('exits 1 outside .repos/, with the next step on stderr', () => {
		const r = ken(root)
		expect(r).toMatchObject({ status: 1, stdout: '' })
		expect(r.stderr).toContain('Run `ken path code <key> [<branch>]`')
	})
})
