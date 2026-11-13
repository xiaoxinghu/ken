// The layout commands, path, which, get, repos and index set, as a user runs them: cli.ts in a
// child process, against temp roots and local bare repos, never the network.
import { spawn, spawnSync } from 'node:child_process'
import {
	existsSync,
	lstatSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	readlinkSync,
	realpathSync,
	renameSync,
	rmSync,
	symlinkSync,
	writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'

const CLI = join(import.meta.dirname, 'cli.ts')
const dir = realpathSync.native(mkdtempSync(join(tmpdir(), 'ken-checkouts-')))
const KEY = 'example.com/acme/lib'

// git with only the config here: https://example.com/ is the bare repos under remotes/, which
// serve blobless clones; the user's signing, hooks and default branch never leak in
const ENV = {
	PATH: process.env.PATH ?? '',
	HOME: join(dir, 'home'),
	GIT_CONFIG_NOSYSTEM: '1',
	GIT_CONFIG_GLOBAL: join(dir, 'gitconfig'),
	GIT_AUTHOR_NAME: 't',
	GIT_AUTHOR_EMAIL: 't@t',
	GIT_COMMITTER_NAME: 't',
	GIT_COMMITTER_EMAIL: 't@t'
}

const write = (file: string, body: string, mode = 0o644) => {
	mkdirSync(join(file, '..'), { recursive: true })
	writeFileSync(file, body, { mode })
}
const git = (cwd: string, ...args: string[]) => {
	const r = spawnSync('git', args, { cwd, encoding: 'utf8', env: ENV })
	if (r.status !== 0) throw new Error(r.stderr)
	return r.stdout
}
const repo = (path: string) => {
	mkdirSync(path, { recursive: true })
	git(path, 'init', '-q', '-b', 'main')
	git(path, 'commit', '-q', '--allow-empty', '-m', 'init')
}
/** A bare repo at remotes/acme/<name>.git, made from a repo holding `files`. */
const remote = (name: string, files: Record<string, string>, tag?: string) => {
	const src = join(dir, `src-${name}`)
	repo(src)
	if (tag) git(src, 'tag', tag)
	for (const [file, body] of Object.entries(files)) write(join(src, file), body)
	git(src, 'add', '-A')
	git(src, 'commit', '-q', '-m', name)
	git(dir, 'clone', '-q', '--bare', `src-${name}`, `remotes/acme/${name}.git`)
}

let n = 0
/** A new root, `.ken` holding `settings` after the format line. */
const fresh = (settings = '') => {
	const at = join(dir, `r${++n}`)
	write(join(at, '.ken'), `ken.format=1\n${settings}`)
	return at
}
const cloneOf = (root: string, key = KEY) => join(root, '.repos', key)

type Run = { status: number | null; stdout: string; stderr: string }
/** `ken <args>` run from `cwd`, KEN_ROOT unset, with `more` in the environment. */
const ken = (args: string[], cwd: string, more: Record<string, string> = {}): Run => {
	const r = spawnSync(process.execPath, [CLI, ...args], {
		cwd,
		encoding: 'utf8',
		env: { ...ENV, ...more }
	})
	return { status: r.status, stdout: r.stdout, stderr: r.stderr }
}
const kenAsync = (args: string[], cwd: string) =>
	new Promise<Run>((resolve) => {
		const child = spawn(process.execPath, [CLI, ...args], { cwd, env: ENV })
		let stdout = ''
		let stderr = ''
		child.stdout.on('data', (d) => {
			stdout += d
		})
		child.stderr.on('data', (d) => {
			stderr += d
		})
		child.on('close', (status) => resolve({ status, stdout, stderr }))
	})
const ok = (stdout: string) => ({ status: 0, stdout: `${stdout}\n`, stderr: '' })
const config = (repo: string, name: string) =>
	spawnSync('git', ['-C', repo, 'config', '--get', name], { encoding: 'utf8', env: ENV }).stdout
/** What is at `p`, to tell that a refusal left it untouched. */
const shape = (p: string) => {
	const s = lstatSync(p)
	if (s.isSymbolicLink()) return `link ${readlinkSync(p)}`
	if (s.isFile()) return `file ${readFileSync(p, 'utf8')}`
	return `folder ${readdirSync(p).sort().join(' ')}`
}

// lib: v1, an empty commit, then a README; agents: an AGENTS.md; team: a root, its front page
// opening with what it is for
beforeAll(() => {
	write(
		join(dir, 'gitconfig'),
		`[url "file://${dir}/remotes/"]\n\tinsteadOf = https://example.com/\n[uploadpack]\n\tallowFilter = true\n`
	)
	mkdirSync(join(dir, 'home'))
	remote('lib', { 'README.md': 'lib\n' }, 'v1')
	remote('agents', { 'AGENTS.md': 'agents\n' })
	remote('team', {
		'.ken': 'ken.format=1\n',
		'README.md': '# team\r\n\r\n<!-- a comment -->\r\nThe team knowledge base.\u2028More.  \r\n'
	})
	write(join(dir, 'old-git/git'), '#!/bin/sh\necho "git version 2.47.1"\n', 0o755)
})

describe('path', () => {
	const root = () => join(dir, 'path-root')
	beforeAll(() => {
		write(join(root(), '.ken'), 'ken.format=1\n')
		mkdirSync(join(root(), '.repos/github.com/acme/web/src'), { recursive: true })
	})

	it('code lowercases the key and puts a branch worktree beside the clone, / as -', () => {
		expect(ken(['path', 'code', 'github.com/Acme/Join-Web', 'feat/login'], root())).toEqual(
			ok(`${root()}/.repos/github.com/acme/join-web.feat-login`)
		)
		for (const url of [
			'https://github.com/acme/join-web.git',
			'ssh://git@github.com:22/Acme/Join-Web.git',
			'git@github.com:Acme/Join-Web.git',
			'github.com:acme/join-web.git'
		])
			expect(ken(['path', 'code', url], root()).stdout).toBe(
				`${root()}/.repos/github.com/acme/join-web\n`
			)
	})

	it('needs a root, as every layout command does', () => {
		for (const args of [
			['path', 'code', 'github.com/acme/x'],
			['which'],
			['repos'],
			['index', 'set', 'github.com/acme/x', 'desc=X.']
		]) {
			const r = ken(args, dir)
			expect(r.status).toBe(1)
			expect(r.stderr).toContain(`${dir} is in no ken root`)
		}
	})

	it('refuses a URL with userinfo as a key or a branch, never printing the secret', () => {
		const url = 'https://me:s3cret@github.com/acme/join-web'
		for (const args of [
			['path', 'code', 'github.com/acme/join-web', url],
			['path', 'code', `${url}/extra`],
			['get', `${url}/extra`]
		]) {
			const r = ken(args, root())
			expect(r.status).toBe(1)
			expect(r.stdout).toBe('')
			expect(r.stderr).toMatch(/^ken: https:\/\/github.com\/acme\/join-web.* is not a/)
			expect(r.stderr).not.toContain('s3cret')
		}
	})

	it('refuses @, which git check-ref-format takes but git branch does not', () => {
		const r = ken(['path', 'code', 'github.com/acme/join-web', '@'], root())
		expect(r.status).toBe(1)
		expect(r.stderr).toContain('is not a branch name git accepts')
	})

	it('resolves a reference to a cloned repo to the file, to an uncloned one to its URL', () => {
		expect(ken(['path', 'github.com/Acme/Web:src/a.ts#run'], root())).toEqual(
			ok(`${root()}/.repos/github.com/acme/web/src/a.ts`)
		)
		const r = ken(['path', 'github.com/acme/api:src/a.ts#run'], root())
		expect(r.status).toBe(0)
		expect(r.stdout).toBe('https://github.com/acme/api.git\n')
		expect(r.stderr).toContain('Run `ken get github.com/acme/api` to clone it')
		const leak = ken(
			['path', 'github.com/acme/api:https://me:s3cret@x.io/a#https://me:s3cret@x.io'],
			root()
		)
		expect(leak.stderr).toContain('ken get github.com/acme/api')
		expect(leak.stderr).not.toContain('s3cret')
	})

	it('refuses a reference that climbs out of its repo', () => {
		expect(ken(['path', 'github.com/acme/web:src/../../atlas/x'], root()).stderr).toContain(
			'points outside its repo'
		)
		expect(ken(['path', 'github.com/acme/web:src/../a.ts'], root()).status).toBe(0)
	})
})

describe('which', () => {
	const root = () => join(dir, 'which-root')
	const s = (path: string) => join(root(), '.repos', path)
	const which = (path: string, cwd = root()) => ken(['which', path], cwd)
	beforeAll(() => {
		write(join(root(), '.ken'), 'ken.format=1\n')
		const app = s('github.com/acme/app')
		repo(app)
		mkdirSync(join(app, 'src/deep'), { recursive: true })
		git(app, 'worktree', 'add', '-q', '-b', 'feat/x', '../app.feat-x')
		mkdirSync(join(app, '../app.feat-x/src/deep'), { recursive: true })
		git(app, 'worktree', 'add', '-q', '--detach', '../../other/elsewhere')
		git(app, 'worktree', 'add', '-q', '-b', 'feat+fix', '../app.feat+fix')
		repo(join(dir, 'away'))
		git(join(dir, 'away'), 'worktree', 'add', '-q', '--detach', s('github.com/acme/stray'))
		mkdirSync(s('github.com/acme/web/src'), { recursive: true })
		symlinkSync(s('github.com/acme/app/src'), join(root(), 'code'))
		write(s('github.com/acme/app/a.ts'), '')
		symlinkSync(s('github.com/acme/app/a.ts'), join(root(), 'a.ts'))
		symlinkSync('loop', join(root(), 'loop'))
	})

	it('a clone and a worktree beside it, at their tops and deep inside, from git', () => {
		const at = s('github.com/acme')
		expect(ken(['which'], join(at, 'app'))).toEqual(ok('github.com/acme/app clone main'))
		expect(which(s('github.com/acme/app/src/deep'))).toEqual(ok('github.com/acme/app clone main'))
		expect(which('src/deep', join(at, 'app.feat-x'))).toEqual(
			ok('github.com/acme/app worktree feat/x')
		)
		expect(ken(['which'], join(at, 'app.feat-x/src/deep'))).toEqual(
			ok('github.com/acme/app worktree feat/x')
		)
		expect(which('code/deep')).toEqual(ok('github.com/acme/app clone main'))
		// a link to a file is followed to the checkout the file is in
		expect(which('a.ts')).toEqual(ok('github.com/acme/app clone main'))
	})

	it('a worktree is keyed by its clone wherever its folder is, detached with no branch', () => {
		expect(which(s('github.com/other/elsewhere'))).toEqual(ok('github.com/acme/app worktree'))
		expect(which(s('github.com/acme/app.feat+fix'))).toEqual(
			ok('github.com/acme/app worktree feat+fix')
		)
	})

	it('a path not checked out yet is answered from its shape, with no branch', () => {
		expect(which(s('github.com/Acme/api/src/x.ts'))).toEqual(ok('github.com/acme/api clone'))
		expect(which(s('github.com/acme/app.other/src'))).toEqual(ok('github.com/acme/app worktree'))
		// a worktree's .git is a file, so app.feat-x is not a clone to be a worktree of
		expect(which(s('github.com/acme/app.feat-x.y'))).toEqual(ok('github.com/acme/app worktree'))
	})

	it('a folder where a checkout belongs with no .git is refused, with the ken get to run', () => {
		const r = which(s('github.com/acme/web/src'))
		expect(r.status).toBe(1)
		expect(r.stderr).toContain(`${s('github.com/acme/web')} is where a checkout belongs`)
		expect(r.stderr).toContain('`ken get github.com/acme/web`')
	})

	it('a path in .repos outside a checkout, or outside .repos, is refused', () => {
		for (const path of [s('github.com/acme'), s('')]) {
			const r = which(path)
			expect(r.status).toBe(1)
			expect(r.stderr).toContain('the folder of every checkout of the root, but in no checkout')
		}
		const out = which('notes')
		expect(out.status).toBe(1)
		expect(out.stderr).toContain(`${root()}/notes is outside ${root()}/.repos`)
		// a link cycle ends, as a path outside
		expect(which('loop').stderr).toContain(`${root()}/loop is outside ${root()}/.repos`)
	})

	it('a worktree of a clone outside .repos is refused, with the git worktree move', () => {
		const r = which(s('github.com/acme/stray'))
		expect(r.status).toBe(1)
		expect(r.stderr).toContain(
			`\`git -C ${dir}/away worktree move ${s('github.com/acme/stray')} ${dir}/stray\``
		)
	})
})

describe('index set', () => {
	const W = 'github.com/acme/web'
	/** A root whose index holds `body`, or none when undefined. */
	const indexed = (body?: string) => {
		const at = fresh()
		const index = join(at, '.repos.index')
		if (body !== undefined) write(index, body)
		return { at, index, read: () => readFileSync(index, 'utf8') }
	}

	it('creates the file and the entry and nothing else, saying what and where', () => {
		const r = indexed()
		expect(ken(['index', 'set', W, 'desc=Web.', 'kind=fe'], r.at)).toEqual(
			ok(`Set desc, kind in a new entry for ${W}, in ${r.index}.`)
		)
		expect(r.read()).toBe(`repo: ${W}\ndesc: Web.\nkind: fe\n`)
		expect(ken(['index', 'set', 'https://GitHub.com/acme/web.git', 'kind=be'], r.at)).toEqual(
			ok(`Set kind in the entry for ${W}, in ${r.index}.`)
		)
		expect(readdirSync(r.at).sort()).toEqual(['.ken', '.repos.index'])
	})

	it('replaces a field in place and appends a new one, every other line kept', () => {
		const head = '# The index.\n\nowner: github.com/acme\ndesc: Acme.\n\n'
		const tail = '\n\n# about api\nrepo: github.com/acme/api\ndesc: API.\n'
		const r = indexed(`${head}repo: ${W}\ndesc: Web.\n# who: sales\nkind: fe\n${tail}`)
		ken(['index', 'set', W, 'kind=be', 'tags=sales join', 'doc=#top a=b \\t'], r.at)
		expect(r.read()).toBe(
			`${head}repo: ${W}\ndesc: Web.\n# who: sales\nkind: be\ntags: sales join\ndoc: #top a=b \\t\n${tail}`
		)
	})

	it('writers take turns, so parallel sets of different repos lose none', async () => {
		const r = indexed('')
		const keys = [1, 2, 3, 4, 5, 6].map((i) => `github.com/acme/r${i}`)
		const all = await Promise.all(keys.map((k) => kenAsync(['index', 'set', k, 'desc=R.'], r.at)))
		expect(all.map((a) => a.status)).toEqual(keys.map(() => 0))
		for (const k of keys) expect(r.read()).toContain(`repo: ${k}\ndesc: R.\n`)
		expect(readdirSync(r.at).sort()).toEqual(['.ken', '.repos.index'])
	}, 20_000)

	it('a lock whose holder is gone is refused with the rm to run, never removed by ken', () => {
		const r = indexed('')
		const lock = `${r.index}.lock`
		symlinkSync(String(spawnSync('true').pid), lock)
		const out = ken(['index', 'set', W, 'desc=Web.'], r.at)
		expect(out.status).toBe(1)
		expect(out.stderr).toContain(`run \`rm ${lock}\` and rerun.`)
		expect(r.read()).toBe('')
		rmSync(lock)
		expect(ken(['index', 'set', W, 'desc=Web.'], r.at).status).toBe(0)
	})

	it('anything but a symlink at the lock path is refused with the mv aside', () => {
		const r = indexed('')
		const lock = `${r.index}.lock`
		mkdirSync(lock)
		const out = ken(['index', 'set', W, 'desc=Web.'], r.at)
		expect(out.status).toBe(1)
		expect(out.stderr).toContain(`Move it aside, e.g. \`mv ${lock} ${lock}.old\``)
		expect([r.read(), readdirSync(lock)]).toEqual(['', []])
	})

	it('refuses an empty value, a newline, a bad field name, the repo line and unset', () => {
		const r = indexed()
		for (const args of [
			['set', W, 'desc='],
			['set', W, 'desc= '],
			['set', W, 'doc=a\nb'],
			['set', W, 'doc=a\rb'],
			['set', W, 'doc=a\u2028b'],
			['set', W, 'a.b=c'],
			['set', W, 'kind'],
			['set', W, 'repo=x.io/a/b'],
			['set', W],
			['unset', W, 'kind']
		]) {
			const out = ken(['index', ...args], r.at)
			expect(out.status).toBe(1)
			expect(out.stderr).toMatch(/run (e\.g\. )?`ken index set /i)
		}
		expect(existsSync(r.index)).toBe(false)
	})

	it('an index that is not a file, or that ken cannot read, is refused, nothing written', () => {
		const folder = indexed()
		mkdirSync(folder.index)
		expect(ken(['index', 'set', W, 'desc=Web.'], folder.at).stderr).toContain(
			`${folder.index} is not a file`
		)
		const body = `repo: ${W}\nkind fe\n`
		const bad = indexed(body)
		const out = ken(['index', 'set', W, 'desc=Web.'], bad.at)
		expect(out.stderr).toContain(`ken: ${bad.index} line 2, 'kind fe', is not a line ken can read`)
		expect(bad.read()).toBe(body)
	})
})

describe('get', () => {
	const registered = (root: string) => `ken: registered ${KEY} in ${root}/.repos.index with no desc`

	it('clones blobless into .repos, registers the key and says to describe it; again is silent', () => {
		const at = fresh()
		const clone = cloneOf(at)
		const first = ken(['get', KEY], dir, { KEN_ROOT: at })
		expect(first.status).toBe(0)
		expect(first.stdout).toBe(`${clone}\n`)
		expect(first.stderr).toContain(registered(at))
		expect(first.stderr).toContain(`Run \`ken index set ${KEY} desc="..."\``)
		expect(readFileSync(join(at, '.repos.index'), 'utf8')).toBe(`repo: ${KEY}\n`)
		expect(readFileSync(join(clone, 'README.md'), 'utf8')).toBe('lib\n')
		expect(config(clone, 'worktree.useRelativePaths')).toBe('true\n')
		expect(config(clone, 'remote.origin.partialclonefilter')).toBe('blob:none\n')
		expect(readdirSync(join(clone, '..'))).toEqual(['lib'])
		expect(ken(['get', `https://${KEY}.git`], at)).toEqual(ok(clone))
	})

	it('from a checkout it made, path root is the root, with no KEN_ROOT', () => {
		const at = fresh()
		const wt = ken(['get', KEY, '-b', 'feat'], at).stdout.trim()
		expect(ken(['path', 'root'], cloneOf(at))).toEqual(ok(at))
		expect(ken(['path', 'root'], wt)).toEqual(ok(at))
	})

	it('clones whole when .ken says clone.blobless=false, and refuses a value it cannot read', () => {
		const whole = fresh('clone.blobless=false\n')
		expect(ken(['get', KEY], whole).status).toBe(0)
		expect(config(cloneOf(whole), 'remote.origin.partialclonefilter')).toBe('')
		const bad = fresh('clone.blobless=flase\n')
		const r = ken(['get', KEY], bad)
		expect(r.status).toBe(1)
		expect(r.stderr).toContain(`${bad}/.ken sets clone.blobless to neither true nor false`)
		expect(existsSync(join(bad, '.repos'))).toBe(false)
	})

	it('registers nothing when the index lists the key, and a root with its front page line', () => {
		const listed = fresh()
		const index = `# The index.\n\nrepo: ${KEY}\ndesc: Lib.\n`
		write(join(listed, '.repos.index'), index)
		expect(ken(['get', KEY], listed).stderr).toBe('')
		expect(readFileSync(join(listed, '.repos.index'), 'utf8')).toBe(index)
		const r = ken(['get', 'example.com/acme/team'], listed)
		expect(r.stderr).toContain('with the first line of its front page as desc: "The team')
		expect(readFileSync(join(listed, '.repos.index'), 'utf8')).toBe(
			`${index}\nrepo: example.com/acme/team\ndesc: The team knowledge base.\n`
		)
	})

	it('uses a repo made with git init where the clone belongs, as it is, relative paths on', () => {
		const at = fresh()
		repo(cloneOf(at))
		// relative paths are set in the clone even where they were turned off
		git(cloneOf(at), 'config', 'worktree.useRelativePaths', 'false')
		const r = ken(['get', KEY], at)
		expect(r.stdout).toBe(`${cloneOf(at)}\n`)
		expect(r.stderr).toContain(registered(at))
		expect(config(cloneOf(at), 'worktree.useRelativePaths')).toBe('true\n')
		expect(config(cloneOf(at), 'remote.origin.url')).toBe('')
	})

	it('refuses a folder, a file, a link or a worktree in the way, and leaves it as it is', () => {
		const inTheWay: [string, (clone: string) => void][] = [
			['a folder with no .git', (c) => write(join(c, 'notes.md'), 'mine')],
			['a file', (c) => write(c, 'mine')],
			[
				`a symlink to ${join(dir, 'src-lib')}`,
				(c) => {
					mkdirSync(join(c, '..'), { recursive: true })
					symlinkSync(join(dir, 'src-lib'), c)
				}
			],
			[
				'a checkout whose .git is not a folder: a worktree',
				(c) => git(join(dir, 'src-lib'), 'worktree', 'add', '-q', '--detach', c)
			]
		]
		for (const [what, make] of inTheWay) {
			const at = fresh()
			const clone = cloneOf(at)
			make(clone)
			const before = shape(clone)
			const r = ken(['get', KEY], at)
			expect(r.status).toBe(1)
			expect(r.stdout).toBe('')
			expect(r.stderr).toContain(`${clone} is where the clone of ${KEY} belongs, but it is ${what}`)
			expect(r.stderr).toContain(`\`mv ${clone} ~/lib.aside\``)
			expect(shape(clone)).toBe(before)
			expect(existsSync(join(at, '.repos.index'))).toBe(false)
		}
		const plain = fresh()
		mkdirSync(cloneOf(plain), { recursive: true })
		expect(ken(['get', KEY], plain).stderr).toContain(
			`run \`git init ${cloneOf(plain)}\` then \`ken get ${KEY}\``
		)
	})

	it('refuses .repos, the host or the owner folder as a symlink, which leads out of the root', () => {
		for (const folder of ['', 'example.com', 'example.com/acme']) {
			const away = join(dir, `away-${++n}`)
			mkdirSync(away)
			const at = fresh()
			const link = join(at, '.repos', folder)
			mkdirSync(join(link, '..'), { recursive: true })
			symlinkSync(away, link)
			const r = ken(['get', KEY], at)
			expect(r.status).toBe(1)
			expect(r.stderr).toContain(`${link} is a symlink to ${away}, so a clone under it would be`)
			expect(r.stderr).toContain(`\`rm ${link} && mv ${away} ${link}\``)
			expect(readdirSync(away)).toEqual([])
		}
	})

	it('refuses a root in git that does not ignore .repos/, naming the line, before making anything', () => {
		const at = fresh()
		git(at, 'init', '-q')
		const r = ken(['get', KEY], at)
		expect(r.status).toBe(1)
		expect(r.stderr).toContain(`${at}/.repos is not ignored by the git of ${at}`)
		expect(r.stderr).toContain(`Add the line .repos/ to ${at}/.gitignore`)
		expect(readdirSync(at).sort()).toEqual(['.git', '.ken'])
		write(join(at, '.gitignore'), '.repos/\n')
		expect(ken(['get', KEY], at).stdout).toBe(`${cloneOf(at)}\n`)
		git(at, 'add', '-A')
		expect(git(at, 'status', '--porcelain')).toBe('A  .gitignore\nA  .ken\nA  .repos.index\n')
	})

	it("refuses the root's own repo, whose clone would be a root inside itself", () => {
		const at = fresh()
		git(at, 'init', '-q')
		git(at, 'remote', 'add', 'origin', 'git@example.com:acme/root.git')
		write(join(at, '.gitignore'), '.repos/\n')
		const r = ken(['get', 'example.com/acme/root', '-b', 'x'], at)
		expect(r.status).toBe(1)
		expect(r.stderr).toContain(`example.com/acme/root is the repo of the root ${at} itself`)
		expect(existsSync(join(at, '.repos'))).toBe(false)
	})

	it('gives a fresh clone or worktree with AGENTS.md its CLAUDE.md, excluded from git', () => {
		const at = fresh()
		const agents = cloneOf(at, 'example.com/acme/agents')
		const status = (cwd: string) => git(cwd, 'status', '--porcelain')
		const r = ken(['get', 'example.com/acme/agents'], at)
		expect(r.status).toBe(0)
		expect(readlinkSync(join(agents, 'CLAUDE.md'))).toBe('AGENTS.md')
		expect(r.stderr).toContain(`ken: linked ${agents}/CLAUDE.md -> AGENTS.md, excluded from git`)
		expect(readFileSync(join(agents, '.git/info/exclude'), 'utf8')).toMatch(/\n\/CLAUDE\.md\n$/)
		expect(status(agents)).toBe('')
		const wt = ken(['get', 'example.com/acme/agents', '-b', 'feat'], at)
		expect(wt.status).toBe(0)
		expect(readlinkSync(join(`${agents}.feat`, 'CLAUDE.md'))).toBe('AGENTS.md')
		expect(status(`${agents}.feat`)).toBe('')
		expect(
			readFileSync(join(agents, '.git/info/exclude'), 'utf8').match(/^\/CLAUDE\.md$/gm)
		).toHaveLength(1)
		// a clone already there is left as it is
		rmSync(join(agents, 'CLAUDE.md'))
		expect(ken(['get', 'example.com/acme/agents'], at).stderr).toBe('')
		expect(existsSync(join(agents, 'CLAUDE.md'))).toBe(false)
		// a repo with no AGENTS.md gets no link
		ken(['get', KEY], at)
		expect(existsSync(join(cloneOf(at), 'CLAUDE.md'))).toBe(false)
	})

	it('a failed clone leaves no folder, says what git said and what to rerun', () => {
		const at = fresh()
		const r = ken(['get', 'example.com/acme/missing'], at)
		expect(r.status).toBe(1)
		expect(r.stdout).toBe('')
		expect(r.stderr).toContain('does not appear to be a git repository')
		expect(r.stderr).toContain('A key alone clones https://example.com/acme/missing.git')
		expect(r.stderr).toContain('run `ken get example.com/acme/missing` again')
		expect(r.stderr).toContain('not pushed yet, or private to an account this machine lacks')
		expect(readdirSync(cloneOf(at, 'example.com/acme'))).toEqual([])
		expect(existsSync(join(at, '.repos.index'))).toBe(false)
	})

	it('two gets at once: one clones, the other waits for it, and both print the path', async () => {
		const at = fresh()
		const both = await Promise.all([kenAsync(['get', KEY], at), kenAsync(['get', KEY], at)])
		for (const r of both) expect([r.status, r.stdout]).toEqual([0, `${cloneOf(at)}\n`])
		expect(both.filter((r) => r.stderr.includes('ken: registered')).length).toBe(1)
		expect(readdirSync(cloneOf(at, 'example.com/acme'))).toEqual(['lib'])
		expect(readFileSync(join(at, '.repos.index'), 'utf8')).toBe(`repo: ${KEY}\n`)
	}, 20_000)

	it('two gets at once of a repo made with git init both set it up and print the path', async () => {
		const at = fresh()
		repo(cloneOf(at))
		const both = await Promise.all([kenAsync(['get', KEY], at), kenAsync(['get', KEY], at)])
		for (const r of both) expect([r.status, r.stdout]).toEqual([0, `${cloneOf(at)}\n`])
		expect(config(cloneOf(at), 'worktree.useRelativePaths')).toBe('true\n')
	}, 20_000)

	it('refuses a git older than 2.48 before touching anything', () => {
		const at = fresh()
		const r = ken(['get', KEY], at, { PATH: `${join(dir, 'old-git')}:${process.env.PATH}` })
		expect(r.status).toBe(1)
		expect(r.stderr).toContain('git version 2.47.1 is too old: ken needs git 2.48 or newer')
		expect(existsSync(join(at, '.repos'))).toBe(false)
	})

	it('a moved root keeps its checkouts: get prints them at the new path, and git works there', () => {
		const at = fresh()
		// relative paths even where the global config turns them off
		const off = join(dir, 'gitconfig-off')
		write(
			off,
			`${readFileSync(join(dir, 'gitconfig'), 'utf8')}[worktree]\n\tuseRelativePaths = false\n`
		)
		expect(ken(['get', KEY, '-b', 'feat/x'], at, { GIT_CONFIG_GLOBAL: off }).status).toBe(0)
		const moved = `${at}-moved`
		renameSync(at, moved)
		const wt = `${cloneOf(moved)}.feat-x`
		expect(ken(['get', KEY, '-b', 'feat/x'], moved)).toEqual(ok(wt))
		expect(git(wt, 'status', '--porcelain')).toBe('')
		expect(ken(['which'], wt)).toEqual(ok(`${KEY} worktree feat/x`))
		expect(ken(['repos'], moved).stdout).toContain(`  worktree feat/x  ${wt}\n`)
	})
})

describe('get -b', () => {
	/** A root with lib cloned into it. */
	const cloned = () => {
		const at = fresh()
		expect(ken(['get', KEY], at).status).toBe(0)
		const clone = cloneOf(at)
		return { at, clone, wt: (folder: string) => `${clone}.${folder}` }
	}
	const head = (cwd: string) => git(cwd, 'rev-parse', '--abbrev-ref', 'HEAD').trim()

	it('a new branch gets its worktree beside the clone, linked relatively; again prints it', () => {
		const { at, clone, wt } = cloned()
		const r = ken(['get', KEY, '-b', 'feat/x'], at)
		expect(r).toEqual(ok(wt('feat-x')))
		expect(readFileSync(join(wt('feat-x'), '.git'), 'utf8')).toMatch(
			/^gitdir: \.\.\/lib\/\.git\/worktrees\/[^/]+\n$/
		)
		expect(head(wt('feat-x'))).toBe('feat/x')
		expect(git(wt('feat-x'), 'rev-parse', 'HEAD')).toBe(git(clone, 'rev-parse', 'HEAD'))
		expect(ken(['get', KEY, '-b', 'feat/x'], at)).toEqual(r)
	})

	it('the default branch prints the clone; an existing branch gets its worktree', () => {
		const { at, clone, wt } = cloned()
		expect(ken(['get', KEY, '-b', 'main'], at).stdout).toBe(`${clone}\n`)
		git(clone, 'branch', 'old', 'v1')
		expect(ken(['get', KEY, '-b', 'old'], at).stdout).toBe(`${wt('old')}\n`)
		expect(head(wt('old'))).toBe('old')
		// a tag named main makes git shorten the default branch to heads/main, a branch of its own
		git(clone, 'tag', 'main')
		expect(ken(['get', KEY, '-b', 'heads/main'], at).stdout).toBe(`${wt('heads-main')}\n`)
		expect(ken(['get', KEY, '-b', 'main'], at).stdout).toBe(`${clone}\n`)
	})

	it('--from starts a new branch there, is refused for one that exists, and needs -b', () => {
		const { at, wt } = cloned()
		expect(ken(['get', KEY, '-b', 'fix', '--from', 'v1'], at).stdout).toBe(`${wt('fix')}\n`)
		expect(existsSync(join(wt('fix'), 'README.md'))).toBe(false)
		for (const branch of ['fix', 'main']) {
			const r = ken(['get', KEY, '-b', branch, '--from', 'v1'], at)
			expect(r.status).toBe(1)
			expect(r.stderr).toContain(`Run \`ken get ${KEY} -b ${branch}\` for its worktree`)
		}
		expect(ken(['get', KEY, '-b', 'new', '--from', 'nope'], at).stderr).toContain(
			'nope is no commit in'
		)
		expect(ken(['get', KEY, '--from', 'v1'], at).stderr).toContain('so it needs -b <branch>')
	})

	it("a branch named for a folder of another's is refused, never given that one's worktree", () => {
		const { at, clone, wt } = cloned()
		ken(['get', KEY, '-b', 'feat/x'], at)
		const r = ken(['get', KEY, '-b', 'feat'], at)
		expect([r.status, r.stdout]).toEqual([1, ''])
		expect(r.stderr).toContain('could not make the branch feat')
		expect(readdirSync(join(clone, '..'))).toEqual(['lib', 'lib.feat-x'])
		expect(head(wt('feat-x'))).toBe('feat/x')
	})

	it('a bad branch name is refused before the clone is touched', () => {
		const at = fresh()
		const r = ken(['get', KEY, '-b', 'a..b'], at)
		expect(r.status).toBe(1)
		expect(r.stderr).toContain('is not a branch name git accepts')
		expect(existsSync(join(at, '.repos'))).toBe(false)
	})

	it('a folder differing only by case is refused, naming the branch its worktree holds', () => {
		const { at, clone, wt } = cloned()
		ken(['get', KEY, '-b', 'feat'], at)
		const r = ken(['get', KEY, '-b', 'Feat'], at)
		expect(r.status).toBe(1)
		expect(r.stderr).toContain(`but ${wt('feat')} differs only by case from it`)
		expect(r.stderr).toContain(`a worktree of ${clone} holding the branch feat`)
		expect(git(clone, 'branch', '--list', 'Feat')).toBe('')
		expect(readdirSync(join(clone, '..'))).toEqual(['lib', 'lib.feat'])
	})

	it('an unborn default branch without --from, or a detached clone, is refused', () => {
		const at = fresh()
		const clone = cloneOf(at)
		mkdirSync(clone, { recursive: true })
		git(clone, 'init', '-q', '-b', 'main')
		const r = ken(['get', KEY, '-b', 'feat'], at)
		expect(r.status).toBe(1)
		expect(r.stderr).toContain('has no commit yet, so there is nothing to start feat from')
		expect(r.stderr).toContain(`\`ken get ${KEY} -b feat --from <ref>\``)
		git(clone, 'commit', '-q', '--allow-empty', '-m', 'one')
		git(clone, 'switch', '-q', '--detach')
		expect(ken(['get', KEY, '-b', 'feat'], at).stderr).toContain(
			`Run \`git -C ${clone} switch main\``
		)
		expect(readdirSync(join(clone, '..'))).toEqual(['lib'])
	})

	it('a branch held by a worktree whose folder is gone is refused, with the prune', () => {
		const { at, clone, wt } = cloned()
		ken(['get', KEY, '-b', 'feat'], at)
		rmSync(wt('feat'), { recursive: true })
		expect(ken(['get', KEY, '-b', 'feat'], at).stderr).toContain(
			`Run \`git -C ${clone} worktree prune\``
		)
	})

	/** A git on PATH ahead of the real one that runs `then` after the real git, for `ken`. */
	const wrapped = (name: string, then: string) => {
		const real = spawnSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).stdout.trim()
		const bin = join(dir, name)
		write(join(bin, 'git'), `#!/bin/sh\n${then.replace('REAL', real)}\n`, 0o755)
		return { PATH: `${bin}:${process.env.PATH}` }
	}

	it('a failed git worktree add leaves no branch behind, and says what is left', () => {
		const { at, clone, wt } = cloned()
		// a file put into the folder ken made, between its checks and the add
		const path = wrapped(
			'racy-git',
			`case " $* " in *" worktree add "*) : >"${wt('feat')}/mine" ;; esac\nexec REAL "$@"`
		)
		const r = ken(['get', KEY, '-b', 'feat'], at, path)
		expect(r.status).toBe(1)
		expect(r.stderr).toContain(`could not make the worktree of feat at ${wt('feat')}`)
		expect(r.stderr).toContain('Deleted the branch feat again.')
		expect(r.stderr).toContain(`Left ${wt('feat')}, which is not empty`)
		expect(git(clone, 'branch', '--list', 'feat')).toBe('')
	})

	it('a folder made by another get after the branch is left to it, the branch kept', () => {
		const { at, clone, wt } = cloned()
		// another get saw the branch, made the folder and is about to add its worktree
		const path = wrapped(
			'slow-git',
			`REAL "$@" || exit\nif [ "$3 $#" = "branch 5" ]; then mkdir "${wt('feat')}"; fi`
		)
		const r = ken(['get', KEY, '-b', 'feat'], at, path)
		expect(r.status).toBe(1)
		expect(r.stderr).toContain(`${wt('feat')} was made just now, by another \`ken get\``)
		git(clone, 'worktree', 'add', '-q', wt('feat'), 'feat')
		expect(head(wt('feat'))).toBe('feat')
	})

	it('two gets of one new branch at once: one branch, one worktree, one path', async () => {
		const { at, clone, wt } = cloned()
		const both = await Promise.all([
			kenAsync(['get', KEY, '-b', 'feat'], at),
			kenAsync(['get', KEY, '-b', 'feat'], at)
		])
		const won = both.filter((r) => r.status === 0)
		expect(won.length).toBeGreaterThan(0)
		for (const r of won) expect(r.stdout).toBe(`${wt('feat')}\n`)
		for (const r of both.filter((r) => r.status !== 0))
			expect(r.stderr).toMatch(/ken get example\.com\/acme\/lib -b feat/)
		expect(git(clone, 'branch', '--list', 'feat')).toBe('+ feat\n')
		expect(git(clone, 'worktree', 'list').trim().split('\n').length).toBe(2)
		expect(readdirSync(join(clone, '..'))).toEqual(['lib', 'lib.feat'])
	}, 20_000)
})

describe('repos', () => {
	const root = () => join(dir, 'repos-root')
	const own = () => join(root(), '.repos/example.com/acme')
	// The index lists app, lib with no desc, and tool, not cloned. On disk: app on main with a
	// worktree where its branch puts it, a detached one, and one moved off its folder; lib
	// switched to side; loose, a clone no entry lists, and example.com/.dot/..tools, whose key
	// parts start with dots. Clones of src-lib have origin/HEAD; the repos made here have no
	// remote-tracking branch, so they are local only.
	beforeAll(() => {
		const o = own()
		write(join(root(), '.ken'), 'ken.format=1\n')
		write(
			join(root(), '.repos.index'),
			'repo: example.com/acme/app\ndesc: The app.\n\nrepo: example.com/acme/lib\n\nrepo: example.com/acme/tool\ndesc: A tool.\n'
		)
		git(dir, 'clone', '-q', 'src-lib', join(o, 'app'))
		git(dir, 'clone', '-q', 'src-lib', join(o, 'lib'))
		git(join(o, 'lib'), 'switch', '-q', '-c', 'side')
		repo(join(o, 'loose'))
		repo(join(root(), '.repos/example.com/.dot/..tools'))
		const app = join(o, 'app')
		git(app, 'worktree', 'add', '-q', '-b', 'feat/ok', '../app.feat-ok')
		git(app, 'worktree', 'add', '-q', '--detach', '../app.pinned')
		git(app, 'worktree', 'add', '-q', '-b', 'feat/x', '../app.feat-x')
		git(app, 'worktree', 'move', '../app.feat-x', '../app.renamed')
		// a tag named as the remote HEAD's short form, which git then shortens to remotes/origin/main
		git(app, 'tag', 'origin/main')
	})

	it('lists the index over the disk, a row per key with its worktrees and strays', () => {
		const o = own()
		const unlisted = (key: string) =>
			`  stray: no entry lists it, so nothing says what it is and only this disk knows it. Run \`ken index set ${key} desc="..."\`.`
		expect(ken(['repos'], root())).toEqual(
			ok(
				[
					'example.com/.dot/..tools  not listed, cloned on main, local only',
					unlisted('example.com/.dot/..tools'),
					'example.com/acme/app  listed, cloned on main',
					'  The app.',
					`  worktree feat/ok  ${o}/app.feat-ok`,
					`  worktree (detached)  ${o}/app.pinned`,
					`  worktree feat/x  ${o}/app.renamed`,
					`  stray: the worktree of feat/x is at ${o}/app.renamed, not ${o}/app.feat-x, where \`ken get -b\` and \`ken path code\` look for it. Run \`git -C ${o}/app worktree move ${o}/app.renamed ${o}/app.feat-x\`.`,
					'example.com/acme/lib  listed, cloned on side',
					'  stray: no desc, and a desc is what lets an agent choose a repo before cloning it. Run `ken index set example.com/acme/lib desc="..."`.',
					`  stray: the clone has the branch side checked out, not its default branch main, which every \`ken get -b\` starts from. Run \`git -C ${o}/lib switch main\`, then \`ken get example.com/acme/lib -b side\`.`,
					'example.com/acme/loose  not listed, cloned on main, local only',
					unlisted('example.com/acme/loose'),
					'example.com/acme/tool  listed, not cloned',
					'  A tool.'
				].join('\n')
			)
		)
	})

	it('--porcelain: a line per key, key, desc, listed, cloned and branch split by tabs', () => {
		const r = ken(['repos', '--porcelain'], root())
		expect(r.status).toBe(0)
		expect(
			r.stdout
				.replace(/\n$/, '')
				.split('\n')
				.map((line) => line.split('\t'))
		).toEqual([
			['example.com/.dot/..tools', '', 'false', 'true', 'main'],
			['example.com/acme/app', 'The app.', 'true', 'true', 'main'],
			['example.com/acme/lib', '', 'true', 'true', 'side'],
			['example.com/acme/loose', '', 'false', 'true', 'main'],
			['example.com/acme/tool', 'A tool.', 'true', 'false', '']
		])
	})

	it('with no repo at all says so and what to run; an argument it does not take is refused', () => {
		const empty = fresh()
		expect(ken(['repos'], empty)).toEqual({
			status: 0,
			stdout: '',
			stderr: `ken: ${empty}/.repos.index lists no repo, and ${empty}/.repos holds no clone, so there is nothing to list. Run \`ken get <key>\` to clone a repo and list it, or \`ken index set <key> desc="..."\` to list one uncloned.\n`
		})
		expect(ken(['repos', '-v'], root()).stderr).toBe(
			'ken: ken repos takes only --porcelain, not -v. Run `ken repos --help`.\n'
		)
	})
})
