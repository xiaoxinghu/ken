import { existsSync, readFileSync, symlinkSync, utimesSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { git } from './git.ts'
import { day, kenTask, newRoot, write } from './testing.ts'

const front = (text: string) => `---\n${text}\n---\n`

describe('ken task archive', () => {
	it('moves a closed task to its relative path in .archive/, where path still finds it', () => {
		const root = newRoot()
		write(join(root, 'tasks/web/fix-login.md'), front('status: done'))
		const archived = join(root, 'tasks/.archive/web/fix-login.md')
		expect(kenTask(root, ['archive', 'tasks/web/fix-login'])).toEqual({
			status: 0,
			stdout: `${archived}\n`,
			stderr: ''
		})
		expect(existsSync(join(root, 'tasks/web/fix-login.md'))).toBe(false)
		expect(kenTask(root, ['path', 'tasks/web/fix-login']).stdout).toBe(`${archived}\n`)
	})

	it('refuses every task before moving any when one is open, naming set status done', () => {
		const root = newRoot()
		write(join(root, 'tasks/closed.md'), front('status: wontfix'))
		write(join(root, 'tasks/open.md'), '# Open\n')
		write(join(root, 'tasks/unknown.md'), front('status: closed'))
		for (const open of ['open.md', 'unknown.md']) {
			const r = kenTask(root, ['archive', 'tasks/closed.md', `tasks/${open}`])
			expect(r.status).toBe(1)
			expect(r.stderr).toContain(`\`ken task set ${join(root, 'tasks', open)} status done\``)
		}
		expect(existsSync(join(root, 'tasks/closed.md'))).toBe(true)
		expect(existsSync(join(root, 'tasks/.archive'))).toBe(false)
	})

	it('archives a second fix-login.md beside the first as fix-login-2.md, and says so', () => {
		const root = newRoot()
		write(join(root, 'tasks/.archive/fix-login.md'), front('status: done\nold: true'))
		write(join(root, 'tasks/fix-login.md'), front('status: done'))
		const r = kenTask(root, ['archive', 'tasks/fix-login.md'])
		expect(r).toMatchObject({
			status: 0,
			stdout: `${join(root, 'tasks/.archive/fix-login-2.md')}\n`
		})
		expect(r.stderr).toContain('fix-login-2.md')
		expect(readFileSync(join(root, 'tasks/.archive/fix-login.md'), 'utf8')).toContain('old: true')
		expect(kenTask(root, ['archive', 'tasks/.archive/fix-login.md']).status).toBe(1)
	})

	it('leaves a dependent of an archived blocker ready, its file untouched', () => {
		const root = newRoot()
		write(join(root, 'tasks/a.md'), front('status: done'))
		const dependent = front('blocked-by: [a.md]')
		write(join(root, 'tasks/b.md'), dependent)
		expect(kenTask(root, ['archive', 'tasks/a.md']).status).toBe(0)
		expect(kenTask(root, ['ready']).stdout).toBe(`${join(root, 'tasks/b.md')}\n`)
		expect(readFileSync(join(root, 'tasks/b.md'), 'utf8')).toBe(dependent)
	})

	it('archives a relative link so it still reaches its file', () => {
		const root = newRoot()
		write(join(root, 'records/a.md'), front('status: done'))
		write(join(root, 'tasks/b.md'), front('blocked-by: [a.md]'))
		symlinkSync('../records/a.md', join(root, 'tasks/a.md'))
		expect(kenTask(root, ['archive', 'tasks/a.md']).status).toBe(0)
		const archived = join(root, 'tasks/.archive/a.md')
		expect(readFileSync(archived, 'utf8')).toBe(front('status: done'))
		expect(kenTask(root, ['path', 'tasks/a']).stdout).toBe(`${archived}\n`)
		expect(kenTask(root, ['ready']).stdout).toBe(`${join(root, 'tasks/b.md')}\n`)
	})

	it('carries examples in --help', () => {
		const root = newRoot()
		expect(kenTask(root, ['archive', '--help']).stdout).toContain('Examples:')
		expect(kenTask(root, ['purge', '--help']).stdout).toContain('Examples:')
	})
})

describe('ken task purge', () => {
	/** A root with archived tasks closed 40 and 10 days ago, by `closed` and by mtime. */
	function setup() {
		const root = newRoot()
		const archive = join(root, 'tasks/.archive')
		write(join(archive, 'old.md'), front(`status: done\nclosed: ${day(-40)}`))
		write(join(archive, 'recent.md'), front(`status: done\nclosed: ${day(-10)}`))
		for (const [name, offset] of [
			['web/old-mtime.md', -40],
			['recent-mtime.md', -10]
		] as const) {
			write(join(archive, name), '# No closed\n')
			const mtime = new Date(Date.now() + offset * 864e5)
			utimesSync(join(archive, name), mtime, mtime)
		}
		return { root, archive }
	}

	it('deletes what was closed, else modified, before the cutoff, and says nothing holds a copy outside git', () => {
		const { root, archive } = setup()
		const r = kenTask(root, ['purge', '--older-than', '30'])
		expect(r.status).toBe(0)
		expect(r.stdout.split('\n').filter(Boolean).sort()).toEqual([
			join(archive, 'old.md'),
			join(archive, 'web/old-mtime.md')
		])
		expect(r.stderr).toContain('is in no git work tree, so nothing else holds a copy')
		expect(existsSync(join(archive, 'recent.md'))).toBe(true)
		expect(existsSync(join(archive, 'recent-mtime.md'))).toBe(true)
	})

	it('says the git history holds a copy when the folder is in a work tree', () => {
		const { root } = setup()
		git(root, 'init', '-q')
		const r = kenTask(root, ['purge', '--older-than', '30'])
		expect(r.status).toBe(0)
		expect(r.stderr.trim().split('\n')).toEqual([
			expect.stringContaining(`is in the git work tree ${root}, so its history holds`)
		])
	})

	// a million days reaches before the year 1000; a billion, past any date there is
	it.each([[[]], [['--older-than', '1000000']], [['--older-than', '1000000000']]])(
		'refuses %j, deleting nothing: --older-than is required, and must end after the year 1000',
		(args: string[]) => {
			const { root, archive } = setup()
			const r = kenTask(root, ['purge', ...args])
			expect(r.status).toBe(1)
			expect(r.stderr).toContain('`ken task purge --older-than ')
			expect(existsSync(join(archive, 'old.md'))).toBe(true)
		}
	)
})
