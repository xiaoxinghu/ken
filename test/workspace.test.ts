// A layer is a workspace, end to end (docs/prd.md, decision 20 and "Layers"): a root with a
// layer that has a layer, all local, walked through the table from inside the layer, and the
// checkouts in KEN_SRC, outside the root.
import { spawnSync } from 'node:child_process'
import {
	copyFileSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	realpathSync,
	rmSync,
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
let src = ''
const write = (file: string, body: string, mode = 0o644) => {
	mkdirSync(join(file, '..'), { recursive: true })
	writeFileSync(file, body, { mode })
}
const run = (cwd: string, command: string, ...args: string[]) => runIn({}, cwd, command, ...args)
const runIn = (more: Record<string, string>, cwd: string, command: string, ...args: string[]) => {
	const r = spawnSync(command, args, {
		cwd,
		encoding: 'utf8',
		env: { ...env(), KEN_SRC: src, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', ...more }
	})
	return { status: r.status, stdout: r.stdout, stderr: r.stderr }
}
// A remote at remotes/acme/<name>.git, served as https://example.com/acme/<name>, holding
// `files`.
const remote = (name: string, files: Record<string, string>) => {
	const at = join(dir, `src-${name}`)
	mkdirSync(at)
	for (const [file, body] of Object.entries(files))
		write(join(at, file), body, file.startsWith('.bin/') ? 0o755 : 0o644)
	const git = (...args: string[]) => {
		const r = run(at, 'git', '-c', 'user.name=t', '-c', 'user.email=t@t', ...args)
		if (r.status !== 0) throw new Error(r.stderr)
	}
	git('init', '-q', '-b', 'main')
	git('add', '-A')
	git('commit', '-q', '-m', name)
	git('clone', '-q', '--bare', at, join(dir, `remotes/acme/${name}.git`))
}

// The handbook, a layer with a page, a command and an index entry; the atlas, a layer listing
// the handbook, with a command and an index entry and no link, which ken makes; lib, a plain repo.
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
		'.repos': 'repo: example.com/acme/hb-tool\ndesc: The handbook tool.\n'
	})
	remote('atlas', {
		'.ken': 'layer.handbook=example.com/acme/hb\n',
		'README.md': '# Atlas\n\nThe sales atlas.\n',
		'.bin/ken-atlas': '#!/bin/sh\necho "atlas $KEN_ROOT"\n',
		'.repos': 'repo: example.com/acme/atlas-api\ndesc: The atlas API.\n'
	})
	remote('lib', { 'README.md': 'lib\n' })
})

