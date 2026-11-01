// `ken task claim` against a local repo cloned into the layout with `ken get`, whose
// .ken.yaml copies a file into each new worktree and runs a setup there.
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { git } from './git.ts'
import { dir, env, ken, kenGet, kenTask, newRoot, write } from './testing.ts'

const KEY = 'example.com/acme/portal'
const TASK = 'tasks/portal/fix-login.md'

// `ken get <key>` clones https://example.com/acme/portal.git from this repo
beforeAll(() => {
	const remote = join(dir, 'remotes/acme/portal.git')
	mkdirSync(remote, { recursive: true })
	git(remote, 'init', '-q', '-b', 'main')
	writeFileSync(join(remote, '.ken.yaml'), 'copy: [.env]\nsetup: echo set up; pwd > setup-ran\n')
	git(remote, 'add', '.')
	git(remote, '-c', 'user.name=T', '-c', 'user.email=t@example.com', 'commit', '-q', '-m', 'init')
})

/** A root with the clone of KEY, its .env made, and a task file for each of `tasks`. */
function setup(tasks: Record<string, string>) {
	const root = newRoot()
	const clone = kenGet(root, KEY)
	writeFileSync(join(clone, '.env'), 'SECRET=1\n')
	for (const [rel, front] of Object.entries(tasks)) write(join(root, rel), `---\n${front}\n---\n`)
	return {
		root,
		clone,
		state: (rel: string) =>
			(
				JSON.parse(kenTask(root, ['list', '--json']).stdout) as { path: string; state: string }[]
			).find((r) => r.path === join(root, rel))?.state,
		branches: () => git(clone, 'for-each-ref', '--format=%(refname:lstrip=2)', 'refs/heads/')
	}
}

/** `ken task <args>` in `root`, run in the background, so two can race. */
const race = (root: string, args: string[]) =>
	new Promise<{ status: number | null; stdout: string; stderr: string }>((done) => {
		const child = spawn(process.execPath, [ken, 'task', ...args], { cwd: root, env: env(root) })
		let stdout = ''
		let stderr = ''
		child.stdout.on('data', (d) => {
			stdout += d
		})
		child.stderr.on('data', (d) => {
			stderr += d
		})
		child.on('close', (status) => done({ status, stdout, stderr }))
	})

