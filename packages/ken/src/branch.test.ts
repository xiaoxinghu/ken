import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import { branchFolder } from './branch.ts'

const gitTakes = (branch: string) =>
	spawnSync('git', ['check-ref-format', '--branch', branch], { cwd: tmpdir() }).status === 0

describe('branchFolder', () => {
	it.each([
		['feat/login', 'feat-login'],
		['PROJ-123', 'PROJ-123'],
		['20261030T224918', '20261030T224918'],
		['a/b/c', 'a-b-c'],
		['x/HEAD', 'x-HEAD'],
		['ü', 'ü']
	])('writes %s as the folder %s', (branch, folder) => {
		expect(branchFolder(branch)).toBe(folder)
	})

	it.each([
		'HEAD',
		'-x',
		'.a',
		'a/.b',
		'a.lock',
		'a/b.lock',
		'a..b',
		'a.',
		'a/',
		'/a',
		'a//b',
		'a@{b',
		'a b',
		'a\tb',
		'a\x7f',
		'a~',
		'a^',
		'a:b',
		'a?',
		'a*',
		'a[',
		'a\\b',
		''
	])('refuses %j, as git does', (branch) => {
		expect(gitTakes(branch)).toBe(false)
		expect(() => branchFolder(branch)).toThrow('is not a branch name git accepts')
	})

	it('refuses @, which git branch refuses though check-ref-format --branch reads it as HEAD', () => {
		expect(() => branchFolder('@')).toThrow('is not a branch name git accepts')
	})
})