describe.each(SHELLS)('a layer is a workspace, under %s', (shell) => {
	let top: string
	let atlas: string
	const code = (name: string) => join(dir, `checkouts-${shell}/example.com/acme`, name)
	const ken = (cwd: string, ...args: string[]) => run(cwd, shell, KEN, ...args)
	const ok = (cwd: string, ...args: string[]) => {
		const r = ken(cwd, ...args)
		if (r.status !== 0) throw new Error(`ken ${args.join(' ')} exited ${r.status}: ${r.stderr}`)
		return r.stdout
	}

	// The top: a root with rules, an .envrc, its own command and index entry, the atlas added as
	// its layer; the checkouts in checkouts-<shell>/, KEN_SRC.
	beforeAll(() => {
		top = join(dir, `top-${shell}`)
		src = join(dir, `checkouts-${shell}`)
		write(join(top, 'AGENTS.md'), 'the rules\n')
		write(join(top, '.envrc'), 'export FROM_ROOT=1\n')
		ok(dir, 'init', top)
		write(join(top, '.bin/ken-top'), '#!/bin/sh\necho top\n', 0o755)
		write(join(top, '.repos'), 'repo: example.com/acme/top-only\ndesc: The top only.\n')
		ok(top, 'layer', 'add', 'example.com/acme/atlas')
		atlas = code('atlas')
	}, 30_000)

	it('path code and which answer from KEN_SRC, path root is the layer', () => {
		expect(ok(atlas, 'path', 'root')).toBe(`${atlas}\n`)
		expect(ok(join(top, 'atlas'), 'path', 'root')).toBe(`${atlas}\n`)
		expect(ok(atlas, 'path', 'code', 'example.com/acme/lib')).toBe(`${code('lib')}\n`)
		expect(ok(atlas, 'which')).toBe('example.com/acme/atlas clone main\n')
		expect(ok(atlas, 'which', code('hb'))).toBe('example.com/acme/hb clone main\n')
	})

	it("layer add registers the layer with its front page's first line of prose as desc", () => {
		expect(readFileSync(join(top, '.repos'), 'utf8')).toContain(
			'\nrepo: example.com/acme/atlas\ndesc: The sales atlas.\n'
		)
	})

	it("get clones into KEN_SRC and registers in the layer's index; index set writes the layer's", () => {
		expect(ok(atlas, 'get', 'example.com/acme/lib')).toBe(`${code('lib')}\n`)
		ok(atlas, 'index', 'set', 'example.com/acme/lib', 'desc=The shared lib.')
		expect(readFileSync(join(atlas, '.repos'), 'utf8')).toContain(
			'\nrepo: example.com/acme/lib\ndesc: The shared lib.\n'
		)
		expect(readFileSync(join(top, '.repos'), 'utf8')).not.toContain('acme/lib')
	}, 20_000)

	it("repos shows the layer's keys and its layer's, against KEN_SRC, not the top's", () => {
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

	it("ken <name> finds the layer's .bin/, then its direct layer's, never the top's", () => {
		expect(ok(atlas, 'atlas')).toBe(`atlas ${atlas}\n`)
		expect(ok(atlas, 'hb')).toBe('hb\n')
		expect(ken(atlas, 'top').status).toBe(1)
		write(join(top, '.bin/ken-hb'), '#!/bin/sh\necho top hb\n', 0o755)
		expect(ok(atlas, 'hb')).toBe('hb\n')
		const r = ken(atlas, 'nope')
		expect(r.status).toBe(1)
		expect(r.stderr).toContain(
			`${atlas}/.bin  (the scope)\n  ${code('hb')}/.bin  (layer handbook)\n  `
		)
		expect(r.stderr).not.toContain(`${top}/.bin`)
		expect(ok(top, 'top')).toBe('top\n')
		// the handbook arrives through the atlas, so its commands are read, never run, at the top
		expect(ok(top, 'hb')).toBe('top hb\n')
		rmSync(join(top, '.bin/ken-hb'))
		expect(ken(top, 'hb').status).toBe(1)
	})

	it("a layer's own .bin/ken, named by path, runs itself, scoped to the layer", () => {
		const layerKen = join(atlas, '.bin/ken')
		write(layerKen, '#!/bin/sh\necho "layer kernel $*"\n', 0o755)
		expect(run(atlas, shell, layerKen, 'path', 'root').stdout).toBe('layer kernel path root\n')
		copyFileSync(KEN, layerKen)
		expect(run(dir, shell, layerKen, 'path', 'root').stdout).toBe(`${atlas}\n`)
		rmSync(layerKen)
	})

	it("KEN_SRC carries the root's rules, and a checkout knows its root through KEN_ROOT", () => {
		expect(readFileSync(join(src, 'AGENTS.md'), 'utf8')).toBe('the rules\n')
		expect(readFileSync(join(src, 'CLAUDE.md'), 'utf8')).toBe('the rules\n')
		const lib = code('lib')
		const r = ken(lib, 'path', 'root')
		expect(r.status).toBe(1)
		expect(r.stderr).toContain('cd into a root, or set KEN_ROOT')
		expect(runIn({ KEN_ROOT: top }, lib, shell, KEN, 'path', 'root').stdout).toBe(`${top}\n`)
		// as direnv loads it: KEN_ROOT exported, then the root's .envrc by source_env
		const direnv = `source_env() { . "$1"; }; . ${src}/.envrc && echo "$FROM_ROOT" && ${shell} ${KEN} path root`
		expect(run(lib, 'sh', '-c', direnv).stdout).toBe(`1\n${top}\n`)
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
		expect(readdirSync(code('')).sort()).toEqual(['atlas', 'atlas.feat-x', 'hb', 'lib'])
		const found = search().split('\n').sort()
		expect(found).toEqual(['', './atlas/handbook/guide/x.md', './handbook/guide/x.md'])
		// now a direct layer of the top, the handbook's commands run there
		expect(ok(top, 'hb')).toBe('hb\n')
	}, 20_000)
})