describe('ken task claim', { timeout: 60_000 }, () => {
	it('makes the branch and its worktree, copies, runs setup, prints only the path', () => {
		const t = setup({ [TASK]: `repo: ${KEY}` })
		const r = kenTask(t.root, ['claim', TASK])
		const worktree = `${t.clone}.portal-fix-login`
		expect(r).toMatchObject({ status: 0, stdout: `${worktree}\n` })
		expect(r.stderr).toContain('set up')
		expect(git(worktree, 'branch', '--show-current')).toBe('portal/fix-login')
		expect(readFileSync(join(worktree, '.env'), 'utf8')).toBe('SECRET=1\n')
		expect(readFileSync(join(worktree, 'setup-ran'), 'utf8').trim()).toBe(worktree)
		expect(t.state(TASK)).toBe('claimed')
		expect(kenTask(t.root, ['claim', '--help']).stdout).toContain('Examples:')
	})

	it('without a task, claims the first ready one with a repo, past a blocked one and one with none', () => {
		const t = setup({
			'tasks/a-blocked.md': `repo: ${KEY}\nblocked-by: [nowhere.md]\ncreated: 2026-01-01`,
			'tasks/b-no-repo.md': 'created: 2026-01-02',
			'tasks/c-gone.md': 'repo: example.com/acme/gone\ncreated: 2026-01-03',
			'tasks/d-target.md': `repo: ${KEY}\ncreated: 2026-01-04`
		})
		const r = kenTask(t.root, ['claim'])
		expect(r).toMatchObject({ status: 0, stdout: `${t.clone}.d-target\n` })
		expect(t.branches().split('\n')).toEqual(['d-target', 'main'])

		const none = kenTask(t.root, ['claim'])
		expect(none).toMatchObject({ status: 1, stdout: '' })
		expect(none.stderr).toContain('No ready task with a repo cloned here is left to claim')
		expect(none.stderr).toContain('`ken task list`')
	})

	it('refuses a task that is not ready, with its state and what it waits on', () => {
		const t = setup({
			'tasks/blocked.md': `repo: ${KEY}\nblocked-by: [open.md]`,
			'tasks/open.md': `repo: ${KEY}`,
			'tasks/finished.md': `status: done\nrepo: ${KEY}`
		})
		const refused = (rel: string) => {
			const r = kenTask(t.root, ['claim', rel])
			expect(r).toMatchObject({ status: 1, stdout: '' })
			return r.stderr
		}
		expect(refused('tasks/blocked.md')).toContain('is blocked, waiting on open.md (open)')
		expect(refused('tasks/finished.md')).toContain('is done, and only a ready task can be claimed')
		expect(kenTask(t.root, ['claim', 'tasks/open.md']).status).toBe(0)
		expect(refused('tasks/open.md')).toContain(
			`is claimed: its branch open exists in ${KEY}. Work in its worktree, \`cd "$(ken get ${KEY} -b open)"\``
		)
		expect(t.branches().split('\n')).toEqual(['main', 'open'])
	})

	it('refuses a task with no repo, or a repo not cloned here, with the command to run', () => {
		const t = setup({
			'tasks/no-repo.md': 'status: todo',
			'tasks/gone.md': 'repo: example.com/acme/gone'
		})
		const noRepo = kenTask(t.root, ['claim', 'tasks/no-repo.md'])
		expect(noRepo).toMatchObject({ status: 1, stdout: '' })
		expect(noRepo.stderr).toContain(
			`\`ken task set ${join(t.root, 'tasks/no-repo.md')} repo <host>/<owner>/<repo>\``
		)
		const gone = kenTask(t.root, ['claim', 'tasks/gone.md'])
		expect(gone).toMatchObject({ status: 1, stdout: '' })
		expect(gone.stderr).toContain('Run `ken get example.com/acme/gone`, which clones it')
	})

	it("refuses a plain folder where the clone belongs, leaving the root's own repo alone", () => {
		const root = newRoot()
		git(root, 'init', '-q', '-b', 'main')
		git(
			root,
			'-c',
			'user.name=T',
			'-c',
			'user.email=t@example.com',
			'commit',
			'-q',
			'--allow-empty',
			'-m',
			'init'
		)
		mkdirSync(join(root, '.repos/example.com/acme/plain'), { recursive: true })
		write(join(root, 'tasks/plain.md'), '---\nrepo: example.com/acme/plain\n---\n')
		const r = kenTask(root, ['claim', 'tasks/plain.md'])
		expect(r).toMatchObject({ status: 1, stdout: '' })
		expect(r.stderr).toContain('Run `ken get example.com/acme/plain`')
		expect(kenTask(root, ['claim'])).toMatchObject({ status: 1, stdout: '' })
		expect(git(root, 'for-each-ref', '--format=%(refname:lstrip=2)', 'refs/heads/')).toBe('main')
	})

	it('refuses a link to a repo elsewhere where the clone belongs, leaving that repo alone', () => {
		const root = newRoot()
		const elsewhere = join(root, 'elsewhere')
		mkdirSync(elsewhere)
		git(elsewhere, 'init', '-q', '-b', 'main')
		git(
			elsewhere,
			'-c',
			'user.name=T',
			'-c',
			'user.email=t@example.com',
			'commit',
			'-q',
			'--allow-empty',
			'-m',
			'init'
		)
		mkdirSync(join(root, '.repos/example.com/acme'), { recursive: true })
		symlinkSync(elsewhere, join(root, '.repos/example.com/acme/linked'))
		write(join(root, 'tasks/linked.md'), '---\nrepo: example.com/acme/linked\n---\n')
		const r = kenTask(root, ['claim', 'tasks/linked.md'])
		expect(r).toMatchObject({ status: 1, stdout: '' })
		expect(r.stderr).toContain('is a symlink')
		expect(r.stderr).toContain('so no branch was made for linked')
		expect(git(elsewhere, 'for-each-ref', '--format=%(refname:lstrip=2)', 'refs/heads/')).toBe(
			'main'
		)
	})

	it('refuses a task whose name git would read as an option, leaving the clone alone', () => {
		const t = setup({ 'tasks/-m.md': `repo: ${KEY}` })
		const r = kenTask(t.root, ['claim', 'tasks/-m.md'])
		expect(r).toMatchObject({ status: 1, stdout: '' })
		expect(r.stderr).toContain("'-m' is not a valid branch name")
		expect(r.stderr).toContain('move the task file to a name of letters, digits and dashes')
		expect(t.branches()).toBe('main')
		expect(git(t.clone, 'branch', '--show-current')).toBe('main')
	})

	it('keeps the branch when the worktree fails, and names the ken get -b to rerun', () => {
		const t = setup({ [TASK]: `repo: ${KEY}` })
		mkdirSync(`${t.clone}.portal-fix-login`)
		const r = kenTask(t.root, ['claim', TASK])
		expect(r).toMatchObject({ status: 1, stdout: '' })
		expect(r.stderr).toContain('is in the way')
		expect(r.stderr).toContain(`\`ken get ${KEY} -b portal/fix-login\``)
		expect(t.state(TASK)).toBe('claimed')
	})

	it('lets exactly one of two parallel claims of one task make its branch', async () => {
		const t = setup({ [TASK]: `repo: ${KEY}` })
		const results = await Promise.all([
			race(t.root, ['claim', TASK]),
			race(t.root, ['claim', TASK])
		])
		const won = results.filter((r) => r.status === 0)
		const lost = results.filter((r) => r.status === 1)
		expect(won).toEqual([expect.objectContaining({ stdout: `${t.clone}.portal-fix-login\n` })])
		expect(lost).toEqual([expect.objectContaining({ stdout: '' })])
		expect(lost[0]?.stderr).toMatch(/is claimed: its branch|was claimed by another caller first/)
		const created = git(t.clone, 'reflog', 'show', '--format=%gs', 'refs/heads/portal/fix-login')
		expect(created.split('\n')).toHaveLength(1)
	})

	it('gives two parallel claims without a task one ready task each', async () => {
		const t = setup({ 'tasks/one.md': `repo: ${KEY}`, 'tasks/two.md': `repo: ${KEY}` })
		const results = await Promise.all([race(t.root, ['claim']), race(t.root, ['claim'])])
		expect(results.map((r) => r.status)).toEqual([0, 0])
		expect(results.map((r) => r.stdout).sort()).toEqual([`${t.clone}.one\n`, `${t.clone}.two\n`])
		expect(existsSync(join(`${t.clone}.one`, 'setup-ran'))).toBe(true)
		expect(existsSync(join(`${t.clone}.two`, 'setup-ran'))).toBe(true)
	})
})
