import { spawnSync } from 'node:child_process'
import {
	copyFileSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	realpathSync,
	statSync,
	symlinkSync,
	writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'

const KEN = join(import.meta.dirname, '..', 'ken')
const hasDash = spawnSync('sh', ['-c', 'command -v dash']).status === 0
const SHELLS = hasDash ? ['sh', 'dash'] : ['sh']

let dir: string
let root: string
let atlas: string
let pathBin: string

const write = (file: string, body: string, mode = 0o644) => {
	mkdirSync(join(file, '..'), { recursive: true })
	writeFileSync(file, body, { mode })
}
const script = (file: string, body: string, mode = 0o755) =>
	write(file, `#!/bin/sh\n${body}\n`, mode)
// git with no config but its own, so the user's (signing, hooks, default branch) never leaks in
const git = (cwd: string, ...args: string[]) => {
	const r = spawnSync('git', args, {
		cwd,
		encoding: 'utf8',
		env: {
			PATH: process.env.PATH,
			HOME: join(dir, 'home'),
			GIT_CONFIG_NOSYSTEM: '1',
			GIT_AUTHOR_NAME: 't',
			GIT_AUTHOR_EMAIL: 't@t',
			GIT_COMMITTER_NAME: 't',
			GIT_COMMITTER_EMAIL: 't@t'
		}
	})
	if (r.status !== 0) throw new Error(r.stderr)
}
const repo = (path: string) => {
	mkdirSync(path, { recursive: true })
	git(path, 'init', '-q', '-b', 'main')
	git(path, 'commit', '-q', '--allow-empty', '-m', 'init')
}

// A root with one direct layer and its link, a clone with a worktree beside it and a detached
// one elsewhere, a folder with no .git where a checkout belongs, a worktree of a clone outside
// the root, a nested root that is not a layer, a folder on PATH, and a HOME with no ~/ken, so
// nothing outside the temp folder is ever found.
beforeAll(() => {
	dir = realpathSync.native(mkdtempSync(join(tmpdir(), 'ken-')))
	root = join(dir, 'root')
	atlas = join(root, '.repos/github.com/acme/atlas')
	pathBin = join(dir, 'path-bin')
	write(join(root, '.ken'), '# settings\nclone.blobless=true\nlayer.atlas=github.com/acme/atlas\n')
	script(join(root, '.bin/ken-hello'), 'printf "%s|" "$KEN_ROOT" "$@"; exit 3')
	script(join(root, '.bin/ken-both'), 'echo scope')
	script(join(root, '.bin/ken-path'), 'echo shadowed')
	script(join(root, '.bin/ken-plain'), 'echo plain', 0o644)
	write(join(atlas, '.ken'), '')
	script(join(atlas, '.bin/ken-both'), 'echo layer')
	script(join(atlas, '.bin/ken-team'), 'echo layer')
	mkdirSync(join(atlas, 'sub'))
	mkdirSync(join(dir, 'home'))
	repo(atlas)
	symlinkSync('.repos/github.com/acme/atlas', join(root, 'atlas'))
	const app = join(root, '.repos/github.com/acme/app')
	repo(app)
	mkdirSync(join(app, 'src/deep'), { recursive: true })
	git(app, 'worktree', 'add', '-q', '-b', 'feat/x', '../app.feat-x')
	mkdirSync(join(app, '../app.feat-x/src/deep'), { recursive: true })
	git(app, 'worktree', 'add', '-q', '--detach', '../../other/elsewhere')
	git(app, 'worktree', 'add', '-q', '-b', 'feat+fix', '../app.feat+fix')
	write(join(app, 'src/a.ts'), '')
	symlinkSync('.repos/github.com/acme/app/src/a.ts', join(root, 'a.ts'))
	symlinkSync('.repos/github.com/acme/offline', join(root, 'offline'))
	symlinkSync('loop', join(root, 'loop'))
	repo(join(dir, 'away'))
	git(
		join(dir, 'away'),
		'worktree',
		'add',
		'-q',
		'--detach',
		join(root, '.repos/github.com/acme/stray')
	)
	mkdirSync(join(root, '.repos/github.com/acme/web/src'), { recursive: true })
	write(join(root, 'notes/inner/.ken'), '')
	script(join(pathBin, 'ken-both'), 'echo path')
	script(join(pathBin, 'ken-team'), 'echo path')
	script(join(pathBin, 'ken-far'), 'echo far')
	mkdirSync(join(dir, 'outside'))
	symlinkSync(root, join(dir, 'link'))
})

describe.each(SHELLS)('ken under %s', (shell) => {
	const ken = (
		args: string[],
		opts: { cwd?: string; env?: Record<string, string>; file?: string } = {}
	) => {
		const r = spawnSync(shell, [opts.file ?? KEN, ...args], {
			cwd: opts.cwd ?? root,
			encoding: 'utf8',
			env: {
				PATH: `${pathBin}:${process.env.PATH}`,
				HOME: join(dir, 'home'),
				...opts.env
			}
		})
		return { status: r.status, stdout: r.stdout, stderr: r.stderr }
	}

	describe('init', () => {
		const outside = () => join(dir, 'outside')
		const files = (folder: string) =>
			Object.fromEntries(
				readdirSync(folder, { recursive: true, encoding: 'utf8' })
					.sort()
					.map((f) => {
						const at = join(folder, f)
						return [f, statSync(at).isDirectory() ? 'dir' : readFileSync(at, 'utf8')]
					})
			)

		it('gives a fresh folder only the files ken owns, the kernel a copy; a rerun creates nothing', () => {
			const fresh = join(dir, `fresh-${shell}/a/b`)
			const r = ken(['init', fresh], { cwd: outside() })
			expect(r.status).toBe(0)
			expect(r.stdout).toContain(`${fresh} is a root.`)
			const made = files(fresh)
			expect(Object.keys(made)).toEqual([
				'.bin',
				'.bin/ken',
				'.gitignore',
				'.ken',
				'.repos',
				'.repos/index'
			])
			expect(made['.bin/ken']).toBe(readFileSync(KEN, 'utf8'))
			expect(statSync(join(fresh, '.bin/ken')).mode & 0o111).toBe(0o111)
			expect(made['.gitignore']).toBe('.repos/*/*/*/\n.env\n')
			expect(made['.ken']).toMatch(
				/^# .*\n# .*docs\/files\.md in github\.com\/xiaoxinghu\/ken\.\n$/
			)
			expect(made['.repos/index']).toMatch(/^# .repos\/index: [^\n]*\n$/)
			const again = ken(['init', fresh], { cwd: outside() })
			expect(again.status).toBe(0)
			expect(again.stdout).toContain('nothing was created')
			expect(files(fresh)).toEqual(made)
		})

		it('keeps what is there: an existing .gitignore gains only the rule it lacks', () => {
			const kept = join(dir, `kept-${shell}`)
			write(join(kept, '.gitignore'), 'node_modules/\n.env  ')
			write(join(kept, '.ken'), 'org.me=github.com/me\n')
			write(join(kept, '.bin/ken'), 'mine\n')
			expect(ken(['init', kept], { cwd: outside() }).status).toBe(0)
			const after = files(kept)
			expect(after['.gitignore']).toBe('node_modules/\n.env  \n.repos/*/*/*/\n')
			expect(after['.ken']).toBe('org.me=github.com/me\n')
			expect(after['.bin/ken']).toBe('mine\n')
		})

		it('refuses a folder inside a root, naming the nearest root, and makes nothing', () => {
			const cases: [string, string][] = [
				[join(root, `notes/new-${shell}`), root],
				[join(root, '.repos/github.com/acme/web/src'), root],
				[join(atlas, `sub/new-${shell}`), atlas]
			]
			for (const [inside, above] of cases) {
				const r = ken(['init', inside], { cwd: outside() })
				expect(r.status).toBe(1)
				expect(r.stderr).toContain(`${inside} is inside the root ${above} but`)
				expect(existsSync(join(inside, '.ken'))).toBe(false)
			}
			expect(existsSync(join(root, `notes/new-${shell}`))).toBe(false)
		})

		it('accepts a checkout at <root>/.repos/<host>/<owner>/<repo>, through every root above', () => {
			for (const checkout of [
				join(root, `.repos/github.com/acme/new-${shell}`),
				join(atlas, `.repos/github.com/acme/deep-${shell}`)
			]) {
				mkdirSync(checkout, { recursive: true })
				expect(ken(['init'], { cwd: checkout }).status).toBe(0)
				expect(existsSync(join(checkout, '.ken'))).toBe(true)
			}
		})

		it('says how to point ken at the folder only when it is not the root found from here', () => {
			const home = join(dir, `home-${shell}`)
			const other = join(dir, `other-${shell}`)
			const env = { HOME: home }
			mkdirSync(home)
			expect(ken(['init', join(home, 'ken')], { cwd: outside(), env }).stdout).not.toContain(
				'KEN_ROOT='
			)
			const hint = ken(['init', other], { cwd: outside(), env }).stdout
			expect(hint).toContain(`acts on ${home}/ken, not ${other};`)
			expect(hint).toContain(`\n  ln -s ${other}/.bin/ken ~/.local/bin/ken\n`)
			expect(hint).toContain(`\n  export KEN_ROOT=${other}\n`)
			expect(ken(['init'], { cwd: other, env }).stdout).not.toContain('KEN_ROOT=')
		})
	})

	describe('path', () => {
		it('code lowercases the key and puts the branch worktree beside the clone, / as -', () => {
			expect(ken(['path', 'code', 'github.com/Acme/Join-Web', 'feat/login'])).toEqual({
				status: 0,
				stdout: `${root}/.repos/github.com/acme/join-web.feat-login\n`,
				stderr: ''
			})
			for (const url of [
				'ssh://git@github.com:22/Acme/Join-Web.git',
				'git@github.com:Acme/Join-Web.git',
				'github.com:acme/join-web.git'
			]) {
				expect(ken(['path', 'code', url]).stdout).toBe(`${root}/.repos/github.com/acme/join-web\n`)
			}
		})

		it('refuses a URL with userinfo as a key or a branch, never printing the secret', () => {
			const url = 'https://me:s3cret@github.com/acme/join-web'
			for (const args of [
				['path', 'code', 'github.com/acme/join-web', url],
				['path', 'code', `${url}/extra`]
			]) {
				const r = ken(args)
				expect(r.status).toBe(1)
				expect(r.stdout).toBe('')
				expect(r.stderr).toMatch(/^ken: https:\/\/github.com\/acme\/join-web.* is not a/)
				expect(r.stderr).not.toContain('s3cret')
			}
		})

		it('refuses @, which git check-ref-format takes but git branch does not', () => {
			const r = ken(['path', 'code', 'github.com/acme/join-web', '@'])
			expect(r.status).toBe(1)
			expect(r.stderr).toContain('not a branch name')
		})

		it('resolves a reference to a cloned repo to the file, to an uncloned one to its URL', () => {
			expect(ken(['path', 'github.com/Acme/Web:src/a.ts#run'])).toEqual({
				status: 0,
				stdout: `${root}/.repos/github.com/acme/web/src/a.ts\n`,
				stderr: ''
			})
			const r = ken(['path', 'github.com/acme/api:src/a.ts#run'])
			expect(r.status).toBe(0)
			expect(r.stdout).toBe('https://github.com/acme/api.git\n')
			expect(r.stderr).toContain('Run `ken get github.com/acme/api` to clone it')
			const leak = ken([
				'path',
				'github.com/acme/api:https://me:s3cret@x.io/a#https://me:s3cret@x.io'
			])
			expect(leak.stderr).toContain('ken get github.com/acme/api')
			expect(leak.stderr).not.toContain('s3cret')
		})

		it('refuses a reference that climbs out of its repo', () => {
			expect(ken(['path', 'github.com/acme/web:src/../../atlas/x']).status).toBe(1)
			expect(ken(['path', 'github.com/acme/web:src/../a.ts']).status).toBe(0)
		})
	})

	describe('which', () => {
		const r = (path: string, cwd = root) => ken(['which', path], { cwd })
		const ok = (stdout: string) => ({ status: 0, stdout: `${stdout}\n`, stderr: '' })

		it('a clone and a worktree beside it, at their roots and deep inside, from git', () => {
			const at = join(root, '.repos/github.com/acme')
			expect(ken(['which'], { cwd: join(at, 'app') })).toEqual(ok('github.com/acme/app clone main'))
			expect(r('.repos/github.com/acme/app/src/deep')).toEqual(ok('github.com/acme/app clone main'))
			expect(r('src/deep', join(at, 'app.feat-x'))).toEqual(
				ok('github.com/acme/app worktree feat/x')
			)
			expect(ken(['which'], { cwd: join(at, 'app.feat-x/src/deep') })).toEqual(
				ok('github.com/acme/app worktree feat/x')
			)
		})

		it('a worktree is keyed by its clone wherever its folder is, detached with no branch', () => {
			expect(r('.repos/github.com/other/elsewhere')).toEqual(ok('github.com/acme/app worktree'))
		})

		it('a worktree whose branch has a character no key may hold is keyed by its clone', () => {
			expect(r('.repos/github.com/acme/app.feat+fix')).toEqual(
				ok('github.com/acme/app worktree feat+fix')
			)
		})

		it('a symlink to a file is followed to the checkout the file is in', () => {
			expect(r('a.ts')).toEqual(ok('github.com/acme/app clone main'))
		})

		it("an offline layer's dangling link is followed and answered from its shape", () => {
			expect(r('offline/x.md')).toEqual(ok('github.com/acme/offline clone'))
		})

		it('a symlink cycle ends, as a path in the root outside a checkout', () => {
			expect(r('loop').stderr).toContain(
				`${root}/loop is in the ken root ${root} but in no checkout`
			)
		})

		it('a layer is a checkout of the root above it, through its link and from inside it', () => {
			expect(r('atlas/sub')).toEqual(ok('github.com/acme/atlas clone main'))
			expect(r('missing/../atlas/sub')).toEqual(ok('github.com/acme/atlas clone main'))
			expect(ken(['which'], { cwd: join(root, 'atlas/sub') })).toEqual(
				ok('github.com/acme/atlas clone main')
			)
		})

		it('a path not checked out yet is answered from its shape, with no branch', () => {
			expect(r('.repos/github.com/Acme/api/src/x.ts')).toEqual(ok('github.com/acme/api clone'))
			expect(r('.repos/github.com/acme/app.other/src')).toEqual(ok('github.com/acme/app worktree'))
			// a worktree's .git is a file, so app.feat-x is not a clone to be a worktree of
			expect(r('.repos/github.com/acme/app.feat-x.y')).toEqual(ok('github.com/acme/app worktree'))
			expect(r('.repos/github.com/acme/new/../api/x')).toEqual(ok('github.com/acme/api clone'))
		})

		it('a folder where a checkout belongs with no .git is refused, with the ken get to run', () => {
			const res = r('.repos/github.com/acme/web/src')
			expect(res.status).toBe(1)
			expect(res.stderr).toContain(`${root}/.repos/github.com/acme/web is where a checkout belongs`)
			expect(res.stderr).toContain('`ken get github.com/acme/web`')
		})

		it('a path in the root outside a checkout, or outside the top, is refused', () => {
			for (const path of ['notes', '.repos/github.com/acme']) {
				const res = r(path)
				expect(res.status).toBe(1)
				expect(res.stderr).toContain(
					`${root}/${path} is in the ken root ${root} but in no checkout`
				)
			}
			const out = r('../outside')
			expect(out.status).toBe(1)
			expect(out.stderr).toContain(`${dir}/outside is outside the top root ${root}`)
		})

		it('a worktree of a clone outside the root is refused, with the git worktree move', () => {
			const res = r('.repos/github.com/acme/stray')
			expect(res.status).toBe(1)
			expect(res.stderr).toContain(
				`\`git -C ${dir}/away worktree move ${root}/.repos/github.com/acme/stray ${dir}/stray\``
			)
		})
	})

	describe('the root', () => {
		it('a layer under <top>/.repos/ is the scope from inside it, and the top stays', () => {
			const cwd = join(atlas, 'sub')
			expect(ken(['path', 'root'], { cwd }).stdout).toBe(`${atlas}\n`)
			expect(ken(['path', 'code', 'github.com/acme/x'], { cwd }).stdout).toBe(
				`${root}/.repos/github.com/acme/x\n`
			)
		})

		it('a .ken reached not through .repos/ is its own top, inside a layer too', () => {
			for (const inner of [join(root, 'notes/inner'), join(atlas, 'notes/inner')]) {
				write(join(inner, '.ken'), '')
				expect(ken(['path', 'code', 'github.com/acme/x'], { cwd: inner }).stdout).toBe(
					`${inner}/.repos/github.com/acme/x\n`
				)
			}
		})

		it('KEN_ROOT wins over the cwd, resolved to its real path', () => {
			const r = ken(['path', 'root'], {
				cwd: join(root, 'notes/inner'),
				env: { KEN_ROOT: join(dir, 'link') }
			})
			expect(r.stdout).toBe(`${root}\n`)
		})

		it('outside any root, ken run through a symlink finds the root it lives in', () => {
			const own = join(dir, `own-${shell}`)
			write(join(own, '.ken'), '')
			mkdirSync(join(own, '.bin'))
			copyFileSync(KEN, join(own, '.bin/ken'))
			mkdirSync(join(dir, `bin-${shell}`))
			symlinkSync(`../own-${shell}/.bin/ken`, join(dir, `bin-${shell}/ken`))
			const r = ken(['path', 'root'], {
				cwd: join(dir, 'outside'),
				file: join(dir, `bin-${shell}/ken`)
			})
			expect(r.stdout).toBe(`${own}\n`)
		})

		it('a root that does not exist is refused, naming the path and where it came from', () => {
			const r = ken(['path', 'root'], { cwd: join(dir, 'outside') })
			expect(r.status).toBe(1)
			expect(r.stderr).toContain(`the ken root ${join(dir, 'home/ken')} (from the default, ~/ken)`)
			expect(r.stderr).toContain(`ken init ${join(dir, 'home/ken')}`)
		})
	})

	describe('ken <name>', () => {
		it("runs the scope's ken-<name> with KEN_ROOT the real scope, returning its exit code", () => {
			const r = ken(['hello', 'a b', '--help'], { env: { KEN_ROOT: join(dir, 'link') } })
			expect(r).toEqual({ status: 3, stdout: `${root}|a b|--help|`, stderr: '' })
		})

		it("looks in the scope's .bin, then each direct layer's, then PATH", () => {
			expect(ken(['both']).stdout).toBe('scope\n')
			expect(ken(['team']).stdout).toBe('layer\n')
			expect(ken(['far']).stdout).toBe('far\n')
		})

		it('a builtin cannot be shadowed', () => {
			expect(ken(['path', 'root']).stdout).toBe(`${root}\n`)
		})

		it('not found, names the folders it looked in, in order', () => {
			const r = ken(['nope'])
			expect(r.status).toBe(1)
			const at = [
				`${root}/.bin  (the scope)`,
				`${atlas}/.bin  (layer atlas)`,
				`${pathBin}  (PATH)`
			].map((line) => r.stderr.indexOf(`\n  ${line}\n`))
			expect(at.every((i) => i > 0)).toBe(true)
			expect([...at].sort((a, b) => a - b)).toEqual(at)
		})

		it('a match that is not executable is named with the chmod +x to run', () => {
			const r = ken(['plain'])
			expect(r.status).toBe(1)
			expect(r.stderr).toContain(`Run \`chmod +x ${root}/.bin/ken-plain\``)
		})

		it('a layer named twice in .ken is the last line, and only that layer is searched', () => {
			const twice = join(dir, `twice-${shell}`)
			write(join(twice, '.ken'), 'layer.t=github.com/acme/old\nlayer.t=github.com/acme/new\n')
			script(join(twice, '.repos/github.com/acme/old/.bin/ken-which-layer'), 'echo old')
			script(join(twice, '.repos/github.com/acme/new/.bin/ken-which-layer'), 'echo new')
			expect(ken(['which-layer'], { cwd: twice }).stdout).toBe('new\n')
			expect(ken(['nope'], { cwd: twice }).stderr).not.toContain('acme/old')
		})

		it('a layer line in .ken that ken cannot read stops it, naming the file and line', () => {
			const bad = join(dir, `bad-${shell}`)
			write(join(bad, '.ken'), '# x\nlayer.atlas=github.com/acme\n')
			const r = ken(['far'], { cwd: bad })
			expect(r.status).toBe(1)
			expect(r.stderr).toContain(`${bad}/.ken line 2`)
		})
	})

	describe('index', () => {
		const KEY = 'github.com/acme/web'
		let n = 0
		// A fresh root whose .repos/index holds `body`, or none when undefined.
		const fresh = (body?: string) => {
			const at = join(dir, `index-${shell}-${n++}`)
			write(join(at, '.ken'), '')
			if (body !== undefined) write(join(at, '.repos/index'), body)
			const index = join(at, '.repos/index')
			return { cwd: at, index, read: () => readFileSync(index, 'utf8') }
		}
		const OTHERS = '# The index.\n\nowner: github.com/acme\ndesc: Acme.\n\n'

		it('set creates the file and the entry and nothing else, saying what and where', () => {
			const r = fresh()
			expect(ken(['index', 'set', KEY, 'desc=Web.', 'kind=fe'], r)).toEqual({
				status: 0,
				stdout: `Set desc, kind in a new entry for ${KEY}, in ${r.index}.\n`,
				stderr: ''
			})
			expect(r.read()).toBe(`repo: ${KEY}\ndesc: Web.\nkind: fe\n`)
			const empty = fresh('')
			ken(['index', 'set', KEY, 'desc=Web.'], empty)
			expect(empty.read()).toBe(`repo: ${KEY}\ndesc: Web.\n`)
		})

		it('set of a second repo appends its stanza, keeping the first and the comment on top', () => {
			const r = fresh(`${OTHERS}repo: github.com/acme/api\ndesc: API.`)
			ken(['index', 'set', KEY, 'desc=Web.'], r)
			expect(r.read()).toBe(
				`${OTHERS}repo: github.com/acme/api\ndesc: API.\n\nrepo: ${KEY}\ndesc: Web.\n`
			)
		})

		it('set replaces a field in place and appends a new one, other lines kept as they are', () => {
			const tail = '\n\n\n# about api\nrepo: github.com/acme/api\ndesc: API.\n'
			const r = fresh(`${OTHERS}repo: ${KEY}\ndesc: Web.\n# who: sales\nkind: fe\n${tail}`)
			ken(['index', 'set', KEY, 'kind=be', 'tags=sales join', 'owner=team-x'], r)
			expect(r.read()).toBe(
				`${OTHERS}repo: ${KEY}\ndesc: Web.\n# who: sales\nkind: be\ntags: sales join\nowner: team-x\n${tail}`
			)
		})

		it('a value with # and = in it, and a backslash, reads back as written', () => {
			const r = fresh()
			const value = 'see #12, a=b \\t c'
			ken(['index', 'set', KEY, `desc=${value}`, 'doc=#top'], r)
			ken(['index', 'set', KEY, 'kind=fe'], r)
			expect(r.read()).toBe(`repo: ${KEY}\ndesc: ${value}\ndoc: #top\nkind: fe\n`)
		})

		it('an entry of only its repo line has no fields, and gains them on set', () => {
			const r = fresh(`repo: ${KEY}\n`)
			expect(ken(['index', 'unset', KEY, 'kind'], r).stderr).toContain('its fields are none')
			ken(['index', 'set', KEY, 'kind=fe'], r)
			expect(r.read()).toBe(`repo: ${KEY}\nkind: fe\n`)
		})

		it('unset removes the fields, or the whole entry and the blank line after it', () => {
			const r = fresh(`${OTHERS}repo: ${KEY}\ndesc: Web.\nkind: fe\ntags: a\n\nrepo: x.io/a/b\n`)
			expect(ken(['index', 'unset', KEY, 'kind', 'tags'], r).stdout).toBe(
				`Removed kind, tags from the entry for ${KEY}, in ${r.index}.\n`
			)
			expect(r.read()).toBe(`${OTHERS}repo: ${KEY}\ndesc: Web.\n\nrepo: x.io/a/b\n`)
			ken(['index', 'unset', KEY], r)
			expect(r.read()).toBe(`${OTHERS}repo: x.io/a/b\n`)
		})

		it('unset refuses desc alone, a field the entry lacks, and a key with no entry', () => {
			const body = `repo: ${KEY}\ndesc: Web.\nkind: fe\n`
			const r = fresh(body)
			const refused = (args: string[]) => {
				const out = ken(['index', 'unset', ...args], r)
				expect(out.status).toBe(1)
				return out.stderr
			}
			expect(refused([KEY, 'kind', 'desc'])).toContain(
				`ken index unset ${KEY}\` to remove the whole`
			)
			expect(refused([KEY, 'tags'])).toContain('its fields are desc, kind.')
			expect(refused(['github.com/acme/api'])).toContain(
				`github.com/acme/api has no entry in ${r.index}`
			)
			expect(r.read()).toBe(body)
		})

		it('set refuses an empty value, a newline, a bad field name and the repo line', () => {
			const r = fresh()
			for (const arg of ['desc=', 'desc= ', 'doc=a\nb', 'a.b=c', 'kind', 'repo=x.io/a/b']) {
				const out = ken(['index', 'set', KEY, arg], r)
				expect(out.status).toBe(1)
				expect(out.stderr).toMatch(/^ken: .*run (e\.g\. )?`ken index (un)?set /i)
			}
			expect(existsSync(r.index)).toBe(false)
		})

		it('an index path that is not a file is refused, nothing written into it', () => {
			const r = fresh()
			mkdirSync(r.index, { recursive: true })
			const out = ken(['index', 'set', KEY, 'desc=Web.'], r)
			expect(out.status).toBe(1)
			expect(out.stderr).toContain(`${r.index} is not a file`)
			expect(readdirSync(r.index)).toEqual([])
		})

		it('an index ken cannot read stops it, naming the file, the line and what it expected', () => {
			for (const [body, line, what] of [
				['# top\n\ndesc: no key\n', 3, 'opens a stanza'],
				['repo: github.com/Acme/web\n', 1, 'opens a stanza'],
				['owner: github.com/acme/web\n', 1, 'opens a stanza'],
				[`repo: ${KEY}\n\nrepo: ${KEY}\n`, 3, 'repeats the key of the stanza at line 1'],
				[`repo: ${KEY}\nkind fe\n`, 2, 'is not a field line'],
				[`repo: ${KEY}\nkind: a\n# c\nkind: b\n`, 4, 'names kind a second time'],
				[`repo: ${KEY}\ndesc:  \n`, 2, 'is an empty desc']
			] as const) {
				const r = fresh(body)
				const out = ken(['index', 'set', 'github.com/acme/api', 'desc=API.'], r)
				expect(out.status).toBe(1)
				expect(out.stderr).toContain(`ken: ${r.index} line ${line}, `)
				expect(out.stderr).toContain(what)
				expect(r.read()).toBe(body)
				expect(readdirSync(join(r.cwd, '.repos'))).toEqual(['index'])
			}
		})
	})

	describe('help', () => {
		it('carries the same examples as <command> --help, and the external commands found', () => {
			const all = ken(['help']).stdout
			for (const name of ['init', 'path', 'which', 'index']) {
				const page = ken([name, '--help'])
				expect(page.status).toBe(0)
				expect(ken(['help', name]).stdout).toBe(page.stdout)
				const examples = page.stdout.split('Examples:\n')[1]?.trim().split('\n') ?? []
				expect(examples.length).toBeGreaterThan(2)
				for (const example of examples) expect(all).toContain(example.trim())
			}
			expect(all).toContain(`  the scope, ${root}/.bin: both, hello\n`)
			expect(all).toContain(`  layer atlas, ${atlas}/.bin: team\n`)
			expect(all).toContain(`  PATH, ${pathBin}: far\n`)
		})

		it('lists the builtins outside any root, saying why no external commands are listed', () => {
			const r = ken([], { cwd: join(dir, 'outside') })
			expect(r.status).toBe(0)
			expect(r.stdout).toContain('  path root | code <key>')
			expect(r.stdout).toContain('External commands: none listed, because the ken root')
		})
	})
})

it('the kernel stays under its cap of 1,200 lines, so it is read in a sitting', () => {
	expect(readFileSync(KEN, 'utf8').split('\n').length).toBeLessThan(1200)
})
