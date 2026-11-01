import { chmodSync, existsSync, readFileSync, symlinkSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { kenTask, newRoot, write } from './testing.ts'

/** A root whose tasks folder holds `files`, by path in the folder. */
function setup(files: Record<string, string>) {
	const root = newRoot()
	const tasks = join(root, 'tasks')
	for (const [rel, text] of Object.entries(files)) write(join(tasks, rel), text)
	return {
		root,
		tasks,
		read: (rel: string) => readFileSync(join(tasks, rel), 'utf8'),
		rename: (from: string, to: string) => kenTask(root, ['rename', from, to]),
		/** Each listed task's blockers that do not resolve as written, and its notes. */
		unresolved: () =>
			(
				JSON.parse(kenTask(root, ['list', '--json']).stdout) as {
					unmet: { reason: string }[]
					notes: string[]
				}[]
			).flatMap((r) => [...r.unmet.filter((u) => u.reason === 'missing'), ...r.notes])
	}
}

describe('ken task rename', () => {
	it('moves the file within its folder and rewrites a sibling that named it', () => {
		const t = setup({
			'old.md': '---\nstatus: todo\n---\n# Old heading\n',
			'b.md': '---\nstatus: todo\nblocked-by: [old.md]\n---\n# B\n'
		})
		expect(t.rename('tasks/old', 'new')).toEqual({
			status: 0,
			stdout: `${join(t.tasks, 'new.md')}\n`,
			stderr: ''
		})
		expect(existsSync(join(t.tasks, 'old.md'))).toBe(false)
		// the heading is content, left alone
		expect(t.read('new.md')).toBe('---\nstatus: todo\n---\n# Old heading\n')
		expect(t.read('b.md')).toBe('---\nstatus: todo\nblocked-by: [new.md]\n---\n# B\n')
		expect(kenTask(t.root, ['rename', '--help']).stdout).toContain('Examples:')
	})

	it('into another folder, rewrites references to it and its own, so both still resolve', () => {
		const t = setup({
			'ken/old.md': '---\nblocked-by: [x.md]\n---\n',
			'ken/x.md': '# X\n',
			'ken/dep.md': '---\nblocked-by: [old.md, x.md]\n---\n'
		})
		expect(t.rename('tasks/ken/old.md', 'portal/new').status).toBe(0)
		expect(t.read('ken/dep.md')).toBe('---\nblocked-by: [../portal/new.md, x.md]\n---\n')
		expect(t.read('portal/new.md')).toBe('---\nblocked-by: [../ken/x.md]\n---\n')
		expect(t.unresolved()).toEqual([])
	})

	it('keeps the comment and the other values on a rewritten line', () => {
		const t = setup({
			'old.md': '# Old\n',
			'a.md': '# A\n',
			'b.md': '---\nblocked-by: [a.md, old.md] # both first\nrepo: a/b/c\n---\n'
		})
		expect(t.rename('tasks/old.md', 'new').status).toBe(0)
		expect(t.read('b.md')).toBe('---\nblocked-by: [a.md, new.md] # both first\nrepo: a/b/c\n---\n')
	})

	it('leaves an archived file that named the old name as it was', () => {
		const archived = '---\nstatus: done\nblocked-by: [../old.md]\n---\n'
		const t = setup({ 'old.md': '# Old\n', '.archive/gone.md': archived })
		expect(t.rename('tasks/old.md', 'new').status).toBe(0)
		expect(t.read('.archive/gone.md')).toBe(archived)
	})

	it('refuses a target that exists, naming it, and changes nothing', () => {
		const t = setup({
			'old.md': '# Old\n',
			'taken.txt': '# Taken\n',
			'b.md': '---\nblocked-by: [old.md]\n---\n'
		})
		const r = t.rename('tasks/old.md', 'taken')
		expect(r).toMatchObject({ status: 1, stdout: '' })
		expect(r.stderr).toContain(`${join(t.tasks, 'taken.txt')} exists`)
		expect(r.stderr).toContain(`ken task rename ${join(t.tasks, 'old.md')} <another path>`)
		expect(t.read('old.md')).toBe('# Old\n')
		expect(t.read('b.md')).toBe('---\nblocked-by: [old.md]\n---\n')
	})

	it('undoes what it wrote when a write fails midway, so nothing is renamed', () => {
		const t = setup({
			'old.md': '# Old\n',
			'a.md': '---\nblocked-by: [old.md]\n---\n',
			'z/b.md': '---\nblocked-by: [../old.md]\n---\n'
		})
		// a.md is written first; z/b.md cannot be, its folder taking no new file
		chmodSync(join(t.tasks, 'z'), 0o555)
		const r = t.rename('tasks/old.md', 'new')
		chmodSync(join(t.tasks, 'z'), 0o755)
		expect(r).toMatchObject({ status: 1, stdout: '' })
		expect(r.stderr).toContain('nothing is renamed')
		expect(t.read('a.md')).toBe('---\nblocked-by: [old.md]\n---\n')
		expect(t.read('old.md')).toBe('# Old\n')
		expect(existsSync(join(t.tasks, 'new.md'))).toBe(false)
	})

	it('refuses when a link names it, since the file behind a link may be archived', () => {
		// read through the link at tasks/b.md, old.md is the task being renamed
		const archived = '---\nblocked-by: [old.md]\n---\n'
		const t = setup({ 'old.md': '# Old\n', '.archive/b.md': archived })
		symlinkSync(join(t.tasks, '.archive/b.md'), join(t.tasks, 'b.md'))
		const r = t.rename('tasks/old.md', 'new')
		expect(r).toMatchObject({ status: 1, stdout: '' })
		expect(r.stderr).toContain(`${join(t.tasks, 'b.md')} names ${join(t.tasks, 'old.md')}`)
		expect(t.read('.archive/b.md')).toBe(archived)
		expect(existsSync(join(t.tasks, 'new.md'))).toBe(false)
	})

	it('refuses while a live task cannot be read, since it may name the task', () => {
		const t = setup({ 'old.md': '# Old\n', 'b.md': '---\nblocked-by: [old.md]\n---\n' })
		chmodSync(join(t.tasks, 'b.md'), 0o000)
		const r = t.rename('tasks/old.md', 'new')
		chmodSync(join(t.tasks, 'b.md'), 0o644)
		expect(r).toMatchObject({ status: 1, stdout: '' })
		expect(r.stderr).toContain(`${join(t.tasks, 'b.md')} cannot be read`)
		expect(t.read('old.md')).toBe('# Old\n')
		expect(t.read('b.md')).toBe('---\nblocked-by: [old.md]\n---\n')
		expect(existsSync(join(t.tasks, 'new.md'))).toBe(false)
	})

	it('moves a file that is not UTF-8 byte for byte', () => {
		const t = setup({})
		// Latin-1 "café", which UTF-8 would read as a replacement character
		const bytes = Buffer.from([0x63, 0x61, 0x66, 0xe9, 0x0a])
		write(join(t.tasks, 'old.txt'), bytes)
		expect(t.rename('tasks/old.txt', 'new').status).toBe(0)
		expect(readFileSync(join(t.tasks, 'new.md'))).toEqual(bytes)
	})

	it('refuses while a link leads to the task, since the move would leave it pointing nowhere', () => {
		const t = setup({ 'old.md': '# Old\n', 'b.md': '---\nblocked-by: [alias.md]\n---\n' })
		symlinkSync(join(t.tasks, 'old.md'), join(t.tasks, 'alias.md'))
		const r = t.rename('tasks/old.md', 'new')
		expect(r).toMatchObject({ status: 1, stdout: '' })
		expect(r.stderr).toContain(
			`${join(t.tasks, 'alias.md')} is a link to ${join(t.tasks, 'old.md')}`
		)
		expect(t.read('old.md')).toBe('# Old\n')
		expect(existsSync(join(t.tasks, 'new.md'))).toBe(false)
	})

	it('refuses while a live task cannot be fully read, since what it names is unknown', () => {
		const broken = '---\nblocked-by: [old.md]\nnote: [unclosed\n---\n'
		const t = setup({ 'old.md': '# Old\n', 'b.md': broken })
		const r = t.rename('tasks/old.md', 'new')
		expect(r).toMatchObject({ status: 1, stdout: '' })
		expect(r.stderr).toContain(`${join(t.tasks, 'b.md')} could not be fully read`)
		expect(t.read('old.md')).toBe('# Old\n')
		expect(t.read('b.md')).toBe(broken)
	})

	it('refuses a file whose text would read as other fields once it is a .md', () => {
		const text = '---\nblocked-by: [x.md]\n---\n'
		const t = setup({ 'old.txt': text, 'x.md': '# X\n' })
		const r = t.rename('tasks/old.txt', 'other/new')
		expect(r).toMatchObject({ status: 1, stdout: '' })
		expect(r.stderr).toContain(`${join(t.tasks, 'old.txt')} would read differently as new.md`)
		expect(t.read('old.txt')).toBe(text)
		expect(existsSync(join(t.tasks, 'other/new.md'))).toBe(false)
	})
})
