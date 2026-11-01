// Repo tasks against a local bare repo cloned into the layout with `ken get`: claimed,
// landing, the done refusal and `ken task finish`.
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { git } from './git.ts'
import { localDate } from './list.ts'
import { dir, kenGet, kenTask, newRoot, write } from './testing.ts'

const KEY = 'example.com/acme/web'
const NAME = 'web/fix-login'
const TASK = 'tasks/web/fix-login.md'

// `ken get <key>` clones https://example.com/acme/web.git from a bare repo under dir/remotes
beforeAll(() => {
	const remote = join(dir, 'remotes/acme/web.git')
	mkdirSync(remote, { recursive: true })
	git(remote, 'init', '-q', '--bare', '-b', 'main')
	const tree = git(remote, 'hash-object', '-t', 'tree', '-w', '/dev/null')
	git(remote, 'update-ref', 'refs/heads/main', git(remote, 'commit-tree', '-m', 'init', tree))
})

/** A root with the clone of KEY, and the task TASK in it holding `front` as front matter. */
function setup(front = 'status: todo') {
	const root = newRoot()
	const clone = kenGet(root, KEY)
	git(clone, 'config', 'user.name', 'T')
	git(clone, 'config', 'user.email', 't@example.com')
	const task = (rel: string, text: string) => write(join(root, rel), `---\n${text}\n---\n`)
	task(TASK, `${front}\nrepo: ${KEY}`)
	return {
		root,
		clone,
		task,
		/** Claim TASK as `claim` will: its branch and worktree, with one commit on it. */
		claim: () => {
			const worktree = kenGet(root, KEY, '-b', NAME)
			writeFileSync(join(worktree, 'login.txt'), 'fixed\n')
			git(worktree, 'add', '.')
			git(worktree, 'commit', '-q', '-m', 'Fix login')
			return worktree
		},
		state: (rel = TASK) => {
			const rows = JSON.parse(kenTask(root, ['list', '--json']).stdout) as {
				path: string
				state: string
				unmet: { reason: string }[]
				notes: string[]
			}[]
			return rows.find((r) => r.path === join(root, rel))
		},
		text: () => readFileSync(join(root, TASK), 'utf8'),
		hasBranch: () =>
			spawnSync('git', ['show-ref', '--quiet', `refs/heads/${NAME}`], { cwd: clone }).status === 0
	}
}

