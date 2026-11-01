import { spawnSync } from 'node:child_process'
import { readFileSync, statSync, utimesSync } from 'node:fs'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { kenTask, newRoot, write } from './testing.ts'

// a local noon, so the date of the mtime is the same in every time zone of the machine
const SEPT_15 = new Date(2026, 8, 15, 12)
const front = (text: string) => `---\n${text}\n---\n`

/** A root with `tasks/<rel>` holding each text, every mtime on 2026-09-15. */
function setup(files: Record<string, string>) {
	const root = newRoot()
	const folder = join(root, 'tasks')
	for (const [rel, text] of Object.entries(files)) {
		write(join(folder, rel), text)
		utimesSync(join(folder, rel), SEPT_15, SEPT_15)
	}
	const read = (rel: string) => readFileSync(join(folder, rel), 'utf8')
	return { root, folder, read, lint: (...args: string[]) => kenTask(root, ['lint', ...args]) }
}

const CANONICAL = `${front('status: todo\ncreated: 2026-10-01')}# Canonical\n`
const BODY = 'status: done, says the body\n\n```yaml\n---\nstatus: wontfix\n---\n```\n'

/** Each lossless deviation, the canonical text `--fix` makes of it, and the line it prints. */
const LOSSLESS: Record<string, [before: string, after: string, says: string]> = {
	'no-front.md': [
		`# No front\n\n${BODY}`,
		`${front('status: todo\ncreated: 2026-09-15')}# No front\n\n${BODY}`,
		'no status line'
	],
	'body.md': [
		`${front('status: todo')}# Body\n\n${BODY}`,
		`${front('status: todo\ncreated: 2026-09-15')}# Body\n\n${BODY}`,
		'no created line'
	],
	'no-status.md': [
		front('created: 2026-10-01 # by hand'),
		front('created: 2026-10-01 # by hand\nstatus: todo'),
		'no status line'
	],
	'done.md': [
		front('status: done\ncreated: 2026-10-01'),
		front('status: done\ncreated: 2026-10-01\nclosed: 2026-09-15'),
		'status done with no closed line'
	],
	'alias.md': [
		front('status: todo\ncreated: 2026-10-01\ndepends_on: # waits\n  - canonical.md\nowner: me'),
		front('status: todo\ncreated: 2026-10-01\nblocked-by: [canonical.md] # waits\nowner: me'),
		'depends_on reads as blocked-by; depends_on is a block list'
	],
	'scalar.md': [
		front('status: todo\ncreated: 2026-10-01\nblocked-by: canonical.md'),
		front('status: todo\ncreated: 2026-10-01\nblocked-by: [canonical.md]'),
		'blocked-by is a single value'
	],
	'sub/from-root.md': [
		front('status: todo\ncreated: 2026-10-01\nblocked-by: [tasks/canonical.md, canonical.md]'),
		front('status: todo\ncreated: 2026-10-01\nblocked-by: [../canonical.md, ../canonical.md]'),
		'blocked-by tasks/canonical.md resolves from the root, not from this file; blocked-by canonical.md resolves from the folder'
	]
}

/** Each deviation `--fix` leaves alone, and what its line says. */
const NAMED: Record<string, [text: string, says: string]> = {
	'typo.md': [
		front('status: tdo\ncreated: 2026-10-01'),
		'status "tdo" is none of todo, done, wontfix'
	],
	'unclosed.md': ['---\nstatus: todo\n# Unclosed\n', 'no closing `---`'],
	'missing.md': [
		front('status: todo\ncreated: 2026-10-01\nblocked-by: [nowhere.md]'),
		'blocked-by nowhere.md is in neither the folder nor its .archive/'
	],
	'notes.txt': ['Ring the bank.\n', 'a .txt has no front matter'],
	'bad-date.md': [front('scheduled: next week'), '`scheduled: YYYY-MM-DD`']
}

