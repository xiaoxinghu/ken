import { spawn, spawnSync } from 'node:child_process'
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { git } from './git.ts'

let tmp: string
let root: string
const KEY = 'example.com/acme/web'
const clone = () => join(root, '.repos', KEY)
const tree = (branch: string) => `${clone()}.${branch.replaceAll('/', '-')}`

// remotes are bare repos under <tmp>/remotes, reached by key through url.insteadOf
const env = () => ({
	...process.env,
	KEN_ROOT: root,
	GIT_CONFIG_COUNT: '1',
	GIT_CONFIG_KEY_0: `url.file://${tmp}/remotes/.insteadOf`,
	GIT_CONFIG_VALUE_0: 'https://example.com/'
})
const CLI = join(import.meta.dirname, 'cli.ts')
const ken = (...args: string[]) =>
	spawnSync(process.execPath, [CLI, 'get', ...args], { encoding: 'utf8', env: env() })

const exists = (branch: string) =>
	spawnSync('git', ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`], { cwd: clone() })
		.status === 0

/** Commit `files` on the clone's default branch, as it stands for the next new branch. */
function commit(files: Record<string, string>): string {
	for (const [path, text] of Object.entries(files)) writeFileSync(join(clone(), path), text)
	git(clone(), 'add', '.')
	git(clone(), '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'x')
	return git(clone(), 'rev-parse', 'HEAD')
}

beforeAll(() => {
	tmp = realpathSync.native(mkdtempSync(join(tmpdir(), 'ken-worktree-')))
	const remote = join(tmp, 'remotes/acme/web.git')
	mkdirSync(remote, { recursive: true })
	git(remote, 'init', '-q', '--bare', '-b', 'main')
	const empty = git(remote, 'hash-object', '-t', 'tree', '-w', '--stdin')
	git(remote, 'update-ref', 'refs/heads/main', git(remote, 'commit-tree', '-m', 'x', empty))
	mkdirSync(join(tmp, 'remotes/acme/empty.git'))
	git(join(tmp, 'remotes/acme/empty.git'), 'init', '-q', '--bare', '-b', 'trunk')
})

beforeEach(() => {
	root = mkdtempSync(join(tmp, 'root-'))
	expect(ken(KEY).status).toBe(0)
})

describe('ken get -b', () => {
	it('branches from the default branch into <repo>.<folder>; a rerun prints the same path', () => {
		const r = ken(KEY, '-b', 'feat/login')
		expect(r).toMatchObject({ status: 0, stdout: `${tree('feat/login')}\n` })
		expect(git(tree('feat/login'), 'branch', '--show-current')).toBe('feat/login')
		expect(git(clone(), 'rev-parse', 'feat/login')).toBe(git(clone(), 'rev-parse', 'main'))
		expect(ken(KEY, '-b', 'feat/login')).toMatchObject({
			status: 0,
			stdout: `${tree('feat/login')}\n`
		})
	})

	it('bases a new branch on --from', () => {
		const base = git(clone(), 'rev-parse', 'HEAD')
		commit({ 'a.txt': 'a' })
		expect(ken(KEY, '-b', 'old', '--from', base).status).toBe(0)
		expect(git(clone(), 'rev-parse', 'old')).toBe(base)
	})

	it('checks out an existing branch with no worktree, refusing --from for it', () => {
		git(clone(), 'branch', 'fix')
		const refused = ken(KEY, '-b', 'fix', '--from', 'main')
		expect(refused).toMatchObject({ status: 1, stdout: '' })
		expect(refused.stderr).toContain(`branch fix exists in ${clone()}, so --from main cannot be`)
		expect(existsSync(tree('fix'))).toBe(false)
		expect(ken(KEY, '-b', 'fix')).toMatchObject({ status: 0, stdout: `${tree('fix')}\n` })
	})

	it('prints the clone for the default branch, which the clone holds', () => {
		expect(ken(KEY, '-b', 'main')).toMatchObject({ status: 0, stdout: `${clone()}\n` })
	})

	it('refuses a second branch mapping to the same folder, naming the first, creating nothing', () => {
		expect(ken(KEY, '-b', 'feat/login').status).toBe(0)
		const r = ken(KEY, '-b', 'feat-login')
		expect(r).toMatchObject({ status: 1, stdout: '' })
		expect(r.stderr).toContain(
			`${tree('feat/login')} is in the way: the worktree of branch feat/login`
		)
		expect(exists('feat-login')).toBe(false)
	})

	it('refuses a folder that differs only by case, on any disk', () => {
		mkdirSync(`${clone()}.Feat-Login`)
		const r = ken(KEY, '-b', 'feat-login')
		expect(r.status).toBe(1)
		expect(r.stderr).toContain(`${clone()}.Feat-Login differs from it only by case`)
		expect(exists('feat-login')).toBe(false)
	})

	it('refuses a branch name git refuses before cloning anything', () => {
		const r = ken('example.com/acme/other', '-b', 'a..b')
		expect(r.stderr).toContain('is not a branch name git accepts')
		expect(existsSync(join(root, '.repos/example.com/acme/other'))).toBe(false)
	})

	it('refuses to branch from an unborn default branch', () => {
		expect(ken('example.com/acme/empty').status).toBe(0)
		const r = ken('example.com/acme/empty', '-b', 'x')
		expect(r.status).toBe(1)
		expect(r.stderr).toContain('has no commit on its default branch trunk')
	})

	it("copies the repo's files and runs its setup there, the setup's output on stderr", () => {
		mkdirSync(join(clone(), 'svc'))
		writeFileSync(join(clone(), 'svc/.env'), 'SECRET=1')
		commit({
			'.gitignore': '.env\n',
			'.ken.yaml': 'copy: [svc/.env]\nsetup: echo hi; pwd > made\n'
		})
		const r = ken(KEY, '-b', 'x')
		expect(r).toMatchObject({ status: 0, stdout: `${tree('x')}\n` })
		expect(r.stderr).toContain('hi')
		expect(readFileSync(join(tree('x'), 'svc/.env'), 'utf8')).toBe('SECRET=1')
		expect(readFileSync(join(tree('x'), 'made'), 'utf8').trim()).toBe(realpathSync(tree('x')))
	})

	it('keeps the worktree when the setup fails, and names the command to finish', () => {
		commit({ '.ken.yaml': 'setup: exit 3\n' })
		const r = ken(KEY, '-b', 'x')
		expect(r).toMatchObject({ status: 1, stdout: '' })
		expect(r.stderr).toContain('the setup `exit 3`')
		expect(r.stderr).toContain(`cd ${tree('x')} && sh -c 'exit 3'`)
		expect(exists('x')).toBe(true)
		expect(git(tree('x'), 'branch', '--show-current')).toBe('x')
	})

	it('keeps the worktree when a copy source is missing, and names the copy and setup to finish', () => {
		commit({ '.ken.yaml': 'copy: [a/.env]\nsetup: "true"\n' })
		const r = ken(KEY, '-b', 'x')
		expect(r.status).toBe(1)
		expect(r.stderr).toContain(
			`${join(clone(), 'a/.env')}, which the repo's .ken.yaml says to copy`
		)
		expect(r.stderr).toContain(`cp -R ${join(clone(), 'a/.env')} ${join(tree('x'), 'a/.env')}`)
		expect(r.stderr).toContain(`cd ${tree('x')} && sh -c true`)
		expect(existsSync(tree('x'))).toBe(true)
	})

	it('removes the worktree and the branch when it fails before reading .ken.yaml through', () => {
		commit({ '.ken.yaml': 'copy: [\n' })
		const r = ken(KEY, '-b', 'x')
		expect(r).toMatchObject({ status: 1, stdout: '' })
		expect(r.stderr).toContain('removed the worktree and the branch again')
		expect(exists('x')).toBe(false)
		expect(existsSync(tree('x'))).toBe(false)
		expect(git(clone(), 'worktree', 'list', '--porcelain')).not.toContain(tree('x'))
	})

	it('lets exactly one of two parallel callers create a new branch', async () => {
		const run = () =>
			new Promise<{ status: number | null; stdout: string }>((done) => {
				const child = spawn(process.execPath, [CLI, 'get', KEY, '-b', 'race'], { env: env() })
				let stdout = ''
				child.stdout.on('data', (d) => {
					stdout += d
				})
				child.on('close', (status) => done({ status, stdout }))
			})
		const results = await Promise.all([run(), run()])
		// the loser is refused, or, once the winner is through, given the same worktree
		expect(results.some((r) => r.status === 0 && r.stdout === `${tree('race')}\n`)).toBe(true)
		const created = git(clone(), 'reflog', 'show', '--format=%gs', 'refs/heads/race')
		expect(created.split('\n')).toHaveLength(1)
		expect(git(tree('race'), 'branch', '--show-current')).toBe('race')
	})
})
