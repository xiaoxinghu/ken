import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { localDate } from './list.ts'
import { kenTask, newRoot, write } from './testing.ts'

const today = localDate(new Date())

/** A root with `tasks/<rel>` holding `text`; `set` runs `ken task set <rel> ...` there. */
function setup(rel: string, text: string) {
	const root = newRoot()
	const path = join(root, 'tasks', rel)
	write(path, text)
	const set = (field: string, value: string, cwd = root) =>
		kenTask(root, ['set', `tasks/${rel}`, field, value], cwd)
	return { root, path, set, text: () => readFileSync(path, 'utf8') }
}

describe('ken task set', () => {
	it.each([
		['status', 'done', 'wontfix'],
		['repo', 'github.com/acme/web', 'github.com/acme/api'],
		['scheduled', '2026-12-01', '2027-01-02'],
		['due', '2026-12-01', '2027-01-02']
	])('sets, changes and removes %s, every other line as it was', (field, first, second) => {
		const { path, set, text } = setup('t.md', '---\nstatus: todo\nowner: me\n---\n# T\n')
		expect(set(field, first)).toEqual({
			status: 0,
			stdout: `${path}\n`,
			stderr: expect.any(String)
		})
		expect(text()).toContain(`${field}: ${first}\n`)
		expect(set(field, second).status).toBe(0)
		expect(text()).toContain(`${field}: ${second}\n`)
		expect(text()).not.toContain(first)
		expect(set(field, '').status).toBe(0)
		expect(text()).not.toContain(`${field}:`)
		expect(text()).toContain('owner: me\n---\n# T\n')
	})

	it('writes blocked-by typed from the root relative to the file, live or archived', () => {
		const { root, set, text } = setup('portal/t.md', '---\nstatus: todo\n---\n')
		write(join(root, 'tasks/portal/a.md'), '# A\n')
		write(join(root, 'tasks/ken/b.md'), '# B\n')
		write(join(root, 'tasks/.archive/old.md'), '---\nstatus: done\n---\n')
		expect(set('blocked-by', 'tasks/portal/a, tasks/ken/b.md,tasks/old').status).toBe(0)
		expect(text()).toContain('blocked-by: [a.md, ../ken/b.md, ../.archive/old.md]\n')
		const listed = JSON.parse(kenTask(root, ['list', '--json']).stdout)
		expect(listed.find((r: { title: string }) => r.title === 't')).toMatchObject({
			'blocked-by': ['a.md', '../ken/b.md', '../.archive/old.md'],
			unmet: [{ ref: 'a.md' }, { ref: '../ken/b.md' }],
			notes: []
		})
		expect(set('blocked-by', '').status).toBe(0)
		expect(text()).toBe('---\nstatus: todo\n---\n')
	})

	it('replaces a block list or an alias with the one-line blocked-by', () => {
		const { root, set, text } = setup(
			't.md',
			'---\ndepends_on: # was\n  - x.md\n\n# between\n  - y.md\n# after\nrepo: a/b/c\n---\n'
		)
		write(join(root, 'tasks/a.md'), '# A\n')
		expect(set('blocked-by', 'tasks/a.md').status).toBe(0)
		expect(text()).toBe('---\nblocked-by: [a.md] # was\n# after\nrepo: a/b/c\n---\n')
	})

	it('keeps the comment that ends a list over lines, and no # inside a quoted item', () => {
		const { root, set, text } = setup(
			't.md',
			'---\nblocked-by: [\n  "a # b.md",\n] # waiting\n---\n'
		)
		write(join(root, 'tasks/a.md'), '# A\n')
		expect(set('blocked-by', 'tasks/a.md').status).toBe(0)
		expect(text()).toBe('---\nblocked-by: [a.md] # waiting\n---\n')
		write(join(root, 'tasks/t.md'), '---\nblocked-by: ["a # b.md"]\n---\n')
		expect(set('blocked-by', 'tasks/a.md').status).toBe(0)
		expect(text()).toBe('---\nblocked-by: [a.md]\n---\n')
	})

	it('keeps the comment on a block scalar header', () => {
		const { set, text } = setup('t.md', '---\nstatus: |- # see the thread\n  todo\n---\n')
		expect(set('status', 'wontfix').status).toBe(0)
		expect(text()).toBe(`---\nstatus: wontfix # see the thread\nclosed: ${today}\n---\n`)
	})

	it('keeps the indentation of the front matter fields', () => {
		const { set, text } = setup('t.md', '---\n  status: todo # open\n  repo: a/b/c\n---\n')
		expect(set('status', 'done').status).toBe(0)
		expect(text()).toBe(`---\n  status: done # open\n  repo: a/b/c\n  closed: ${today}\n---\n`)
	})

	it('finds a field whose key is quoted, writing it back plain', () => {
		const { set, text } = setup(
			't.md',
			`---\n"status": done\n'closed': 2026-01-01\n"due": 2026-01-01\n---\n`
		)
		expect(set('due', '2026-02-02').status).toBe(0)
		expect(set('status', 'todo').status).toBe(0)
		expect(text()).toBe('---\nstatus: todo\ndue: 2026-02-02\n---\n')
	})

	it('refuses a blocker found nowhere, leaving the file as it was', () => {
		const { set, text } = setup('t.md', '---\nstatus: todo\n---\n')
		const r = set('blocked-by', 'tasks/nope')
		expect(r).toMatchObject({ status: 1, stdout: '' })
		expect(r.stderr).toContain('No task tasks/nope in')
		expect(text()).toBe('---\nstatus: todo\n---\n')
	})

	it('keeps a comment on the line, the space after the colon, and the unknown fields', () => {
		const { set, text } = setup('t.md', '---\nx: [1,  2] # kept\ndue:   2026-01-01  # hard\n---\n')
		expect(set('due', '2026-02-02').status).toBe(0)
		expect(text()).toBe('---\nx: [1,  2] # kept\ndue:   2026-02-02  # hard\n---\n')
	})

	it('inserts front matter into a file with none, the body untouched byte for byte', () => {
		const body = '﻿# T\r\n\r\n---\nstatus: done\n---\n  trailing  '
		const { set, text } = setup('t.md', body)
		expect(set('repo', 'github.com/acme/web').status).toBe(0)
		expect(text()).toBe(`﻿---\r\nrepo: github.com/acme/web\r\n---\r\n${body.slice(1)}`)
	})

	it('keeps each line its own ending when they are mixed', () => {
		const { set, text } = setup('t.md', '---\r\nstatus: todo\n---\n# T\r\n')
		expect(set('status', 'done').status).toBe(0)
		expect(text()).toBe(`---\r\nstatus: done\nclosed: ${today}\n---\n# T\r\n`)
		const crlf = setup('t.md', '---\nstatus: todo\r\n---\n')
		expect(crlf.set('due', '2026-01-01').status).toBe(0)
		expect(crlf.set('status', 'wontfix').status).toBe(0)
		expect(crlf.text()).toBe(`---\nstatus: wontfix\r\ndue: 2026-01-01\r\nclosed: ${today}\r\n---\n`)
	})

	it('keeps CRLF line endings', () => {
		const { set, text } = setup('t.md', '---\r\nstatus: todo\r\n---\r\n# T\r\n')
		expect(set('status', 'done').status).toBe(0)
		expect(text()).toBe(`---\r\nstatus: done\r\nclosed: ${today}\r\n---\r\n# T\r\n`)
	})

	it('writes closed on done or wontfix, removes it on todo, and says to distil on done', () => {
		const { path, set, text } = setup('t.md', '# T\n')
		const done = set('status', 'done')
		expect(done.stderr).toContain(`\`ken path "${path}"\``)
		expect(text()).toBe(`---\nstatus: done\nclosed: ${today}\n---\n# T\n`)
		expect(set('status', 'todo').status).toBe(0)
		expect(text()).toBe('---\nstatus: todo\n---\n# T\n')
		expect(set('status', 'wontfix').status).toBe(0)
		expect(text()).toBe(`---\nstatus: wontfix\nclosed: ${today}\n---\n# T\n`)
	})

	it.each([
		['status', 'finished', 'one of todo, done, wontfix'],
		['due', '2026-02-30', 'a date, YYYY-MM-DD'],
		['scheduled', 'tomorrow', 'a date, YYYY-MM-DD'],
		['repo', 'acme/web', 'a repo key, <host>/<owner>/<repo>'],
		['repo', 'GitHub.com/acme/web', 'a repo key, <host>/<owner>/<repo>']
	])('refuses %s %s, naming the format', (field, value, format) => {
		const { set, text } = setup('t.md', '# T\n')
		const r = set(field, value)
		expect(r).toMatchObject({ status: 1, stdout: '' })
		expect(r.stderr).toContain(`is not ${format}`)
		expect(text()).toBe('# T\n')
	})

	it('refuses an unknown field, listing the five', () => {
		const r = setup('t.md', '# T\n').set('closed', '2026-01-01')
		expect(r.status).toBe(1)
		expect(r.stderr).toContain('status, repo, blocked-by, scheduled, due')
	})

	it('refuses a .txt, saying to make it a .md', () => {
		const { path, set, text } = setup('t.txt', 'T\n')
		const r = set('status', 'done')
		expect(r.status).toBe(1)
		expect(r.stderr).toContain(`\`mv "${path}" "${path.slice(0, -4)}.md"\``)
		expect(text()).toBe('T\n')
	})

	it.each([
		[
			'a front matter that is one {...} mapping',
			'---\n{status: todo, repo: a/b/c, owner: me}\n---\n',
			'write each field as `field: value` on a line of its own'
		],
		['unclosed front matter', '---\nstatus: todo\n# T\n', 'add a `---` line after the last field'],
		[
			'front matter that is not YAML',
			'---\ntitle: Issue: 12\n---\n',
			'fix that line, or quote its value'
		],
		['a field written twice', '---\nblocked-by: [a.md]\ndepends_on: [a.md]\n---\n', 'keep one']
	])('refuses %s with the fix, writing nothing', (_, before, fix) => {
		const { set, text } = setup('t.md', before)
		const r = set('status', 'done')
		expect(r).toMatchObject({ status: 1, stdout: '' })
		expect(r.stderr).toContain(fix)
		expect(text()).toBe(before)
	})

	it('carries examples in --help', () => {
		const r = kenTask(newRoot(), ['set', '--help'])
		expect(r.status).toBe(0)
		expect(r.stdout).toContain('Examples:\n  ken task set ')
	})
})