describe('ken task lint', () => {
	const files = {
		'canonical.md': CANONICAL,
		...Object.fromEntries(Object.entries(LOSSLESS).map(([rel, [before]]) => [rel, before])),
		...Object.fromEntries(Object.entries(NAMED).map(([rel, [text]]) => [rel, text]))
	}
	let t: ReturnType<typeof setup>
	let listed: ReturnType<typeof kenTask>
	let fixed: ReturnType<typeof kenTask>
	let again: ReturnType<typeof kenTask>
	beforeAll(() => {
		t = setup(files)
		listed = t.lint()
		fixed = t.lint('--fix')
		again = t.lint()
	}, 30_000)
	const lines = (r: { stdout: string }, rel: string) =>
		r.stdout.split('\n').filter((l) => l.startsWith(`${join(t.folder, rel)}: `))

	it('lists every deviation with its upgrade, path first, and exits 1; the canonical file not at all', () => {
		expect(listed.status).toBe(1)
		for (const [rel, [, , says]] of Object.entries(LOSSLESS)) {
			expect(lines(listed, rel).join('\n')).toContain(says)
			expect(lines(listed, rel).join('\n')).toContain('`ken task lint --fix` writes')
		}
		for (const [rel, [, says]] of Object.entries(NAMED)) {
			expect(lines(listed, rel).join('\n')).toContain(says)
		}
		expect(lines(listed, 'canonical.md')).toEqual([])
		// each line is a path, what deviates and the upgrade
		expect(
			listed.stdout
				.trimEnd()
				.split('\n')
				.every((l) => l.startsWith(`${t.folder}/`))
		).toBe(true)
	})

	it('--fix writes the lossless upgrades, each printed as done, and every other byte stays', () => {
		for (const [rel, [, after, says]] of Object.entries(LOSSLESS)) {
			expect(t.read(rel)).toBe(after)
			expect(lines(fixed, rel).join('\n')).toContain(says)
			expect(lines(fixed, rel).every((l) => /: wrote `[^`]+`$/.test(l))).toBe(true)
		}
	})

	it('--fix leaves the rest as they were and listed, and a second lint names only those', () => {
		expect(fixed.status).toBe(1)
		for (const [rel, [text]] of Object.entries(NAMED)) expect(t.read(rel)).toBe(text)
		expect(again.status).toBe(1)
		const named = Object.keys(NAMED).map((rel) => join(t.folder, rel))
		const paths = again.stdout
			.trimEnd()
			.split('\n')
			.map((l) => l.slice(0, l.indexOf(': ')))
		expect([...new Set(paths)].sort()).toEqual(named.sort())
		for (const rel of Object.keys(NAMED)) expect(lines(again, rel)).toEqual(lines(listed, rel))
	})

	it('never rewrites a canonical file', () => {
		expect(t.read('canonical.md')).toBe(CANONICAL)
		expect(statSync(join(t.folder, 'canonical.md')).mtime).toEqual(SEPT_15)
	})
})

// each test runs `ken task` several times
describe('ken task lint, on a clean folder', { timeout: 30_000 }, () => {
	it('prints nothing and exits 0 once fixed, --fix or not', () => {
		const t = setup({ 'a.md': CANONICAL, 'b.md': front('status: done\ncreated: 2026-10-01') })
		expect(t.lint()).toMatchObject({ status: 1 })
		expect(t.lint('--fix')).toMatchObject({ status: 0 })
		expect(t.lint()).toEqual({ status: 0, stdout: '', stderr: '' })
		expect(t.lint('--fix')).toEqual({ status: 0, stdout: '', stderr: '' })
	})

	it('takes created from the date git added the file, before its mtime', () => {
		const t = setup({ 'a.md': front('status: todo') })
		const git = (...args: string[]) =>
			spawnSync('git', ['-C', t.root, ...args], { encoding: 'utf8' }).status
		expect(git('init', '-q')).toBe(0)
		expect(git('add', '.')).toBe(0)
		expect(
			git(
				'-c',
				'user.name=t',
				'-c',
				'user.email=t@t',
				'commit',
				'-qm',
				'a',
				'--date=2026-08-01T12:00'
			)
		).toBe(0)
		expect(t.lint().stdout).toContain('taken from the date git added it')
		expect(t.lint('--fix').status).toBe(0)
		expect(t.read('a.md')).toBe(front('status: todo\ncreated: 2026-08-01'))
	})

	it('refuses an argument other than --fix, and carries examples in --help', () => {
		const t = setup({})
		expect(t.lint('--all')).toMatchObject({
			status: 1,
			stderr: expect.stringContaining('only --fix')
		})
		expect(t.lint('--help').stdout).toContain('Examples:')
	})
})