describe('repo tasks', { timeout: 30_000 }, () => {
	it('is claimed while its branch exists, and done by status alone once landed and finished', () => {
		const t = setup()
		expect(t.state()).toMatchObject({ state: 'ready' })
		t.claim()
		expect(t.state()).toMatchObject({ state: 'claimed', notes: [] })
		expect(kenTask(t.root, ['ready']).stdout).toBe('')
		git(t.clone, 'merge', '-q', '--no-ff', '-m', 'Land', NAME)
		expect(kenTask(t.root, ['set', TASK, 'status', 'done']).status).toBe(0)
		expect(t.state()).toMatchObject({
			state: 'done',
			notes: [expect.stringContaining(`done, but its branch ${NAME} remains`)]
		})
		expect(kenTask(t.root, ['finish', TASK]).status).toBe(0)
		expect(t.state()).toMatchObject({ state: 'done', notes: [] })
	})

	it('refuses status done until the branch is merged with its commits', () => {
		const t = setup()
		t.claim()
		const before = t.text()
		const refused = kenTask(t.root, ['set', TASK, 'status', 'done'])
		expect(refused.status).toBe(1)
		expect(refused.stderr).toContain(`its branch ${NAME} of ${KEY} is not on the default branch`)
		expect(refused.stderr).toContain(`\`git -C ${t.clone} merge --no-ff ${NAME}\``)
		expect(refused.stderr).toContain(`\`git -C ${t.clone} log --oneline HEAD..${NAME}\``)
		expect(t.text()).toBe(before)

		git(t.clone, 'merge', '-q', '--squash', NAME)
		git(t.clone, 'commit', '-q', '-m', 'Squashed')
		expect(kenTask(t.root, ['set', TASK, 'status', 'done']).status).toBe(1)

		git(t.clone, 'merge', '-q', '--no-ff', '-m', 'Land', NAME)
		expect(kenTask(t.root, ['set', TASK, 'status', 'done']).status).toBe(0)
		expect(t.text()).toContain(`closed: ${localDate(new Date())}\n`)
	})

	it('is landing while done with its branch off the default branch, and its dependents wait', () => {
		const t = setup('status: done')
		t.task('tasks/web/after.md', 'blocked-by: [fix-login.md]')
		t.claim()
		expect(t.state()).toMatchObject({
			state: 'landing',
			notes: [expect.stringContaining(`merge --no-ff ${NAME}`)]
		})
		expect(t.state('tasks/web/after.md')).toMatchObject({
			state: 'blocked',
			unmet: [{ reason: 'landing' }]
		})
		git(t.clone, 'merge', '-q', '--no-ff', '-m', 'Land', NAME)
		expect(t.state()).toMatchObject({ state: 'done' })
		expect(t.state('tasks/web/after.md')).toMatchObject({ state: 'ready', unmet: [] })
	})

	it('finishes a closed task: worktree, then branch, and git refusals pass through', () => {
		const t = setup()
		const worktree = t.claim()
		const open = kenTask(t.root, ['finish', TASK])
		expect(open.status).toBe(1)
		expect(open.stderr).toContain(`run \`ken task set ${join(t.root, TASK)} status done\``)

		git(t.clone, 'merge', '-q', '--no-ff', '-m', 'Land', NAME)
		expect(kenTask(t.root, ['set', TASK, 'status', 'done']).status).toBe(0)
		writeFileSync(join(worktree, 'login.txt'), 'changed\n')
		expect(t.state()?.notes).toContainEqual(
			expect.stringContaining(`uncommitted changes in ${worktree}`)
		)
		const dirty = kenTask(t.root, ['finish', TASK])
		expect(dirty.status).toBe(1)
		expect(dirty.stderr).toContain('git worktree remove')
		expect(dirty.stderr).toContain(`\`git -C ${t.clone} worktree remove --force ${worktree}\``)
		expect(existsSync(worktree)).toBe(true)

		git(worktree, 'checkout', '--', '.')
		expect(kenTask(t.root, ['finish', TASK, '--help']).stdout).toContain('Examples:')
		expect(kenTask(t.root, ['finish', TASK])).toMatchObject({
			status: 0,
			stdout: '',
			stderr: expect.stringContaining(`removed its worktree ${worktree} and its branch ${NAME}`)
		})
		expect(existsSync(worktree)).toBe(false)
		expect(t.hasBranch()).toBe(false)
	})

	it('passes through the refusal to delete unmerged commits, with -D to run by hand', () => {
		const t = setup('status: wontfix')
		const worktree = t.claim()
		const r = kenTask(t.root, ['finish', TASK])
		expect(r.status).toBe(1)
		expect(r.stderr).toContain(`\`git -C ${t.clone} branch -D ${NAME}\``)
		expect(existsSync(worktree)).toBe(false)
		expect(t.hasBranch()).toBe(true)
	})

	it('refuses to archive a done task whose branch remains, naming finish', () => {
		const t = setup()
		t.claim()
		git(t.clone, 'merge', '-q', '--no-ff', '-m', 'Land', NAME)
		expect(kenTask(t.root, ['set', TASK, 'status', 'done']).status).toBe(0)
		const r = kenTask(t.root, ['archive', TASK])
		expect(r.status).toBe(1)
		expect(r.stderr).toContain(`Run \`ken task finish ${join(t.root, TASK)}\``)
		expect(existsSync(join(t.root, TASK))).toBe(true)
		expect(kenTask(t.root, ['finish', TASK]).status).toBe(0)
		expect(kenTask(t.root, ['archive', TASK]).stdout).toBe(
			`${join(t.root, 'tasks/.archive', TASK.slice('tasks/'.length))}\n`
		)
	})

	it('notes a claimed task whose worktree is missing or holds another branch', () => {
		const t = setup()
		const worktree = t.claim()
		git(worktree, 'switch', '-q', '-c', 'other')
		expect(t.state()?.notes).toEqual([
			expect.stringContaining(`its worktree ${worktree} holds branch other`)
		])
		git(t.clone, 'worktree', 'remove', worktree)
		expect(t.state()?.notes).toEqual([
			expect.stringContaining(`\`git -C ${t.clone} worktree prune && ken get ${KEY} -b ${NAME}\``)
		])
	})

	it('refuses to rename a claimed task, since its branch carries the old name', () => {
		const t = setup()
		t.claim()
		const r = kenTask(t.root, ['rename', TASK, 'web/fix-sign-in'])
		expect(r).toMatchObject({ status: 1, stdout: '' })
		expect(r.stderr).toContain(`has a branch, ${NAME} of ${KEY}`)
		expect(r.stderr).toContain(`\`ken task finish ${join(t.root, TASK)}\``)
		expect(existsSync(join(t.root, TASK))).toBe(true)
		expect(existsSync(join(t.root, 'tasks/web/fix-sign-in.md'))).toBe(false)
	})

	it('reads a repo not cloned here as having no branch, said once', () => {
		const root = newRoot()
		write(join(root, 'tasks/a.md'), '---\nrepo: example.com/acme/gone\n---\n')
		write(join(root, 'tasks/b.md'), '---\nstatus: done\nrepo: example.com/acme/gone\n---\n')
		const r = kenTask(root, ['list'])
		expect(r.stdout).toBe(
			`ready  ${join(root, 'tasks/a.md')}\ndone   ${join(root, 'tasks/b.md')}\n`
		)
		expect(r.stderr.trim().split('\n')).toEqual([
			expect.stringContaining('example.com/acme/gone is not cloned on this machine')
		])
	})
})
