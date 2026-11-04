// A layer is a workspace, end to end (docs/prd.md, decision 20 and "Layers"): a root with a
// layer that has a layer, all local, walked through the table from inside the layer.
import { spawnSync } from 'node:child_process'
import {
	copyFileSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	realpathSync,
	rmSync,
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
const env = () => ({ PATH: process.env.PATH, HOME: join(dir, 'home'), GIT_CONFIG_NOSYSTEM: '1' })
const write = (file: string, body: string, mode = 0o644) => {
	mkdirSync(join(file, '..'), { recursive: true })
	writeFileSync(file, body, { mode })
}
const run = (cwd: string, command: string, ...args: string[]) => {
	const r = spawnSync(command, args, {
		cwd,
		encoding: 'utf8',
		env: { ...env(), GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t' }
	})
	return { status: r.status, stdout: r.stdout, stderr: r.stderr }
}
// A remote at remotes/acme/<name>.git, served as https://example.com/acme/<name>, holding
// `files`, and the tracked link <name> -> .repos/<key> of each of `links`.
const remote = (
	name: string,
	files: Record<string, string>,
	links: Record<string, string> = {}
) => {
	const src = join(dir, `src-${name}`)
	mkdirSync(src)
	for (const [file, body] of Object.entries(files))
		write(join(src, file), body, file.startsWith('.bin/') ? 0o755 : 0o644)
	for (const [link, key] of Object.entries(links)) symlinkSync(`.repos/${key}`, join(src, link))
	const git = (...args: string[]) => {
		const r = run(src, 'git', '-c', 'user.name=t', '-c', 'user.email=t@t', ...args)
		if (r.status !== 0) throw new Error(r.stderr)
	}
	git('init', '-q', '-b', 'main')
	git('add', '-A')
	git('commit', '-q', '-m', name)
	git('clone', '-q', '--bare', src, join(dir, `remotes/acme/${name}.git`))
}

// The handbook, a layer with a page, a command and an index entry; the atlas, a layer listing
// the handbook with its tracked link, a command and an index entry; lib, a plain repo.
beforeAll(() => {
	dir = realpathSync.native(mkdtempSync(join(tmpdir(), 'ken-workspace-')))
	write(
		join(dir, 'home/.gitconfig'),
		`[url "file://${dir}/remotes/"]\n\tinsteadOf = https://example.com/\n[uploadpack]\n\tallowFilter = true\n`
	)
	remote('hb', {
		'.ken': '',
		'guide/x.md': 'the nested page\n',
		'.bin/ken-hb': '#!/bin/sh\necho hb\n',
		'.repos/index': 'repo: example.com/acme/hb-tool\ndesc: The handbook tool.\n'
	})
	remote(
		'atlas',
		{
			'.ken': 'layer.handbook=example.com/acme/hb\n',
			'README.md': '# Atlas\n\nThe sales atlas.\n',
			'.bin/ken-atlas': '#!/bin/sh\necho "atlas $KEN_ROOT"\n',
			'.repos/index': 'repo: example.com/acme/atlas-api\ndesc: The atlas API.\n'
		},
		{ handbook: 'example.com/acme/hb' }
	)
	remote('lib', { 'README.md': 'lib\n' })
})

describe.each(SHELLS)('a layer is a workspace, under %s', (shell) => {
	let top: string
	let atlas: string
	const code = (name: string) => join(top, '.repos/example.com/acme', name)
	const ken = (cwd: string, ...args: string[]) => run(cwd, shell, KEN, ...args)
	const ok = (cwd: string, ...args: string[]) => {
		const r = ken(cwd, ...args)
		if (r.status !== 0) throw new Error(`ken ${args.join(' ')} exited ${r.status}: ${r.stderr}`)
		return r.stdout
	}

	// The top: a root with its own command and index entry, the atlas added as its layer.
	beforeAll(() => {
		top = join(dir, `top-${shell}`)
		ok(dir, 'init', top)
		write(join(top, '.bin/ken-top'), '#!/bin/sh\necho top\n', 0o755)
		write(join(top, '.repos/index'), 'repo: example.com/acme/top-only\ndesc: The top only.\n')
		ok(top, 'layer', 'add', 'example.com/acme/atlas')
		atlas = code('atlas')
	}, 30_000)

	it('path code and which answer from the top, path root is the layer', () => {
		expect(ok(atlas, 'path', 'root')).toBe(`${atlas}\n`)
		expect(ok(join(top, 'atlas'), 'path', 'root')).toBe(`${atlas}\n`)
		expect(ok(atlas, 'path', 'code', 'example.com/acme/lib')).toBe(`${code('lib')}\n`)
		expect(ok(atlas, 'which')).toBe('example.com/acme/atlas clone main\n')
		expect(ok(atlas, 'which', code('hb'))).toBe('example.com/acme/hb clone main\n')
	})

	it("layer add registers the layer with its front page's first line of prose as desc", () => {
		expect(readFileSync(join(top, '.repos/index'), 'utf8')).toContain(
			'\nrepo: example.com/acme/atlas\ndesc: The sales atlas.\n'
		)
	})

	it("get clones at the top and registers in the layer's index; index set writes the layer's", () => {
		expect(ok(atlas, 'get', 'example.com/acme/lib')).toBe(`${code('lib')}\n`)
		expect(existsSync(join(code('lib'), '.git'))).toBe(true)
		expect(existsSync(join(atlas, '.repos/example.com/acme/lib'))).toBe(false)
		ok(atlas, 'index', 'set', 'example.com/acme/lib', 'desc=The shared lib.')
		expect(readFileSync(join(atlas, '.repos/index'), 'utf8')).toContain(
			'\nrepo: example.com/acme/lib\ndesc: The shared lib.\n'
		)
		expect(readFileSync(join(top, '.repos/index'), 'utf8')).not.toContain('acme/lib')
	}, 20_000)

	it("repos shows the layer's keys and its layer's, against the top's disk, not the top's", () => {
		expect(ok(atlas, 'repos', '--porcelain')).toBe(
			[
				'example.com/acme/atlas-api\tThe atlas API.\troot\tfalse\t',
				'example.com/acme/hb-tool\tThe handbook tool.\thandbook\tfalse\t',
				'example.com/acme/lib\tThe shared lib.\troot\ttrue\tmain',
				''
			].join('\n')
		)
	})

	it("layer add edits the layer's .ken and links, not the top's", () => {
		const before = readFileSync(join(top, '.ken'), 'utf8')
		ok(atlas, 'layer', 'add', 'example.com/acme/lib')
		expect(readFileSync(join(atlas, '.ken'), 'utf8')).toBe(
			'layer.handbook=example.com/acme/hb\nlayer.lib=example.com/acme/lib\n'
		)
		expect(readFileSync(join(top, 'atlas/lib/README.md'), 'utf8')).toBe('lib\n')
		expect(readFileSync(join(top, '.ken'), 'utf8')).toBe(before)
		ok(atlas, 'layer', 'remove', 'lib')
	}, 20_000)

	it("ken <name> finds the layer's .bin/, its direct layer's, then the top's, the nearer winning", () => {
		expect(ok(atlas, 'atlas')).toBe(`atlas ${atlas}\n`)
		expect(ok(atlas, 'hb')).toBe('hb\n')
		expect(ok(atlas, 'top')).toBe('top\n')
		write(join(top, '.bin/ken-hb'), '#!/bin/sh\necho top hb\n', 0o755)
		expect(ok(atlas, 'hb')).toBe('hb\n')
		const r = ken(atlas, 'nope')
		expect(r.status).toBe(1)
		expect(r.stderr).toContain(
			`${atlas}/.bin  (the scope)\n  ${code('hb')}/.bin  (layer handbook)\n  ${top}/.bin  (the top)`
		)
		expect(ok(top, 'top')).toBe('top\n')
		// the handbook arrives through the atlas, so its commands are read, never run, at the top
		expect(ok(top, 'hb')).toBe('top hb\n')
		rmSync(join(top, '.bin/ken-hb'))
		expect(ken(top, 'hb').status).toBe(1)
	})

	it("a layer's own .bin/ken, named by path, hands the call to the top's kernel; alone, it runs", () => {
		const layerKen = join(atlas, '.bin/ken')
		const topKen = join(top, '.bin/ken')
		copyFileSync(KEN, layerKen)
		// identical to the top's: runs itself, scoped to the layer
		expect(run(atlas, shell, layerKen, 'path', 'root').stdout).toBe(`${atlas}\n`)
		try {
			write(topKen, '#!/bin/sh\necho "top kernel $*"\n', 0o755)
			expect(run(atlas, shell, layerKen, 'path', 'root').stdout).toBe('top kernel path root\n')
			// the kernel on PATH is not a layer's: it runs as it is, scoped to the layer
			expect(ok(atlas, 'path', 'root')).toBe(`${atlas}\n`)
		} finally {
			copyFileSync(KEN, topKen)
		}
		// cloned alone, the layer is its own top
		const alone = join(dir, `alone-${shell}`)
		ok(dir, 'init', alone)
		expect(run(alone, shell, join(alone, '.bin/ken'), 'path', 'root').stdout).toBe(`${alone}\n`)
		rmSync(layerKen)
	})

	it('a worktree of the layer made with get -b is a root whose links resolve', () => {
		const wt = ok(top, 'get', 'example.com/acme/atlas', '-b', 'feat/x').trim()
		expect(wt).toBe(code('atlas.feat-x'))
		expect(ok(wt, 'path', 'root')).toBe(`${wt}\n`)
		expect(ok(wt, 'which')).toBe('example.com/acme/atlas worktree feat/x\n')
		expect(readFileSync(join(wt, 'handbook/guide/x.md'), 'utf8')).toBe('the nested page\n')
		expect(run(wt, 'git', 'status', '--porcelain').stdout).toBe('')
	}, 20_000)

	// rg -L's search, in POSIX: follow links, skip hidden folders, list files holding the words
	const search = () =>
		run(
			top,
			'sh',
			'-c',
			"find -L . -name '.?*' -prune -o -type f -exec grep -l 'the nested page' {} +"
		).stdout

	it('search from the top finds a page of the nested layer through two links', () => {
		expect(search()).toBe('./atlas/handbook/guide/x.md\n')
	})

	it('a key added by both the top and a layer is one clone with two links', () => {
		ok(top, 'layer', 'add', 'example.com/acme/hb', '--as', 'handbook')
		expect(realpathSync(join(top, 'handbook'))).toBe(code('hb'))
		expect(realpathSync(join(top, 'atlas/handbook'))).toBe(code('hb'))
		expect(readdirSync(join(top, '.repos/example.com/acme')).sort()).toEqual([
			'atlas',
			'atlas.feat-x',
			'hb',
			'lib'
		])
		const found = search().split('\n').sort()
		expect(found).toEqual(['', './atlas/handbook/guide/x.md', './handbook/guide/x.md'])
		// now a direct layer of the top, the handbook's commands run there
		expect(ok(top, 'hb')).toBe('hb\n')
	}, 20_000)
})
