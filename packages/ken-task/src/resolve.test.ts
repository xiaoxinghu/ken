import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { kenTask, newRoot, write } from './testing.ts'

describe('ken task path', () => {
	let root: string
	let folder: string
	let task: string
	beforeAll(() => {
		root = newRoot()
		folder = join(root, 'tasks')
		task = join(folder, 'portal/print.md')
		write(task, '# Print\n')
		write(join(folder, '.archive/old.md'), '---\nstatus: done\n---\n')
		write(join(folder, '.archive/gone-2.md'), '---\nstatus: done\n---\n')
		write(join(folder, 'two.md'), '# Two\n')
		write(join(folder, 'two.txt'), 'Two\n')
		write(join(folder, 'README.md'), '# Conventions\n')
		write(join(root, 'notes.md'), '# Not a task\n')
		mkdirSync(join(root, 'elsewhere'))
	})
	const path = (arg: string, cwd = root) => kenTask(root, ['path', arg], cwd)

	it.each([
		['absolute', () => [task, join(root, 'elsewhere')]],
		['from inside the folder', () => ['print.md', join(folder, 'portal')]],
		['from inside the folder, without .md', () => ['print', join(folder, 'portal')]],
		['from the root', () => ['tasks/portal/print.md', join(root, 'elsewhere')]],
		['from the root, without .md', () => ['tasks/portal/print', join(root, 'elsewhere')]]
	])('reaches one task by any path: %s', (_, args) => {
		const [arg = '', cwd] = args()
		expect(path(arg, cwd)).toEqual({ status: 0, stdout: `${task}\n`, stderr: '' })
	})

	it('finds an archived task by its live name, at any suffix, and by its archive path', () => {
		expect(path('tasks/old.md').stdout).toBe(`${join(folder, '.archive/old.md')}\n`)
		expect(path('tasks/gone.md').stdout).toBe(`${join(folder, '.archive/gone-2.md')}\n`)
		expect(path('tasks/.archive/old').stdout).toBe(`${join(folder, '.archive/old.md')}\n`)
	})

	it('refuses a path outside the folder, naming the folder', () => {
		for (const arg of ['notes.md', '../x.md', 'tasks']) {
			const r = path(arg)
			expect(r).toMatchObject({ status: 1, stdout: '' })
			expect(r.stderr).toContain(`is not in the task folder ${folder}`)
		}
	})

	it('exits 1 on a task found nowhere, naming the folder and ken task list', () => {
		for (const arg of ['tasks/nope.md', 'tasks/README.md']) {
			const r = path(arg)
			expect(r).toMatchObject({ status: 1, stdout: '' })
			expect(r.stderr).toContain(`No task ${arg} in ${folder}`)
			expect(r.stderr).toContain('`ken task list`')
		}
	})

	it('refuses a stem two files share, naming both', () => {
		const r = path('tasks/two')
		expect(r).toMatchObject({ status: 1, stdout: '' })
		expect(r.stderr).toContain('two.md, two.txt')
	})
})
