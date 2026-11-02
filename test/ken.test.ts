import { spawnSync } from 'node:child_process'
import {
	copyFileSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
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

// A root with one direct layer, a cloned repo, a nested root that is not a layer, a folder on
// PATH, and a HOME with no ~/ken, so nothing outside the temp folder is ever found.
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
	mkdirSync(join(root, '.repos/github.com/acme/web/src'), { recursive: true })
	write(join(root, 'notes/inner/.ken'), '')
	script(join(pathBin, 'ken-both'), 'echo path')
	script(join(pathBin, 'ken-team'), 'echo path')
	script(join(pathBin, 'ken-far'), 'echo far')
	mkdirSync(join(dir, 'home'))
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

	describe('help', () => {
		it('carries the same examples as <command> --help, and the external commands found', () => {
			const all = ken(['help']).stdout
			const page = ken(['path', '--help'])
			expect(page.status).toBe(0)
			expect(ken(['help', 'path']).stdout).toBe(page.stdout)
			const examples = page.stdout.split('Examples:\n')[1]?.trim().split('\n') ?? []
			expect(examples.length).toBeGreaterThan(2)
			for (const example of examples) expect(all).toContain(example.trim())
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
