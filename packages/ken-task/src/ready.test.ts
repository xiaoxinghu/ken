import { utimesSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { day, kenTask, newRoot, write } from './testing.ts'

type Row = { path: string; state: string; due?: string; created?: string }

const front = (text: string) => `---\n${text}\n---\n`

describe('ken task ready', () => {
	it('prints ready tasks by earliest due, then earliest created, then path', () => {
		const root = newRoot()
		const folder = join(root, 'tasks')
		const task = (rel: string, text: string) => write(join(folder, rel), text)
		task('due-late.md', front(`due: ${day(10)}\ncreated: 2026-01-01`))
		task('due-early.md', front(`due: ${day(5)}\ncreated: 2026-09-01`))
		task('created-new.md', front('created: 2026-02-01'))
		task('created-old.md', front('created: 2026-01-01'))
		task('tie-b.md', front('created: 2026-03-01'))
		task('tie-a.md', front('created: 2026-03-01'))
		// no created: its mtime stands in
		task('touched.md', '# Touched\n')
		const mtime = new Date(2026, 1, 15, 12)
		utimesSync(join(folder, 'touched.md'), mtime, mtime)
		task('blocked.md', front('blocked-by: [nowhere.md]'))
		task('finished.md', front('status: done'))
		task('later.md', front(`scheduled: ${day(1)}`))
		const r = kenTask(root, ['ready'])
		const order = [
			'due-early',
			'due-late',
			'created-old',
			'created-new',
			'touched',
			'tie-a',
			'tie-b'
		].map((name) => join(folder, `${name}.md`))
		expect(r).toEqual({ status: 0, stdout: `${order.join('\n')}\n`, stderr: '' })
		// list --json carries what it takes to sort the ready rows in the same order
		const rows = JSON.parse(kenTask(root, ['list', '--json']).stdout) as Row[]
		const key = (row: Row) => [row.due ?? '~', row.created ?? '~', row.path].join('\0')
		const sorted = rows
			.filter((row) => row.state === 'ready')
			.sort((a, b) => (key(a) < key(b) ? -1 : 1))
		expect(sorted.map((row) => row.path)).toEqual(order)
	})

	it('prints nothing and exits 0 when nothing is ready, pointing at ken task list', () => {
		const root = newRoot()
		write(join(root, 'tasks/finished.md'), front('status: done'))
		const r = kenTask(root, ['ready'])
		expect(r).toMatchObject({ status: 0, stdout: '' })
		expect(r.stderr.trim().split('\n')).toHaveLength(1)
		expect(r.stderr).toContain('Run `ken task list` to see what each task waits on')
	})
})
