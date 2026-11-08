import { spawn, spawnSync } from 'node:child_process'
import {
	copyFileSync,
	cpSync,
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
let src: string
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

// A layer's remote, remotes/acme/<name>.git: a root whose .ken lists `layers`, holding `files`
// and no link to a layer, which reconcile makes.
const layerRemote = (
	name: string,
	layers: Record<string, string>,
	files: Record<string, string>
) => {
	const src = join(dir, `src-${name}`)
	repo(src)
	write(
		join(src, '.ken'),
		Object.entries(layers)
			.map(([n, k]) => `layer.${n}=${k}\n`)
			.join('')
	)
	for (const [file, body] of Object.entries(files)) write(join(src, file), body)
	git(src, 'add', '-A')
	git(src, 'commit', '-q', '-m', 'layer')
	git(dir, 'clone', '-q', '--bare', `src-${name}`, `remotes/acme/${name}.git`)
}

// A root with one direct layer and its link, and the checkouts in src/, KEN_SRC: a clone with a
// worktree beside it and a detached one elsewhere, a folder with no .git where a checkout
// belongs, a worktree of a clone outside src/; a nested root that is not a layer, a folder on
// PATH, and a HOME of its own, so nothing outside the temp folder is ever found. HOME's git
// config sends https://example.com/ to bare repos under remotes/, which serve blobless clones
// (acme/lib: v1, an empty commit, then a README; acme/agents: an AGENTS.md), and old-git/ holds
// a git 2.47. A test that clones takes its own KEN_SRC, `<root>.src` beside its root.
beforeAll(() => {
	dir = realpathSync.native(mkdtempSync(join(tmpdir(), 'ken-')))
	root = join(dir, 'root')
	src = join(dir, 'src')
	atlas = join(src, 'github.com/acme/atlas')
	pathBin = join(dir, 'path-bin')
	write(join(root, '.ken'), '# settings\nclone.blobless=true\nlayer.atlas=github.com/acme/atlas\n')
	script(join(root, '.bin/ken-hello'), 'printf "%s|" "$KEN_ROOT" "$@"; exit 3')
	script(join(root, '.bin/ken-back'), 'ken path root && command -v ken')
	script(join(root, '.bin/ken-both'), 'echo scope')
	script(join(root, '.bin/ken-path'), 'echo shadowed')
	script(join(root, '.bin/ken-plain'), 'echo plain', 0o644)
	write(join(atlas, '.ken'), '')
	script(join(atlas, '.bin/ken-both'), 'echo layer')
	script(join(atlas, '.bin/ken-team'), 'echo layer')
	mkdirSync(join(atlas, 'sub'))
	mkdirSync(join(dir, 'home'))
	write(
		join(dir, 'home/.gitconfig'),
		`[url "file://${dir}/remotes/"]\n\tinsteadOf = https://example.com/\n[uploadpack]\n\tallowFilter = true\n`
	)
	repo(join(dir, 'src-lib'))
	git(join(dir, 'src-lib'), 'tag', 'v1')
	write(join(dir, 'src-lib/README.md'), 'lib\n')
	git(join(dir, 'src-lib'), 'add', 'README.md')
	git(join(dir, 'src-lib'), 'commit', '-q', '-m', 'readme')
	git(dir, 'clone', '-q', '--bare', 'src-lib', 'remotes/acme/lib.git')
	repo(join(dir, 'src-agents'))
	write(join(dir, 'src-agents/AGENTS.md'), 'agents\n')
	git(join(dir, 'src-agents'), 'add', 'AGENTS.md')
	git(join(dir, 'src-agents'), 'commit', '-q', '-m', 'agents')
	git(dir, 'clone', '-q', '--bare', 'src-agents', 'remotes/acme/agents.git')
	script(join(dir, 'old-git/git'), 'echo "git version 2.47.1"')
	// three layers, A listing B, B listing C, and C listing A again
	layerRemote(
		'la',
		{ B: 'example.com/acme/lb' },
		{
			'page.md': 'a\n',
			'.agents/skills/sa/SKILL.md': 'skill a\n',
			'.agents/skills/review notes/SKILL.md': 'notes\n',
			'.repos': 'repo: github.com/team-a/notes\ndesc: Team A notes.\n'
		}
	)
	layerRemote('lb', { C: 'example.com/acme/lc' }, { '.agents/skills/sb/SKILL.md': 'skill b\n' })
	layerRemote('lc', { A: 'example.com/acme/la' }, { 'c.md': 'c\n' })
	// an ssh and a wrapper that log their arguments and fail, as an unreachable host would
	for (const name of ['ssh-bin/ssh', 'ssh-bin/wrap', 'ssh bin/ssh'])
		script(join(dir, name), 'echo "$*" >>"$LOG"; exit 255')
	repo(atlas)
	symlinkSync(atlas, join(root, 'atlas'))
	const app = join(src, 'github.com/acme/app')
	repo(app)
	mkdirSync(join(app, 'src/deep'), { recursive: true })
	git(app, 'worktree', 'add', '-q', '-b', 'feat/x', '../app.feat-x')
	mkdirSync(join(app, '../app.feat-x/src/deep'), { recursive: true })
	git(app, 'worktree', 'add', '-q', '--detach', '../../other/elsewhere')
	git(app, 'worktree', 'add', '-q', '-b', 'feat+fix', '../app.feat+fix')
	write(join(app, 'src/a.ts'), '')
	symlinkSync(join(app, 'src/a.ts'), join(root, 'a.ts'))
	symlinkSync(join(src, 'github.com/acme/offline'), join(root, 'offline'))
	symlinkSync('loop', join(root, 'loop'))
	repo(join(dir, 'away'))
	git(join(dir, 'away'), 'worktree', 'add', '-q', '--detach', join(src, 'github.com/acme/stray'))
	mkdirSync(join(src, 'github.com/acme/web/src'), { recursive: true })
	write(join(root, 'notes/inner/.ken'), '')
	script(join(pathBin, 'ken-both'), 'echo path')
	script(join(pathBin, 'ken-team'), 'echo path')
	script(join(pathBin, 'ken-far'), 'echo far')
	mkdirSync(join(dir, 'outside'))
	symlinkSync(root, join(dir, 'link'))
})

describe.each(SHELLS)('ken under %s', (shell) => {
	const env = (more?: Record<string, string>) => ({
		PATH: `${pathBin}:${process.env.PATH}`,
		HOME: join(dir, 'home'),
		GIT_CONFIG_NOSYSTEM: '1',
		KEN_SRC: src,
		...more
	})
	// how a test runs ken in a root of its own: from it, with its own KEN_SRC beside it
	const inRoot = (root: string, more?: Record<string, string>) => ({
		cwd: root,
		env: { KEN_SRC: `${root}.src`, ...more }
	})
	const ken = (
		args: string[],
		opts: { cwd?: string; env?: Record<string, string>; file?: string } = {}
	) => {
		const r = spawnSync(shell, [opts.file ?? KEN, ...args], {
			cwd: opts.cwd ?? root,
			encoding: 'utf8',
			env: env(opts.env)
		})
		return { status: r.status, stdout: r.stdout, stderr: r.stderr }
	}

	const kenAsync = (args: string[], cwd: string) =>
		new Promise<{ status: number | null; stdout: string; stderr: string }>((resolve) => {
			const child = spawn(shell, [KEN, ...args], { cwd, env: env(inRoot(cwd).env) })
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
			expect(Object.keys(made)).toEqual(['.bin', '.bin/ken', '.gitignore', '.ken', '.repos'])
			expect(made['.bin/ken']).toBe(readFileSync(KEN, 'utf8'))
			expect(statSync(join(fresh, '.bin/ken')).mode & 0o111).toBe(0o111)
			expect(made['.gitignore']).toBe('.env\n')
			expect(made['.ken']).toMatch(
				/^# .*\n# .*docs\/files\.md in github\.com\/xiaoxinghu\/ken\.\n$/
			)
			expect(made['.repos']).toMatch(/^# \.repos: [^\n]*\n$/)
			const again = ken(['init', fresh], { cwd: outside() })
			expect(again.status).toBe(0)
			expect(again.stdout).toContain('nothing was created')
			expect(files(fresh)).toEqual(made)
		})

		it('keeps what is there: an existing .gitignore gains only the rule it lacks', () => {
			const kept = join(dir, `kept-${shell}`)
			write(join(kept, '.gitignore'), 'node_modules/')
			write(join(kept, '.ken'), 'org.me=github.com/me\n')
			write(join(kept, '.bin/ken'), 'mine\n')
			expect(ken(['init', kept], { cwd: outside() }).status).toBe(0)
			const after = files(kept)
			expect(after['.gitignore']).toBe('node_modules/\n.env\n')
			expect(after['.ken']).toBe('org.me=github.com/me\n')
			expect(after['.bin/ken']).toBe('mine\n')
			write(join(kept, '.gitignore'), '.env  ')
			expect(ken(['init', kept], { cwd: outside() }).stdout).toContain('nothing was created')
		})

		it('refuses a folder inside a root, naming the nearest root, and makes nothing', () => {
			const cases: [string, string][] = [
				[join(root, `new-${shell}`), root],
				[join(root, `notes/new-${shell}`), root],
				[join(atlas, `sub/new-${shell}`), atlas]
			]
			for (const [inside, above] of cases) {
				const r = ken(['init', inside], { cwd: outside() })
				expect(r.status).toBe(1)
				expect(r.stderr).toContain(`${inside} is inside the root ${above}, so`)
				expect(existsSync(inside)).toBe(false)
			}
			// .. after a missing folder climbs it anyway, as real_path does, so this is inside root
			const around = `${dir}/missing-${shell}/../root/around-${shell}`
			const r = ken(['init', around], { cwd: outside() })
			expect(r.status).toBe(1)
			expect(r.stderr).toContain(`${root}/around-${shell} is inside the root ${root}, so`)
			expect(existsSync(join(root, `around-${shell}`))).toBe(false)
		})

		it('refuses a folder that holds KEN_SRC, which would put the code in the root', () => {
			const holder = join(dir, `holder-${shell}`)
			const r = ken(['init', holder], { cwd: outside(), env: { KEN_SRC: join(holder, 'src') } })
			expect(r.status).toBe(1)
			expect(r.stderr).toContain(`${holder} holds ${holder}/src, the folder of every checkout`)
			expect(existsSync(holder)).toBe(false)
		})

		it('refuses a .ken that is a folder or a dangling link, which marks no root', () => {
			const odd = join(dir, `odd-${shell}`)
			mkdirSync(join(odd, 'folder/.ken'), { recursive: true })
			mkdirSync(join(odd, 'dangling'))
			symlinkSync('nowhere', join(odd, 'dangling/.ken'))
			for (const at of ['folder', 'dangling']) {
				const r = ken(['init', join(odd, at)], { cwd: outside() })
				expect(r.status).toBe(1)
				expect(r.stderr).toContain(`${join(odd, at)}/.ken is there but is not a file`)
				expect(existsSync(join(odd, at, '.bin'))).toBe(false)
			}
		})

		it('makes a root of a clone in KEN_SRC, which is inside no root', () => {
			const clone = join(src, `github.com/acme/new-${shell}`)
			mkdirSync(clone, { recursive: true })
			expect(ken(['init'], { cwd: clone }).status).toBe(0)
			expect(existsSync(join(clone, '.ken'))).toBe(true)
		})

		it("gives KEN_SRC the root's rules where nothing is there; a second root is told and replaces nothing", () => {
			const first = join(dir, `rules-${shell}`)
			const checkouts = `${first}.src`
			write(join(first, 'AGENTS.md'), 'rules\n')
			write(join(first, '.envrc'), 'export X=1\n')
			const r = ken(['init', first], inRoot(first))
			expect(r.status).toBe(0)
			for (const name of ['AGENTS.md', 'CLAUDE.md']) {
				expect(readlinkSync(join(checkouts, name))).toBe(join(first, 'AGENTS.md'))
				expect(r.stdout).toContain(`Linked ${checkouts}/${name} -> ${first}/AGENTS.md\n`)
			}
			expect(readFileSync(join(checkouts, '.envrc'), 'utf8')).toBe(
				`export KEN_ROOT=${first}\nsource_env ${first}/.envrc\n`
			)
			expect(r.stdout).toContain(`Run \`direnv allow ${checkouts}\`.`)
			expect(ken(['init', first], inRoot(first)).stdout).not.toMatch(/Linked|Wrote|Left/)
			// a second root on the machine: told once, nothing replaced
			const second = join(dir, `rules-${shell}-second`)
			write(join(second, 'AGENTS.md'), 'other rules\n')
			write(join(second, '.envrc'), '')
			const other = ken(['init', second], { cwd: second, env: { KEN_SRC: checkouts } })
			expect(other.status).toBe(0)
			expect(other.stdout).toContain(
				`Left AGENTS.md CLAUDE.md .envrc in ${checkouts} as they are: another root made them`
			)
			expect(readlinkSync(join(checkouts, 'CLAUDE.md'))).toBe(join(first, 'AGENTS.md'))
			// a root with no AGENTS.md and no .envrc gives none
			const bare = join(dir, `rules-${shell}-bare`)
			expect(ken(['init', bare], { ...inRoot(bare), cwd: outside() }).status).toBe(0)
			expect(readdirSync(`${bare}.src`)).toEqual([])
		})

		it('says how to point ken at the folder only when it is not the root found from here', () => {
			const other = join(dir, `other-${shell}`)
			const hint = ken(['init', other], { cwd: outside() }).stdout
			expect(hint).toContain(`acts on no root, not ${other}.`)
			expect(hint).toContain(`\n  export KEN_ROOT=${other}\n`)
			expect(ken(['init'], { cwd: other }).stdout).not.toContain('KEN_ROOT=')
		})
	})

	describe('reconcile, run by init', () => {
		const outside = () => join(dir, 'outside')
		const status = (repo: string) =>
			spawnSync('git', ['-C', repo, 'status', '--porcelain'], { encoding: 'utf8', env: env() })
				.stdout
		const exclude = (repo: string) => readFileSync(join(repo, '.git/info/exclude'), 'utf8')

		it('clones layers and theirs into KEN_SRC, links each in its root, excluded, and repoints them after a move', () => {
			const at = join(dir, `layered-${shell}`)
			const clone = (name: string, from = `${at}.src`) => join(from, 'example.com/acme', name)
			repo(at)
			write(join(at, '.ken'), 'layer.A=example.com/acme/la\nlayer.gone=example.com/acme/gone\n')
			const r = ken(['init', at], inRoot(at))
			expect(r.status).toBe(0)
			expect(r.stdout).toContain(`Layer A: cloned example.com/acme/la at ${clone('la')}.`)
			expect(r.stdout).toContain('Layer A/B: cloned example.com/acme/lb')
			expect(r.stdout).toContain('Layer A/B/C: cloned example.com/acme/lc')
			expect(r.stderr).toContain(
				'ken: layer gone, example.com/acme/gone, is offline on this machine'
			)
			expect(r.stderr).toContain('does not appear to be a git repository')
			expect(r.stderr).toContain(`run \`ken init ${at}\` again`)
			// each root's layers are links to the clones, the cycle back to A included
			expect(readlinkSync(join(at, 'A'))).toBe(clone('la'))
			expect(readlinkSync(join(clone('la'), 'B'))).toBe(clone('lb'))
			expect(readFileSync(join(at, 'A/B/C/c.md'), 'utf8')).toBe('c\n')
			expect(readFileSync(join(at, 'A/B/C/A/page.md'), 'utf8')).toBe('a\n')
			// offline: the link is made, and dangles until a clone is
			expect(readlinkSync(join(at, 'gone'))).toBe(clone('gone'))
			expect(existsSync(join(at, 'gone'))).toBe(false)
			// no link is tracked: each is excluded in the repo it is in
			for (const name of ['la', 'lb', 'lc']) expect(status(clone(name))).toBe('')
			expect(exclude(at).split('\n')).toEqual(expect.arrayContaining(['/A', '/gone']))
			expect(status(at)).not.toMatch(/^\?\? (A|gone|\.agents)/m)
			expect(readdirSync(join(`${at}.src`, 'example.com/acme')).sort()).toEqual(['la', 'lb', 'lc'])
			// skills from A only, the direct layer, excluded too
			expect(readFileSync(join(at, '.agents/skills/sa/SKILL.md'), 'utf8')).toBe('skill a\n')
			expect(existsSync(join(at, '.agents/skills/sb'))).toBe(false)
			expect(exclude(at).split('\n')).toEqual(
				expect.arrayContaining(['/.agents/skills/review notes', '/.agents/skills/sa'])
			)
			const again = ken(['init', at], inRoot(at))
			expect(again.stdout).toContain('Layer A/B/C: example.com/acme/lc is cloned already')
			expect(again.stdout).not.toContain('Linked')
			// the clones moved to another KEN_SRC: every link is repointed
			const moved = `${at}.moved`
			renameSync(`${at}.src`, moved)
			const repointed = ken(['init', at], { cwd: at, env: { KEN_SRC: moved } })
			expect(repointed.stdout).toContain(`Repointed ${at}/A -> ${clone('la', moved)}\n`)
			expect(repointed.stdout).toContain(
				`Repointed ${clone('la', moved)}/B -> ${clone('lb', moved)}\n`
			)
			expect(readFileSync(join(at, 'A/B/C/c.md'), 'utf8')).toBe('c\n')
			expect(readFileSync(join(at, '.agents/skills/sa/SKILL.md'), 'utf8')).toBe('skill a\n')
			// copied to yet another KEN_SRC, the old one kept: the skills follow the layer links
			const copied = `${at}.copied`
			cpSync(moved, copied, { recursive: true, verbatimSymlinks: true })
			expect(ken(['init', at], { cwd: at, env: { KEN_SRC: copied } }).status).toBe(0)
			expect(readlinkSync(join(at, 'A'))).toBe(clone('la', copied))
			expect(readlinkSync(join(at, '.agents/skills/sa'))).toBe(
				join(clone('la', copied), '.agents/skills/sa')
			)
			expect(ken(['init', at], { cwd: at, env: { KEN_SRC: moved } }).status).toBe(0)
			expect(readlinkSync(join(at, '.agents/skills/sa'))).toBe(
				join(clone('la', moved), '.agents/skills/sa')
			)
			// a layer's own layer no longer listed, as after a pull: its link goes, in the clone too
			writeFileSync(join(clone('la', moved), '.ken'), '')
			const pulled = ken(['init', at], { cwd: at, env: { KEN_SRC: moved } })
			expect(pulled.stdout).toContain(
				`Removed ${clone('la', moved)}/B, the link to example.com/acme/lb, a layer ${clone('la', moved)}/.ken no longer lists.`
			)
			expect(existsSync(join(clone('la', moved), 'B'))).toBe(false)
			expect(exclude(clone('la', moved))).not.toContain('/B')
			// A no longer listed: its link and skills go, with their exclude lines; a link of
			// the user's into a clone's folder, not a clone, stays; the clones stay
			symlinkSync(join(moved, 'example.com/acme/la/.agents'), join(at, 'mine'))
			write(join(at, '.ken'), 'layer.gone=example.com/acme/gone\n')
			const removed = ken(['init', at], { cwd: at, env: { KEN_SRC: moved } })
			expect(removed.status).toBe(0)
			expect(removed.stdout).toContain(
				`Removed ${at}/.agents/skills/sa, a link into example.com/acme/la`
			)
			expect(removed.stdout).toContain(`Removed ${at}/A, the link to example.com/acme/la`)
			expect(existsSync(join(at, '.agents/skills/sa'))).toBe(false)
			expect(lstatSync(join(at, 'A'), { throwIfNoEntry: false })).toBeUndefined()
			expect(readlinkSync(join(at, 'mine'))).toBe(join(moved, 'example.com/acme/la/.agents'))
			expect(exclude(at)).not.toContain('skills')
			expect(exclude(at).split('\n')).not.toContain('/A')
			expect(readdirSync(join(moved, 'example.com/acme')).sort()).toEqual(['la', 'lb', 'lc'])
		}, 20_000)

		it('takes only a real clone as a layer that is there, and adds an exclude rule as its own line', () => {
			const at = join(dir, `there-${shell}`)
			const la = join(`${at}.src`, 'example.com/acme/la')
			write(join(at, '.ken'), 'layer.A=example.com/acme/la\nlayer.P=example.com/acme/plain\n')
			write(join(`${at}.src`, 'example.com/acme/plain/.ken'), 'layer.X=example.com/acme/lc\n')
			mkdirSync(join(`${at}.src`, 'example.com/acme/plain/.git'))
			git(dir, 'clone', '-q', join(dir, 'remotes/acme/la.git'), la)
			write(join(la, '.git/info/exclude'), 'mine')
			const r = ken(['init', at], inRoot(at))
			expect(r.status).toBe(0)
			expect(r.stderr).toContain('ken: layer P, example.com/acme/plain, is offline')
			expect(r.stderr).toContain('but it is a folder whose .git git does not take as its repo')
			expect(r.stdout).toContain('Layer A: example.com/acme/la is cloned already')
			expect(r.stdout).not.toContain('Layer P')
			expect(existsSync(join(`${at}.src`, 'example.com/acme/plain/X'))).toBe(false)
			expect(exclude(la)).toBe('mine\n/B\n')
			expect(status(la)).toBe('')
		}, 20_000)

		it("leaves what is not a link in a layer link's place, and a skills folder that is a link", () => {
			const at = join(dir, `linked-${shell}`)
			const la = join(`${at}.src`, 'example.com/acme/la')
			const away = join(dir, `linked-away-${shell}`)
			write(join(at, '.ken'), 'layer.A=example.com/acme/la\n')
			write(join(at, 'A/mine.md'), 'mine\n')
			mkdirSync(away)
			mkdirSync(join(at, '.agents'))
			symlinkSync(away, join(at, '.agents/skills'))
			const r = ken(['init', at], inRoot(at))
			expect(r.status).toBe(0)
			expect(r.stdout).toContain(
				`Left ${at}/A alone: it is not a link, so the layer A has no section`
			)
			expect(r.stdout).toContain(
				`Left ${at}/.agents/skills/sa alone: ${at}/.agents/skills is a link`
			)
			expect(readdirSync(away)).toEqual([])
			expect(readFileSync(join(at, 'A/mine.md'), 'utf8')).toBe('mine\n')
			expect(existsSync(join(la, '.git'))).toBe(true)
		}, 20_000)

		it('drops the skills of a direct layer gone offline', () => {
			const at = join(dir, `dropped-${shell}`)
			const la = join(`${at}.src`, 'example.com/acme/la')
			write(join(at, '.ken'), 'layer.A=example.com/acme/la\n')
			expect(ken(['init', at], inRoot(at)).status).toBe(0)
			expect(existsSync(join(at, '.agents/skills/sa'))).toBe(true)
			// a file where the clone belongs: get refuses it, so A is offline
			renameSync(la, `${la}.aside`)
			write(la, 'mine')
			const offline = ken(['init', at], inRoot(at))
			expect(offline.stderr).toContain('ken: layer A, example.com/acme/la, is offline')
			expect(offline.stdout).toContain(
				`Removed ${at}/.agents/skills/sa, a link into example.com/acme/la`
			)
			expect(existsSync(join(at, '.agents/skills/sa'))).toBe(false)
		}, 20_000)

		it('get -b of a layer reconciles its worktree, saying so on stderr, stdout the path alone', () => {
			const at = join(dir, `branched-${shell}`)
			const la = join(`${at}.src`, 'example.com/acme/la')
			write(join(at, '.ken'), 'layer.A=example.com/acme/la\n')
			expect(ken(['init', at], inRoot(at)).status).toBe(0)
			const r = ken(['get', 'example.com/acme/la', '-b', 'feat'], inRoot(at))
			expect(r.status).toBe(0)
			expect(r.stdout).toBe(`${la}.feat\n`)
			expect(r.stderr).toContain('Layer B/C: example.com/acme/lc is cloned already')
			expect(r.stderr).toContain(
				`Linked ${la}.feat/B -> ${join(`${at}.src`, 'example.com/acme/lb')}`
			)
			expect(readFileSync(join(`${la}.feat`, 'B/C/c.md'), 'utf8')).toBe('c\n')
			// the link is excluded in the clone's common info/exclude, so the worktree is clean
			expect(status(`${la}.feat`)).toBe('')
		}, 20_000)

		it("adds ssh's unattended options after the ssh word, or after a wrapper, never to GIT_SSH", () => {
			const at = join(dir, `ssh-${shell}`)
			const log = join(dir, `ssh-${shell}.log`)
			write(join(at, '.ken'), 'layer.s=ssh.test/acme/s\n')
			const bin = join(dir, 'ssh-bin')
			// each line the fake ssh logged, from an init whose layer reaches it
			const ssh = (more: Record<string, string>, config: [string, string][] = []) => {
				rmSync(log, { force: true })
				config.push(['url.ssh://git@ssh.test/.insteadOf', 'https://ssh.test/'])
				const via: Record<string, string> = { LOG: log, GIT_CONFIG_COUNT: `${config.length}` }
				config.forEach(([k, v], i) => {
					via[`GIT_CONFIG_KEY_${i}`] = k
					via[`GIT_CONFIG_VALUE_${i}`] = v
				})
				const r = ken(['init', at], { cwd: outside(), env: { ...via, ...more } })
				expect(r.status).toBe(0)
				expect(r.stderr).toContain('ken: layer s, ssh.test/acme/s, is offline on this machine')
				return readFileSync(log, 'utf8').trim().split('\n')
			}
			const opts =
				'-o BatchMode=yes -o ConnectTimeout=15 -o ServerAliveInterval=15 -o ServerAliveCountMax=4'
			for (const command of [`env X=1 ${bin}/ssh -p 2222`, `"${dir}/ssh bin/ssh" -p 2222`]) {
				for (const line of ssh({ GIT_SSH_COMMAND: command })) {
					expect(line.startsWith(`${opts} -p 2222 `)).toBe(true)
				}
			}
			for (const line of ssh({}, [['core.sshCommand', `${bin}/wrap --via x`]])) {
				expect(line.startsWith(`--via x ${opts}`)).toBe(true)
			}
			for (const line of ssh({ GIT_SSH: `${bin}/wrap` })) expect(line).not.toContain('BatchMode')
		})
	})

	describe('layer', () => {
		const fresh = (name: string) => {
			const at = join(dir, `${name}-${shell}`)
			write(join(at, '.ken'), '# mine\norg.me=github.com/me')
			mkdirSync(join(at, 'systems'))
			expect(ken(['init', at], inRoot(at)).status).toBe(0)
			return { at, code: (key: string) => join(`${at}.src`, key) }
		}

		it('add appends its line and reconciles, the link excluded; remove undoes all but the clones', () => {
			const { at, code } = fresh('layer-add')
			git(at, 'init', '-q')
			const ken0 = '# mine\norg.me=github.com/me\n'
			const r = ken(['layer', 'add', 'example.com/acme/la'], inRoot(at))
			expect(r.status).toBe(0)
			expect(readlinkSync(join(at, 'la'))).toBe(code('example.com/acme/la'))
			expect(readFileSync(join(at, 'la/B/C/c.md'), 'utf8')).toBe('c\n')
			expect(readFileSync(join(at, '.ken'), 'utf8')).toBe(`${ken0}layer.la=example.com/acme/la\n`)
			expect(readFileSync(join(at, '.agents/skills/sa/SKILL.md'), 'utf8')).toBe('skill a\n')
			expect(r.stdout).toContain(`git -C ${at} add -- .ken .repos\`; the link is excluded`)
			expect(r.stdout).toContain('under ## Layers')
			const repos = ken(['repos', '--porcelain'], inRoot(at)).stdout
			expect(repos).toContain('github.com/team-a/notes\tTeam A notes.\tla\tfalse\t\n')
			// by URL, under another name
			const url = ken(
				['layer', 'add', 'https://example.com/acme/lc.git', '--as', 'handbook'],
				inRoot(at)
			)
			expect(url.status).toBe(0)
			expect(readlinkSync(join(at, 'handbook'))).toBe(code('example.com/acme/lc'))
			expect(readFileSync(join(at, 'handbook/c.md'), 'utf8')).toBe('c\n')
			expect(readFileSync(join(at, '.ken'), 'utf8')).toContain(
				'\nlayer.handbook=example.com/acme/lc\n'
			)
			// remove both: the lines, links and skill links go, with their exclude lines; the clones stay
			for (const name of ['handbook', 'la']) {
				const gone = ken(['layer', 'remove', name], inRoot(at))
				expect(gone.status).toBe(0)
				expect(gone.stdout).toContain(`git -C ${at} add -- .ken\``)
			}
			expect(readFileSync(join(at, '.ken'), 'utf8')).toBe(ken0)
			for (const name of ['la', 'handbook', '.agents/skills/sa'])
				expect(existsSync(join(at, name))).toBe(false)
			expect(readFileSync(join(at, '.git/info/exclude'), 'utf8')).not.toMatch(/la|handbook|sa/)
			expect(readdirSync(code('example.com/acme')).sort()).toEqual(['la', 'lb', 'lc'])
			const last = ken(['layer', 'remove', 'la'], inRoot(at))
			expect(last.status).toBe(0)
			expect(last.stdout).toContain(`la is not a layer of ${at}, so there is nothing to remove.`)
		}, 30_000)

		it('refuses a bad, reserved or taken name and a layer already added, before any write', () => {
			const { at, code } = fresh('layer-refused')
			expect(ken(['layer', 'add', 'example.com/acme/la'], inRoot(at)).status).toBe(0)
			symlinkSync('nowhere', join(at, 'dangling'))
			const before = readFileSync(join(at, '.ken'), 'utf8')
			const index = readFileSync(join(at, '.repos'), 'utf8')
			const cases: [string[], string][] = [
				[['example.com/acme/la', '--as', 'other'], 'is a layer of'],
				[['example.com/acme/lib', '--as', 'README.md'], 'is a reserved name'],
				[['example.com/acme/lib', '--as', 'claude.MD'], 'is a reserved name'],
				[['example.com/acme/lib', '--as', '.repos'], 'is a reserved name'],
				[['example.com/acme/lib', '--as', 'systems'], `${at}/systems is there already`],
				[['example.com/acme/lib', '--as', 'dangling'], `${at}/dangling is there already`],
				[['example.com/acme/lib', '--as', 'la'], 'is the layer of example.com/acme/la in'],
				[['example.com/acme/lib', '--as', 'a/b'], 'is not a layer name']
			]
			for (const [args, says] of cases) {
				const r = ken(['layer', 'add', ...args], inRoot(at))
				expect(r.status).toBe(1)
				expect(r.stderr).toContain(says)
				expect(r.stderr).toMatch(/`ken (init|layer add) /)
			}
			expect(readFileSync(join(at, '.ken'), 'utf8')).toBe(before)
			expect(readFileSync(join(at, '.repos'), 'utf8')).toBe(index)
			expect(existsSync(code('example.com/acme/lib'))).toBe(false)
		}, 20_000)

		it('completes an add that stopped after the link, and adds inside a layer to the layer', () => {
			const { at, code } = fresh('layer-halfway')
			const la = code('example.com/acme/la')
			symlinkSync(la, join(at, 'la'))
			expect(ken(['layer', 'add', 'example.com/acme/la'], inRoot(at)).status).toBe(0)
			expect(readFileSync(join(at, '.ken'), 'utf8')).toContain('\nlayer.la=example.com/acme/la\n')
			expect(readFileSync(join(at, 'la/page.md'), 'utf8')).toBe('a\n')
			// inside the layer: its .ken and link, the clone in KEN_SRC
			const r = ken(['layer', 'add', 'example.com/acme/lib'], {
				cwd: join(at, 'la'),
				env: { KEN_SRC: `${at}.src` }
			})
			expect(r.status).toBe(0)
			expect(readFileSync(join(la, '.ken'), 'utf8')).toBe(
				'layer.B=example.com/acme/lb\nlayer.lib=example.com/acme/lib\n'
			)
			expect(readlinkSync(join(la, 'lib'))).toBe(code('example.com/acme/lib'))
			expect(readFileSync(join(at, 'la/lib/README.md'), 'utf8')).toBe('lib\n')
			expect(readFileSync(join(at, '.ken'), 'utf8')).not.toContain('lib')
			const gone = ken(['layer', 'remove', 'lib'], { cwd: la, env: { KEN_SRC: `${at}.src` } })
			expect(gone.status).toBe(0)
			expect(existsSync(join(la, 'lib'))).toBe(false)
			expect(readFileSync(join(la, '.ken'), 'utf8')).toBe('layer.B=example.com/acme/lb\n')
		}, 20_000)
	})

	describe('path', () => {
		it('code lowercases the key and puts the branch worktree beside the clone, / as -', () => {
			expect(ken(['path', 'code', 'github.com/Acme/Join-Web', 'feat/login'])).toEqual({
				status: 0,
				stdout: `${src}/github.com/acme/join-web.feat-login\n`,
				stderr: ''
			})
			for (const url of [
				'ssh://git@github.com:22/Acme/Join-Web.git',
				'git@github.com:Acme/Join-Web.git',
				'github.com:acme/join-web.git'
			]) {
				expect(ken(['path', 'code', url]).stdout).toBe(`${src}/github.com/acme/join-web\n`)
			}
		})

		it('code answers from KEN_SRC, ~/src when unset, inside any root or none', () => {
			const home = join(dir, 'home/src/github.com/acme/x\n')
			for (const cwd of [root, atlas, join(dir, 'outside')]) {
				expect(ken(['path', 'code', 'github.com/acme/x'], { cwd }).stdout).toBe(
					`${src}/github.com/acme/x\n`
				)
				expect(
					ken(['path', 'code', 'github.com/acme/x'], { cwd, env: { KEN_SRC: '' } }).stdout
				).toBe(home)
			}
		})

		it('refuses a KEN_SRC inside a root, the layout of checkouts in the root', () => {
			const r = ken(['path', 'code', 'github.com/acme/x'], { env: { KEN_SRC: join(root, 'code') } })
			expect(r.status).toBe(1)
			expect(r.stderr).toContain(
				`the checkouts folder ${root}/code (KEN_SRC, default ~/src) is inside the ken root ${root}`
			)
			expect(r.stderr).toContain('`export KEN_SRC=~/src`')
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
				stdout: `${src}/github.com/acme/web/src/a.ts\n`,
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
		const s = (path: string) => join(src, path)

		it('a clone and a worktree beside it, at their roots and deep inside, from git', () => {
			const at = s('github.com/acme')
			expect(ken(['which'], { cwd: join(at, 'app') })).toEqual(ok('github.com/acme/app clone main'))
			expect(r(s('github.com/acme/app/src/deep'))).toEqual(ok('github.com/acme/app clone main'))
			expect(r('src/deep', join(at, 'app.feat-x'))).toEqual(
				ok('github.com/acme/app worktree feat/x')
			)
			expect(ken(['which'], { cwd: join(at, 'app.feat-x/src/deep') })).toEqual(
				ok('github.com/acme/app worktree feat/x')
			)
		})

		it('needs no root: a checkout is a checkout from anywhere', () => {
			expect(r(s('github.com/acme/app'), join(dir, 'outside'))).toEqual(
				ok('github.com/acme/app clone main')
			)
		})

		it('a worktree is keyed by its clone wherever its folder is, detached with no branch', () => {
			expect(r(s('github.com/other/elsewhere'))).toEqual(ok('github.com/acme/app worktree'))
		})

		it('a worktree whose branch has a character no key may hold is keyed by its clone', () => {
			expect(r(s('github.com/acme/app.feat+fix'))).toEqual(
				ok('github.com/acme/app worktree feat+fix')
			)
		})

		it('a symlink to a file is followed to the checkout the file is in', () => {
			expect(r('a.ts')).toEqual(ok('github.com/acme/app clone main'))
		})

		it("an offline layer's dangling link is followed and answered from its shape", () => {
			expect(r('offline/x.md')).toEqual(ok('github.com/acme/offline clone'))
		})

		it('a symlink cycle ends, as a path outside KEN_SRC', () => {
			expect(r('loop').stderr).toContain(
				`${root}/loop is outside ${src}, the folder of every checkout`
			)
		})

		it('a layer is a checkout, through its link and from inside it', () => {
			expect(r('atlas/sub')).toEqual(ok('github.com/acme/atlas clone main'))
			expect(r('missing/../atlas/sub')).toEqual(ok('github.com/acme/atlas clone main'))
			expect(ken(['which'], { cwd: join(root, 'atlas/sub') })).toEqual(
				ok('github.com/acme/atlas clone main')
			)
		})

		it('a path not checked out yet is answered from its shape, with no branch', () => {
			expect(r(s('github.com/Acme/api/src/x.ts'))).toEqual(ok('github.com/acme/api clone'))
			expect(r(s('github.com/acme/app.other/src'))).toEqual(ok('github.com/acme/app worktree'))
			// a worktree's .git is a file, so app.feat-x is not a clone to be a worktree of
			expect(r(s('github.com/acme/app.feat-x.y'))).toEqual(ok('github.com/acme/app worktree'))
			expect(r(s('github.com/acme/new/../api/x'))).toEqual(ok('github.com/acme/api clone'))
		})

		it('a folder where a checkout belongs with no .git is refused, with the ken get to run', () => {
			const res = r(s('github.com/acme/web/src'))
			expect(res.status).toBe(1)
			expect(res.stderr).toContain(`${src}/github.com/acme/web is where a checkout belongs`)
			expect(res.stderr).toContain('`ken get github.com/acme/web`')
		})

		it('a path in KEN_SRC outside a checkout, or outside KEN_SRC, is refused', () => {
			const res = r(s('github.com/acme'))
			expect(res.status).toBe(1)
			expect(res.stderr).toContain(
				`${src}/github.com/acme is in ${src}, the folder of every checkout, but in no checkout`
			)
			for (const path of ['notes', '../outside']) {
				const out = r(path)
				expect(out.status).toBe(1)
				expect(out.stderr).toMatch(
					/ is outside .*src, the folder of every checkout on this machine/
				)
			}
		})

		it('a worktree of a clone outside KEN_SRC is refused, with the git worktree move', () => {
			const res = r(s('github.com/acme/stray'))
			expect(res.status).toBe(1)
			expect(res.stderr).toContain(
				`\`git -C ${dir}/away worktree move ${src}/github.com/acme/stray ${dir}/stray\``
			)
		})
	})

	describe('the root', () => {
		it('a layer is the scope from inside it, its checkouts in KEN_SRC all the same', () => {
			const cwd = join(atlas, 'sub')
			expect(ken(['path', 'root'], { cwd }).stdout).toBe(`${atlas}\n`)
			expect(ken(['path', 'code', 'github.com/acme/x'], { cwd }).stdout).toBe(
				`${src}/github.com/acme/x\n`
			)
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

		it('outside any root, with KEN_ROOT unset, stops, naming cd and KEN_ROOT', () => {
			const r = ken(['path', 'root'], { cwd: join(src, 'github.com/acme/app') })
			expect(r.status).toBe(1)
			expect(r.stdout).toBe('')
			expect(r.stderr).toContain(`ken: ${src}/github.com/acme/app is in no ken root`)
			expect(r.stderr).toContain('cd into a root, or set KEN_ROOT')
			const set = ken(['path', 'root'], {
				cwd: join(src, 'github.com/acme/app'),
				env: { KEN_ROOT: root }
			})
			expect(set.stdout).toBe(`${root}\n`)
		})

		it('a KEN_ROOT that does not exist is refused, naming the path and where it came from', () => {
			const r = ken(['path', 'root'], { env: { KEN_ROOT: join(dir, 'nope') } })
			expect(r.status).toBe(1)
			expect(r.stderr).toContain(`the ken root ${join(dir, 'nope')} (from KEN_ROOT) does not exist`)
			expect(r.stderr).toContain(`ken init ${join(dir, 'nope')}`)
		})
	})

	describe('ken <name>', () => {
		it("runs the scope's ken-<name> with KEN_ROOT the real scope, returning its exit code", () => {
			const r = ken(['hello', 'a b', '--help'], { env: { KEN_ROOT: join(dir, 'link') } })
			expect(r).toEqual({ status: 3, stdout: `${root}|a b|--help|`, stderr: '' })
		})

		it("puts this ken's folder first on PATH, so the script runs `ken` back with no ken installed", () => {
			const r = ken(['back'], { env: { PATH: '/usr/bin:/bin' } })
			expect(r).toEqual({ status: 0, stdout: `${root}\n${KEN}\n`, stderr: '' })
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
			script(join(`${twice}.src`, 'github.com/acme/old/.bin/ken-which-layer'), 'echo old')
			script(join(`${twice}.src`, 'github.com/acme/new/.bin/ken-which-layer'), 'echo new')
			expect(ken(['which-layer'], inRoot(twice)).stdout).toBe('new\n')
			expect(ken(['nope'], inRoot(twice)).stderr).not.toContain('acme/old')
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
		// A fresh root whose index, .repos, holds `body`, or none when undefined.
		const fresh = (body?: string) => {
			const at = join(dir, `index-${shell}-${n++}`)
			write(join(at, '.ken'), '')
			if (body !== undefined) write(join(at, '.repos'), body)
			const index = join(at, '.repos')
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

		it('writers take turns, so parallel sets of different repos lose none', async () => {
			const r = fresh('')
			const keys = [1, 2, 3, 4, 5, 6].map((i) => `github.com/acme/r${i}`)
			const all = await Promise.all(
				keys.map((k) => kenAsync(['index', 'set', k, 'desc=R.'], r.cwd))
			)
			expect(all.map((a) => a.status)).toEqual(keys.map(() => 0))
			for (const k of keys) expect(r.read()).toContain(`repo: ${k}\ndesc: R.\n`)
			expect(readdirSync(r.cwd).sort()).toEqual(['.ken', '.repos'])
		}, 20_000)

		it('a lock whose holder is gone is refused with the rm to run, never removed by ken', () => {
			const r = fresh('')
			const lock = `${r.index}.lock`
			symlinkSync(String(spawnSync('true').pid), lock)
			const out = ken(['index', 'set', KEY, 'desc=Web.'], r)
			expect(out.status).toBe(1)
			expect(out.stderr).toContain(`run \`rm ${lock}\` and rerun.`)
			expect(r.read()).toBe('')
			rmSync(lock)
			expect(ken(['index', 'set', KEY, 'desc=Web.'], r).status).toBe(0)
		})

		it('anything but a symlink at the lock path is refused with the mv aside, not spun on', () => {
			const r = fresh('')
			const lock = `${r.index}.lock`
			write(lock, 'mine')
			const out = ken(['index', 'set', KEY, 'desc=Web.'], r)
			expect(out.status).toBe(1)
			expect(out.stderr).toContain(`Move it aside, e.g. \`mv ${lock} ${lock}.old\``)
			expect([r.read(), readFileSync(lock, 'utf8')]).toEqual(['', 'mine'])
			// ln -s would make its link inside a folder and write with no lock held
			rmSync(lock)
			mkdirSync(lock)
			expect(ken(['index', 'set', KEY, 'desc=Web.'], r).status).toBe(1)
			expect([r.read(), readdirSync(lock)]).toEqual(['', []])
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
			ken(['index', 'set', KEY, 'kind=fe'], r)
			expect(r.read()).toBe(`repo: ${KEY}\nkind: fe\n`)
		})

		it('unset is no subcommand: refused, pointing at the file to edit, and the file is untouched', () => {
			const body = `repo: ${KEY}\ndesc: Web.\nkind: fe\n`
			const r = fresh(body)
			const out = ken(['index', 'unset', KEY, 'kind'], r)
			expect(out.status).toBe(1)
			expect(out.stderr).toContain('ken index takes set, then a repo key, got unset.')
			expect(out.stderr).toContain('To remove a field or an entry, edit .repos.')
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
				expect(readdirSync(r.cwd).sort()).toEqual(['.ken', '.repos'])
			}
		})
	})

	describe('get', () => {
		const KEY = 'example.com/acme/lib'
		let n = 0
		// A fresh root whose .ken holds `settings`.
		const fresh = (settings = '') => {
			const at = join(dir, `get-${shell}-${n++}`)
			write(join(at, '.ken'), settings)
			return at
		}
		const cloneOf = (at: string, key = KEY) => join(`${at}.src`, key)
		const config = (repo: string, name: string) =>
			spawnSync('git', ['-C', repo, 'config', '--get', name], { encoding: 'utf8', env: env() })
				.stdout
		const registered = (index: string) => `ken: registered ${KEY} in ${index} with no desc`
		// What is at `p`, to tell that a refusal left it untouched.
		const shape = (p: string) => {
			const s = lstatSync(p)
			if (s.isSymbolicLink()) return `link ${readlinkSync(p)}`
			if (s.isFile()) return `file ${readFileSync(p, 'utf8')}`
			return `folder ${readdirSync(p).sort().join(' ')}`
		}

		it('clones blobless into KEN_SRC, registers the key and says to describe it; again is silent', () => {
			const at = fresh()
			const clone = cloneOf(at)
			const first = ken(['get', KEY], {
				cwd: join(dir, 'outside'),
				env: { KEN_ROOT: at, KEN_SRC: `${at}.src` }
			})
			expect(first.status).toBe(0)
			expect(first.stdout).toBe(`${clone}\n`)
			expect(first.stderr).toContain(registered(`${at}/.repos`))
			expect(first.stderr).toContain(`Run \`ken index set ${KEY} desc="..."\``)
			expect(readFileSync(join(at, '.repos'), 'utf8')).toBe(`repo: ${KEY}\n`)
			expect(readFileSync(join(clone, 'README.md'), 'utf8')).toBe('lib\n')
			expect(config(clone, 'worktree.useRelativePaths')).toBe('true\n')
			expect(config(clone, 'remote.origin.partialclonefilter')).toBe('blob:none\n')
			expect(readdirSync(cloneOf(at, 'example.com/acme'))).toEqual(['lib'])
			expect(ken(['get', `https://${KEY}.git`], inRoot(at))).toEqual({
				status: 0,
				stdout: first.stdout,
				stderr: ''
			})
		})

		it('clones whole when the scope says clone.blobless=false', () => {
			const at = fresh('clone.blobless=false\n')
			expect(ken(['get', KEY], inRoot(at)).status).toBe(0)
			expect(config(cloneOf(at), 'remote.origin.partialclonefilter')).toBe('')
		})

		it('refuses a clone.blobless it cannot read before making anything, so the rerun clones', () => {
			const at = fresh('clone.blobless=flase\n')
			const r = ken(['get', KEY], inRoot(at))
			expect(r.status).toBe(1)
			expect(r.stderr).toContain(`${at}/.ken sets clone.blobless to neither true nor false`)
			expect(existsSync(`${at}.src`)).toBe(false)
			write(join(at, '.ken'), 'clone.blobless=false\n')
			expect(ken(['get', KEY], inRoot(at)).stdout).toBe(`${cloneOf(at)}\n`)
		})

		it('uses a repo made with git init where the clone belongs, as it is', () => {
			const at = fresh()
			repo(cloneOf(at))
			const r = ken(['get', KEY], inRoot(at))
			expect(r.stdout).toBe(`${cloneOf(at)}\n`)
			expect(r.stderr).toContain(registered(`${at}/.repos`))
			expect(config(cloneOf(at), 'worktree.useRelativePaths')).toBe('true\n')
			expect(config(cloneOf(at), 'remote.origin.url')).toBe('')
		})

		it("from inside a layer clones into KEN_SRC and registers in the layer's index", () => {
			const at = fresh('layer.team=example.com/acme/team\n')
			const team = cloneOf(at, 'example.com/acme/team')
			write(join(team, '.ken'), '')
			const r = ken(['get', KEY], { cwd: team, env: { KEN_SRC: `${at}.src` } })
			expect(r.stdout).toBe(`${cloneOf(at)}\n`)
			expect(r.stderr).toContain(registered(`${team}/.repos`))
			expect(readFileSync(join(team, '.repos'), 'utf8')).toBe(`repo: ${KEY}\n`)
			expect(existsSync(join(at, '.repos'))).toBe(false)
		})

		it("registers nothing when the scope's index or a reachable layer's lists the key", () => {
			const listed = fresh()
			const index = `# The index.\n\nrepo: ${KEY}\ndesc: Lib.\n`
			write(join(listed, '.repos'), index)
			expect(ken(['get', KEY], inRoot(listed)).stderr).toBe('')
			expect(readFileSync(join(listed, '.repos'), 'utf8')).toBe(index)
			// an offline layer is skipped, and a layer's own layer reached, through a cycle back
			const at = fresh('layer.gone=example.com/acme/gone\nlayer.team=example.com/acme/team\n')
			write(join(cloneOf(at, 'example.com/acme/team'), '.ken'), 'layer.hb=example.com/acme/hb\n')
			write(join(cloneOf(at, 'example.com/acme/hb'), '.ken'), 'layer.team=example.com/acme/team\n')
			write(join(cloneOf(at, 'example.com/acme/hb'), '.repos'), `repo: ${KEY}\n`)
			expect(ken(['get', KEY], inRoot(at))).toEqual({
				status: 0,
				stdout: `${cloneOf(at)}\n`,
				stderr: ''
			})
			expect(existsSync(join(at, '.repos'))).toBe(false)
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
				const r = ken(['get', KEY], inRoot(at))
				expect(r.status).toBe(1)
				expect(r.stdout).toBe('')
				expect(r.stderr).toContain(
					`${clone} is where the clone of ${KEY} belongs, but it is ${what}`
				)
				expect(r.stderr).toContain(`\`mv ${clone} ~/lib.aside\``)
				expect(shape(clone)).toBe(before)
				expect(existsSync(join(at, '.repos'))).toBe(false)
			}
			const plain = fresh()
			mkdirSync(cloneOf(plain), { recursive: true })
			expect(ken(['get', KEY], inRoot(plain)).stderr).toContain(
				`run \`git init ${cloneOf(plain)}\` then \`ken get ${KEY}\``
			)
		})

		it('refuses the host or the owner folder as a symlink, which leads out of KEN_SRC', () => {
			const away = join(dir, `away-${shell}-${n}`)
			mkdirSync(away)
			for (const folder of ['example.com', 'example.com/acme']) {
				const at = fresh()
				const link = cloneOf(at, folder)
				mkdirSync(join(link, '..'), { recursive: true })
				symlinkSync(away, link)
				const r = ken(['get', KEY], inRoot(at))
				expect(r.status).toBe(1)
				expect(r.stderr).toContain(
					`${link} is a symlink to ${away}, so a clone under it would be outside`
				)
				expect(r.stderr).toContain(`\`rm ${link} && mv ${away} ${link}\``)
				expect(readdirSync(away)).toEqual([])
			}
		})

		it('refuses a KEN_SRC inside a root before making anything', () => {
			const at = fresh()
			const r = ken(['get', KEY], { cwd: at, env: { KEN_SRC: join(at, 'src') } })
			expect(r.status).toBe(1)
			expect(r.stderr).toContain(`${at}/src (KEN_SRC, default ~/src) is inside the ken root ${at}`)
			expect(readdirSync(at)).toEqual(['.ken'])
		})

		it("makes KEN_SRC with the root's rules, and gives a fresh clone with AGENTS.md its CLAUDE.md", () => {
			const at = fresh()
			write(join(at, 'AGENTS.md'), 'rules\n')
			const agents = cloneOf(at, 'example.com/acme/agents')
			const r = ken(['get', 'example.com/acme/agents'], inRoot(at))
			expect(r.status).toBe(0)
			expect(readlinkSync(cloneOf(at, 'CLAUDE.md'))).toBe(join(at, 'AGENTS.md'))
			expect(r.stderr).toContain(`Linked ${cloneOf(at, 'AGENTS.md')} -> ${at}/AGENTS.md`)
			expect(readlinkSync(join(agents, 'CLAUDE.md'))).toBe('AGENTS.md')
			expect(r.stderr).toContain(`ken: linked ${agents}/CLAUDE.md -> AGENTS.md, excluded from git`)
			const status = (cwd: string) =>
				spawnSync('git', ['-C', cwd, 'status', '--porcelain'], { encoding: 'utf8', env: env() })
					.stdout
			expect(status(agents)).toBe('')
			// a worktree is fresh too; a clone already there is left as it is
			const wt = ken(['get', 'example.com/acme/agents', '-b', 'feat'], inRoot(at))
			expect(readlinkSync(join(`${agents}.feat`, 'CLAUDE.md'))).toBe('AGENTS.md')
			expect(status(`${agents}.feat`)).toBe('')
			rmSync(join(agents, 'CLAUDE.md'))
			expect(ken(['get', 'example.com/acme/agents'], inRoot(at)).stderr).toBe('')
			expect(wt.status).toBe(0)
		})

		it('a failed clone leaves no folder, says what git said and what to rerun', () => {
			const at = fresh()
			const r = ken(['get', 'example.com/acme/missing'], inRoot(at))
			expect(r.status).toBe(1)
			expect(r.stdout).toBe('')
			expect(r.stderr).toContain('does not appear to be a git repository')
			expect(r.stderr).toContain('A key alone clones https://example.com/acme/missing.git')
			expect(r.stderr).toContain('run `ken get example.com/acme/missing` again')
			expect(r.stderr).toContain('not pushed yet, or private to an account this machine lacks')
			expect(readdirSync(cloneOf(at, 'example.com/acme'))).toEqual([])
			expect(existsSync(join(at, '.repos'))).toBe(false)
		})

		it('two gets at once: one clones, the other waits for it, and both print the path', async () => {
			const at = fresh()
			const both = await Promise.all([kenAsync(['get', KEY], at), kenAsync(['get', KEY], at)])
			for (const r of both) expect([r.status, r.stdout]).toEqual([0, `${cloneOf(at)}\n`])
			expect(both.filter((r) => r.stderr.includes('ken: registered')).length).toBe(1)
			expect(readdirSync(cloneOf(at, 'example.com/acme'))).toEqual(['lib'])
			expect(readFileSync(join(at, '.repos'), 'utf8')).toBe(`repo: ${KEY}\n`)
		})

		it('two gets at once of a repo made with git init both set it up and print the path', async () => {
			const at = fresh()
			repo(cloneOf(at))
			const both = await Promise.all([kenAsync(['get', KEY], at), kenAsync(['get', KEY], at)])
			for (const r of both) expect([r.status, r.stdout]).toEqual([0, `${cloneOf(at)}\n`])
			expect(config(cloneOf(at), 'worktree.useRelativePaths')).toBe('true\n')
		})

		it('refuses a git older than 2.48 before touching anything', () => {
			const at = fresh()
			const r = ken(
				['get', KEY],
				inRoot(at, { PATH: `${join(dir, 'old-git')}:${process.env.PATH}` })
			)
			expect(r.status).toBe(1)
			expect(r.stderr).toContain('git version 2.47.1 is too old: ken needs git 2.48 or newer')
			expect(existsSync(`${at}.src`)).toBe(false)
		})
	})

	describe('get -b', () => {
		const KEY = 'example.com/acme/lib'
		let n = 0
		// A fresh root with lib cloned into it.
		const cloned = () => {
			const at = join(dir, `get-b-${shell}-${n++}`)
			write(join(at, '.ken'), '')
			expect(ken(['get', KEY], inRoot(at)).status).toBe(0)
			const clone = join(`${at}.src`, KEY)
			return { at, clone, wt: (folder: string) => `${clone}.${folder}` }
		}
		const out = (cwd: string, ...args: string[]) =>
			spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8', env: env() }).stdout
		const head = (cwd: string) => out(cwd, 'rev-parse', '--abbrev-ref', 'HEAD').trim()

		it('a new branch gets its worktree beside the clone, linked relatively; again prints it', () => {
			const { at, clone, wt } = cloned()
			const r = ken(['get', KEY, '-b', 'feat/x'], inRoot(at))
			expect(r).toEqual({ status: 0, stdout: `${wt('feat-x')}\n`, stderr: '' })
			expect(readFileSync(join(wt('feat-x'), '.git'), 'utf8')).toMatch(
				/^gitdir: \.\.\/lib\/\.git\/worktrees\/[^/]+\n$/
			)
			expect(head(wt('feat-x'))).toBe('feat/x')
			expect(out(wt('feat-x'), 'rev-parse', 'HEAD')).toBe(out(clone, 'rev-parse', 'HEAD'))
			expect(ken(['get', KEY, '-b', 'feat/x'], inRoot(at))).toEqual(r)
		})

		it('a root whose path holds a tab and a newline: again prints the same worktree', () => {
			const at = join(dir, `get-b-${shell}-odd\t\nroot`)
			write(join(at, '.ken'), '')
			expect(ken(['get', KEY], inRoot(at)).status).toBe(0)
			const first = ken(['get', KEY, '-b', 'feat'], inRoot(at))
			expect(first.stdout).toBe(`${join(`${at}.src`, KEY)}.feat\n`)
			expect(ken(['get', KEY, '-b', 'feat'], inRoot(at))).toEqual(first)
		})

		it('the default branch prints the clone; an existing branch gets its worktree', () => {
			const { at, clone, wt } = cloned()
			expect(ken(['get', KEY, '-b', 'main'], inRoot(at)).stdout).toBe(`${clone}\n`)
			git(clone, 'branch', 'old', 'v1')
			expect(ken(['get', KEY, '-b', 'old'], inRoot(at)).stdout).toBe(`${wt('old')}\n`)
			expect(head(wt('old'))).toBe('old')
			// a tag named main makes git shorten the default branch to heads/main, a branch of its own
			git(clone, 'tag', 'main')
			expect(ken(['get', KEY, '-b', 'heads/main'], inRoot(at)).stdout).toBe(`${wt('heads-main')}\n`)
			expect(ken(['get', KEY, '-b', 'main'], inRoot(at)).stdout).toBe(`${clone}\n`)
		})

		it('--from starts a new branch there, and is refused for one that exists', () => {
			const { at, wt } = cloned()
			expect(ken(['get', KEY, '-b', 'fix', '--from', 'v1'], inRoot(at)).stdout).toBe(
				`${wt('fix')}\n`
			)
			expect(existsSync(join(wt('fix'), 'README.md'))).toBe(false)
			for (const branch of ['fix', 'main']) {
				const r = ken(['get', KEY, '-b', branch, '--from', 'v1'], inRoot(at))
				expect(r.status).toBe(1)
				expect(r.stderr).toContain(`Run \`ken get ${KEY} -b ${branch}\` for its worktree`)
			}
		})

		it("a branch named for a folder of another's is refused, never given that one's worktree", () => {
			const { at, clone, wt } = cloned()
			ken(['get', KEY, '-b', 'feat/x'], inRoot(at))
			const r = ken(['get', KEY, '-b', 'feat'], inRoot(at))
			expect([r.status, r.stdout]).toEqual([1, ''])
			expect(r.stderr).toContain('could not make the branch feat')
			expect(readdirSync(join(clone, '..'))).toEqual(['lib', 'lib.feat-x'])
			expect(head(wt('feat-x'))).toBe('feat/x')
		})

		it('a bad branch name is refused before the clone is touched', () => {
			const at = join(dir, `get-b-${shell}-${n++}`)
			write(join(at, '.ken'), '')
			const r = ken(['get', KEY, '-b', 'a..b'], inRoot(at))
			expect(r.status).toBe(1)
			expect(r.stderr).toContain('is not a branch name git accepts')
			expect(existsSync(`${at}.src`)).toBe(false)
		})

		it('a folder differing only by case is refused, naming the branch its worktree holds', () => {
			const { at, clone, wt } = cloned()
			ken(['get', KEY, '-b', 'feat'], inRoot(at))
			const r = ken(['get', KEY, '-b', 'Feat'], inRoot(at))
			expect(r.status).toBe(1)
			expect(r.stderr).toContain(`but ${wt('feat')} differs only by case from it`)
			expect(r.stderr).toContain(`a worktree of ${clone} holding the branch feat`)
			expect(out(clone, 'branch', '--list', 'Feat')).toBe('')
			expect(readdirSync(join(clone, '..'))).toEqual(['lib', 'lib.feat'])
		})

		it('an unborn default branch without --from, or a detached clone, is refused', () => {
			const at = join(dir, `get-b-${shell}-${n++}`)
			write(join(at, '.ken'), '')
			const clone = join(`${at}.src`, KEY)
			mkdirSync(clone, { recursive: true })
			git(clone, 'init', '-q', '-b', 'main')
			const r = ken(['get', KEY, '-b', 'feat'], inRoot(at))
			expect(r.status).toBe(1)
			expect(r.stderr).toContain('has no commit yet, so there is nothing to start feat from')
			expect(r.stderr).toContain(`\`ken get ${KEY} -b feat --from <ref>\``)
			git(clone, 'commit', '-q', '--allow-empty', '-m', 'one')
			git(clone, 'switch', '-q', '--detach')
			const detached = ken(['get', KEY, '-b', 'feat'], inRoot(at))
			expect(detached.stderr).toContain(`Run \`git -C ${clone} switch main\``)
			expect(readdirSync(join(clone, '..'))).toEqual(['lib'])
		})

		it('a failed git worktree add leaves no branch behind, and says what is left', () => {
			const { at, clone, wt } = cloned()
			// a git that puts a file into the folder ken made, between its checks and the add
			const real = spawnSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).stdout.trim()
			const bin = join(dir, `racy-git-${shell}`)
			script(
				join(bin, 'git'),
				`case " $* " in *" worktree add "*) : >"${wt('feat')}/mine" ;; esac\nexec ${real} "$@"`
			)
			const r = ken(['get', KEY, '-b', 'feat'], inRoot(at, { PATH: `${bin}:${process.env.PATH}` }))
			expect(r.status).toBe(1)
			expect(r.stderr).toContain(`could not make the worktree of feat at ${wt('feat')}`)
			expect(r.stderr).toContain('Deleted the branch feat again.')
			expect(r.stderr).toContain(`Left ${wt('feat')}, which is not empty`)
			expect(out(clone, 'branch', '--list', 'feat')).toBe('')
		})

		it('a folder made by another get after the branch is left to it, the branch kept', () => {
			const { at, clone, wt } = cloned()
			// another get saw the branch, made the folder and is about to add its worktree
			const real = spawnSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).stdout.trim()
			const bin = join(dir, `slow-git-${shell}`)
			script(
				join(bin, 'git'),
				`${real} "$@" || exit\nif [ "$3 $#" = "branch 5" ]; then mkdir "${wt('feat')}"; fi`
			)
			const r = ken(['get', KEY, '-b', 'feat'], inRoot(at, { PATH: `${bin}:${process.env.PATH}` }))
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
			for (const r of both.filter((r) => r.status !== 0)) {
				expect(r.stderr).toMatch(/ken get example\.com\/acme\/lib -b feat/)
			}
			expect(out(clone, 'branch', '--list', 'feat')).toBe('+ feat\n')
			expect(out(clone, 'worktree', 'list').trim().split('\n').length).toBe(2)
			expect(readdirSync(join(clone, '..'))).toEqual(['lib', 'lib.feat'])
		})
	})

	describe('repos', () => {
		const at = () => join(dir, `repos-${shell}`)
		const own = () => join(`${at()}.src`, 'example.com/acme')
		// A root listing app, lib with no desc, and its layer team; team, cloned, lists lib too
		// (the root's entry wins), tool, and docs, its own layer, which lists manual with no desc;
		// the layer gone has no clone. On disk: app on main with a worktree where its branch
		// puts it, a detached one, and one moved off its folder; lib switched to side; loose, a
		// clone no index lists, and example.com/.dot/..tools, one whose key parts start with dots. Clones of src-lib have origin/HEAD; the others, made here, have no remote-tracking branch, so they are local only.
		beforeAll(() => {
			const o = own()
			write(
				join(at(), '.ken'),
				'layer.team=example.com/acme/team\nlayer.gone=example.com/acme/gone\n'
			)
			write(
				join(at(), '.repos'),
				'repo: example.com/acme/app\ndesc: The app.\n\nrepo: example.com/acme/lib\n\nrepo: example.com/acme/team\ndesc: The team layer.\n'
			)
			repo(join(o, 'team'))
			write(join(o, 'team/.ken'), 'layer.docs=example.com/acme/docs\n')
			write(
				join(o, 'team/.repos'),
				'repo: example.com/acme/lib\ndesc: Lib, as the team says.\n\nrepo: example.com/acme/tool\ndesc: A tool.\n\nrepo: example.com/acme/docs\ndesc: The docs layer.\n'
			)
			repo(join(o, 'docs'))
			write(join(o, 'docs/.ken'), '')
			write(join(o, 'docs/.repos'), 'repo: example.com/acme/manual\n')
			git(dir, 'clone', '-q', 'src-lib', join(o, 'app'))
			git(dir, 'clone', '-q', 'src-lib', join(o, 'lib'))
			git(join(o, 'lib'), 'switch', '-q', '-c', 'side')
			repo(join(o, 'loose'))
			repo(join(`${at()}.src`, 'example.com/.dot/..tools'))
			const app = join(o, 'app')
			git(app, 'worktree', 'add', '-q', '-b', 'feat/ok', '../app.feat-ok')
			git(app, 'worktree', 'add', '-q', '--detach', '../app.pinned')
			git(app, 'worktree', 'add', '-q', '-b', 'feat/x', '../app.feat-x')
			git(app, 'worktree', 'move', '../app.feat-x', '../app.renamed')
			// a tag named as the remote HEAD's short form, which git then shortens to remotes/origin/main
			git(app, 'tag', 'origin/main')
		})
		const noDesc =
			'stray: no desc, and a desc is what lets an agent choose a repo before cloning it. Run'
		const offSide = () =>
			`  stray: the clone has the branch side checked out, not its default branch main, which every \`ken get -b\` starts from. Run \`git -C ${own()}/lib switch main\`, then \`ken get example.com/acme/lib -b side\`.`
		const manual = () =>
			`  ${noDesc} \`cd ${own()}/docs && ken index set example.com/acme/manual desc="..."\`.`

		it('merges the indexes over the disk, a row per key with its worktrees and strays', () => {
			const o = own()
			const r = ken(['repos'], inRoot(at()))
			expect(r.status).toBe(0)
			expect(r.stdout).toBe(
				[
					'example.com/.dot/..tools  listed by no index, cloned on main, local only',
					'  stray: no index lists it, so nothing says what it is and only this disk knows it. Run `ken index set example.com/.dot/..tools desc="..."`.',
					'example.com/acme/app  listed by root, cloned on main',
					'  The app.',
					`  worktree feat/ok  ${o}/app.feat-ok`,
					`  worktree (detached)  ${o}/app.pinned`,
					`  worktree feat/x  ${o}/app.renamed`,
					`  stray: the worktree of feat/x is at ${o}/app.renamed, not ${o}/app.feat-x, where \`ken get -b\` and \`ken path code\` look for it. Run \`git -C ${o}/app worktree move ${o}/app.renamed ${o}/app.feat-x\`.`,
					'example.com/acme/docs  listed by team, cloned on main, local only',
					'  The docs layer.',
					'example.com/acme/lib  listed by root, cloned on side',
					`  ${noDesc} \`ken index set example.com/acme/lib desc="..."\`.`,
					offSide(),
					'example.com/acme/loose  listed by no index, cloned on main, local only',
					'  stray: no index lists it, so nothing says what it is and only this disk knows it. Run `ken index set example.com/acme/loose desc="..."`.',
					'example.com/acme/manual  listed by team/docs, not cloned',
					manual(),
					'example.com/acme/team  listed by root, cloned on main, local only',
					'  The team layer.',
					'example.com/acme/tool  listed by team, not cloned',
					'  A tool.',
					''
				].join('\n')
			)
			expect(r.stderr).toBe(
				`ken: the layer gone, example.com/acme/gone, is offline: it has no clone at ${o}/gone, so its index and its layers' are left out. Run \`ken init ${at()}\` to clone it.\n`
			)
		})

		it('--porcelain: a line per key, key, desc, listed by, cloned and branch split by tabs', () => {
			const r = ken(['repos', '--porcelain'], inRoot(at()))
			expect(r.status).toBe(0)
			expect(
				r.stdout
					.replace(/\n$/, '')
					.split('\n')
					.map((line) => line.split('\t'))
			).toEqual([
				['example.com/.dot/..tools', '', '', 'true', 'main'],
				['example.com/acme/app', 'The app.', 'root', 'true', 'main'],
				['example.com/acme/docs', 'The docs layer.', 'team', 'true', 'main'],
				['example.com/acme/lib', '', 'root', 'true', 'side'],
				['example.com/acme/loose', '', '', 'true', 'main'],
				['example.com/acme/manual', '', 'team/docs', 'false', ''],
				['example.com/acme/team', 'The team layer.', 'root', 'true', 'main'],
				['example.com/acme/tool', 'A tool.', 'team', 'false', '']
			])
			expect(r.stderr).toMatch(/^ken: the layer gone, example\.com\/acme\/gone, is offline/)
		})

		it("inside a layer lists the layer's keys and its layers', with no clone of the disk", () => {
			const r = ken(['repos'], { cwd: join(own(), 'team'), env: { KEN_SRC: `${at()}.src` } })
			expect(r).toEqual({
				status: 0,
				stdout: [
					'example.com/acme/docs  listed by root, cloned on main, local only',
					'  The docs layer.',
					'example.com/acme/lib  listed by root, cloned on side',
					'  Lib, as the team says.',
					offSide(),
					'example.com/acme/manual  listed by docs, not cloned',
					manual(),
					'example.com/acme/tool  listed by root, not cloned',
					'  A tool.',
					''
				].join('\n'),
				stderr: ''
			})
		})

		it('a root path with a tab and a newline, a worktree moved to a folder with a newline: rows whole, fixes that run', () => {
			const odd = join(dir, `repos-${shell}-odd\t\nroot`)
			const o = join(`${odd}.src`, 'example.com/acme')
			write(join(odd, '.ken'), 'layer.team=example.com/acme/team\n')
			write(join(odd, '.repos'), 'repo: example.com/acme/app\ndesc: The app.\n')
			repo(join(o, 'team'))
			write(join(o, 'team/.ken'), '')
			write(join(o, 'team/.repos'), 'repo: example.com/acme/tool\n')
			git(dir, 'clone', '-q', 'src-lib', join(o, 'app'))
			git(join(o, 'app'), 'worktree', 'add', '-q', '-b', 'feat/x', '../app.feat-x')
			git(join(o, 'app'), 'worktree', 'move', '../app.feat-x', '../app.odd\nname')
			const porcelain = ken(['repos', '--porcelain'], inRoot(odd))
			expect(
				porcelain.stdout
					.replace(/\n$/, '')
					.split('\n')
					.map((line) => line.split('\t'))
			).toEqual([
				['example.com/acme/app', 'The app.', 'root', 'true', 'main'],
				['example.com/acme/team', '', '', 'true', 'main'],
				['example.com/acme/tool', '', 'team', 'false', '']
			])
			const r = ken(['repos'], inRoot(odd))
			expect(r.stdout).toContain(
				`Run \`cd '${o}/team' && ken index set example.com/acme/tool desc="..."\`.`
			)
			const move = r.stdout.match(/Run `(git -C [^`]*)`/)?.[1] ?? ''
			expect(move).toBe(`git -C '${o}/app' worktree move '${o}/app.odd\nname' '${o}/app.feat-x'`)
			expect(spawnSync('sh', ['-c', move], { env: env() }).status).toBe(0)
			expect(ken(['repos'], inRoot(odd)).stdout).not.toContain('worktree move')
		})

		it('a layer named root: the fix for a scope entry still writes the scope index', () => {
			const at = join(dir, `repos-${shell}-named-root`)
			write(join(at, '.ken'), 'layer.root=example.com/acme/team\n')
			const team = join(`${at}.src`, 'example.com/acme/team')
			write(join(at, '.repos'), 'repo: example.com/acme/mine\n')
			repo(team)
			write(join(team, '.ken'), '')
			write(join(team, '.repos'), 'repo: example.com/acme/theirs\n')
			const r = ken(['repos'], inRoot(at))
			expect(r.stdout).toContain('Run `ken index set example.com/acme/mine desc="..."`.')
			expect(r.stdout).toContain(
				`Run \`cd ${team} && ken index set example.com/acme/theirs desc="..."\`.`
			)
		})

		it('with no repo at all says so and what to run', () => {
			const empty = join(dir, `repos-empty-${shell}`)
			write(join(empty, '.ken'), '')
			const r = ken(['repos'], inRoot(empty))
			expect(r.status).toBe(0)
			expect(r.stdout).toBe('')
			expect(r.stderr).toBe(
				`ken: no index of ${empty} or of its layers lists a repo, and ${empty}.src holds no clone, so there is nothing to list. Run \`ken get <key>\` to clone a repo and list it, or \`ken index set <key> desc="..."\` to list one uncloned.\n`
			)
		})

		it('refuses an argument it does not take', () => {
			const r = ken(['repos', '-v'], inRoot(at()))
			expect(r.status).toBe(1)
			expect(r.stderr).toBe(
				'ken: ken repos takes only --porcelain, not -v. Run `ken repos --help`.\n'
			)
		})
	})

	describe('help', () => {
		it('carries the same examples as <command> --help, and the external commands found', () => {
			const all = ken(['help']).stdout
			for (const name of ['init', 'path', 'which', 'get', 'repos', 'index', 'layer']) {
				const page = ken([name, '--help'])
				expect(page.status).toBe(0)
				expect(ken(['help', name]).stdout).toBe(page.stdout)
				const examples = page.stdout.split('Examples:\n')[1]?.trim().split('\n') ?? []
				expect(examples.length).toBeGreaterThan(2)
				for (const example of examples) expect(all).toContain(example.trim())
			}
			expect(all).toContain(`  the scope, ${root}/.bin: back, both, hello\n`)
			expect(all).toContain(`  layer atlas, ${atlas}/.bin: team\n`)
			expect(all).toContain(`  PATH, ${pathBin}: far\n`)
			expect(all).toContain(`Here the scope is ${root} and the checkouts are in ${src}.`)
		})

		it('lists the builtins outside any root, saying why no external commands are listed', () => {
			const r = ken([], { cwd: join(dir, 'outside') })
			expect(r.status).toBe(0)
			expect(r.stdout).toContain('  path root | code <key>')
			expect(r.stdout).toContain(
				`External commands: none listed, because ${dir}/outside is in no ken root`
			)
		})
	})
})

it('the kernel stays under its cap of 1,650 lines, so it is read in a sitting', () => {
	expect(readFileSync(KEN, 'utf8').split('\n').length).toBeLessThan(1650)
})
