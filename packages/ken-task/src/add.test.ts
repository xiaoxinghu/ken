import { execFileSync, spawn } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, symlinkSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { day, env, ken, kenTask, newRoot, write } from './testing.ts'

const canonical = (heading: string, ...fields: string[]) =>
	['---', 'status: todo', `created: ${day(0)}`, ...fields, '---', '', `# ${heading}`, ''].join('\n')

describe('ken task add', () => {
	it('makes the canonical file in the folder, folders on the way, and prints its path', () => {
		const root = newRoot()
		const file = join(root, 'tasks/portal/fix-login.md')
		expect(kenTask(root, ['add', 'portal/fix-login'])).toEqual({
			status: 0,
			stdout: `${file}\n`,
			stderr: ''
		})
		expect(readFileSync(file, 'utf8')).toBe(canonical('fix login'))
		// the canonical file reads back as a ready task, with no flag
		const [row] = JSON.parse(kenTask(root, ['list', '--json']).stdout)
		expect(row).toMatchObject({ path: file, state: 'ready', notes: [] })
	})

	it('lowercases and turns spaces to dashes, saying so', () => {
		const root = newRoot()
		const r = kenTask(root, ['add', 'Fix Login'])
		expect(r).toMatchObject({ status: 0, stdout: `${join(root, 'tasks/fix-login.md')}\n` })
		expect(r.stderr).toContain('Fix Login is named fix-login.md')
	})

	it('refuses other punctuation, naming the path to use', () => {
		const root = newRoot()
		const r = kenTask(root, ['add', 'portal/fix: login!'])
		expect(r).toMatchObject({ status: 1, stdout: '' })
		expect(r.stderr).toContain(`ken task add ${join(root, 'tasks/portal/fix-login')}`)
		expect(existsSync(join(root, 'tasks'))).toBe(false)
	})

	it('refuses a task that exists, or another extension of its name, naming the file', () => {
		const root = newRoot()
		const md = join(root, 'tasks/portal/fix-login.md')
		kenTask(root, ['add', 'portal/fix-login'])
		const again = kenTask(root, ['add', 'portal/fix-login'])
		expect(again).toMatchObject({ status: 1, stdout: '' })
		expect(again.stderr).toContain(`${md} exists`)
		const txt = kenTask(root, ['add', 'portal/fix-login.txt'])
		expect(txt).toMatchObject({ status: 1, stdout: '' })
		expect(txt.stderr).toContain(`${md} exists`)
		expect(readdirSync(join(root, 'tasks/portal'))).toEqual(['fix-login.md'])
	})

	it('refuses a path outside the folder, naming the folder', () => {
		const root = newRoot()
		const r = kenTask(root, ['add', '../elsewhere'])
		expect(r).toMatchObject({ status: 1, stdout: '' })
		expect(r.stderr).toContain(`is not in the task folder ${join(root, 'tasks')}`)
	})

	it('refuses a normalised path that a link leads out of the folder, writing nothing', () => {
		const root = newRoot()
		const away = join(root, 'away')
		mkdirSync(away)
		mkdirSync(join(root, 'tasks'))
		symlinkSync(away, join(root, 'tasks/my-project'))
		const r = kenTask(root, ['add', 'My Project/new-task'])
		expect(r).toMatchObject({ status: 1, stdout: '' })
		expect(r.stderr).toContain(`is not in the task folder ${join(root, 'tasks')}`)
		expect(readdirSync(away)).toEqual([])
	})

	it('writes a blocker typed from here relative to the new file', () => {
		const root = newRoot()
		write(join(root, 'tasks/ken/x.md'), '# X\n')
		mkdirSync(join(root, 'tasks/portal'))
		const r = kenTask(
			root,
			['add', 'deep/fix-login', '-b', '../ken/x.md'],
			join(root, 'tasks/portal')
		)
		expect(r.status).toBe(0)
		expect(readFileSync(join(root, 'tasks/portal/deep/fix-login.md'), 'utf8')).toBe(
			canonical('fix login', 'blocked-by: [../../ken/x.md]')
		)
	})

	it('refuses a blocker found nowhere, writing nothing', () => {
		const root = newRoot()
		const r = kenTask(root, ['add', 'fix-login', '-b', 'nowhere'])
		expect(r).toMatchObject({ status: 1, stdout: '' })
		expect(r.stderr).toContain('No task nowhere')
		expect(existsSync(join(root, 'tasks/fix-login.md'))).toBe(false)
	})

	it('refuses a -r that is no repo key', () => {
		const root = newRoot()
		const r = kenTask(root, ['add', 'fix-login', '-r', 'portal'])
		expect(r).toMatchObject({ status: 1, stdout: '' })
		expect(r.stderr).toContain('is not a repo key')
	})

	it("writes the repo of the clone it runs in, saying so, and -r's over it", () => {
		const root = newRoot()
		const clone = join(root, '.repos/github.com/acme/portal')
		mkdirSync(clone, { recursive: true })
		execFileSync('git', ['init', '-q', clone])
		const r = kenTask(root, ['add', 'fix-login'], clone)
		expect(r.status).toBe(0)
		expect(r.stderr).toContain('repo: github.com/acme/portal')
		expect(readFileSync(join(root, 'tasks/fix-login.md'), 'utf8')).toBe(
			canonical('fix login', 'repo: github.com/acme/portal')
		)
		kenTask(root, ['add', 'other', '-r', 'github.com/acme/api'], clone)
		expect(readFileSync(join(root, 'tasks/other.md'), 'utf8')).toBe(
			canonical('other', 'repo: github.com/acme/api')
		)
	})

	it('of two adds of one path at once, exactly one wins', async () => {
		const root = newRoot()
		const run = () =>
			new Promise<number | null>((done) =>
				spawn(process.execPath, [ken, 'task', 'add', 'race'], { cwd: root, env: env(root) }).on(
					'close',
					done
				)
			)
		const codes = await Promise.all([run(), run(), run(), run()])
		expect(codes.sort()).toEqual([0, 1, 1, 1])
	})
})
