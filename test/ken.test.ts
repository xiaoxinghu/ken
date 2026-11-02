import { spawn, spawnSync } from 'node:child_process'
import {
	copyFileSync,
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

// A layer's remote, remotes/acme/<name>.git: a root whose .ken lists `layers`, each with its
// tracked link <name> -> .repos/<key>, and holding `files`.
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
	for (const [n, k] of Object.entries(layers)) symlinkSync(`.repos/${k}`, join(src, n))
	for (const [file, body] of Object.entries(files)) write(join(src, file), body)
	git(src, 'add', '-A')
	git(src, 'commit', '-q', '-m', 'layer')
	git(dir, 'clone', '-q', '--bare', `src-${name}`, `remotes/acme/${name}.git`)
}

// A root with one direct layer and its link, a clone with a worktree beside it and a detached
// one elsewhere, a folder with no .git where a checkout belongs, a worktree of a clone outside
// the root, a nested root that is not a layer, a folder on PATH, and a HOME with no ~/ken, so
// nothing outside the temp folder is ever found. HOME's git config sends https://example.com/
// to bare repos under remotes/, which serve blobless clones (acme/lib: v1, an empty commit, then
// a README), and old-git/ holds a git 2.47.
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
	script(join(dir, 'old-git/git'), 'echo "git version 2.47.1"')
	// three layers, A listing B, B listing C, and C listing A again
	layerRemote(
		'la',
		{ B: 'example.com/acme/lb' },
		{
			'page.md': 'a\n',
			'.repos/github.com/team-a/AGENTS.md': 'team a\n',
			'.repos/github.com/shared/AGENTS.md': 'shared from a\n',
			'.agents/skills/sa/SKILL.md': 'skill a\n',
			'.agents/skills/review notes/SKILL.md': 'notes\n'
		}
	)
	layerRemote(
		'lb',
		{ C: 'example.com/acme/lc' },
		{
			'.repos/github.com/team-b/AGENTS.md': 'team b\n',
			'.agents/skills/sb/SKILL.md': 'skill b\n'
		}
	)
	layerRemote(
		'lc',
		{ A: 'example.com/acme/la' },
		{ 'c.md': 'c\n', '.repos/github.com/team-c/AGENTS.md': 'team c\n' }
	)
	// an ssh and a wrapper that log their arguments and fail, as an unreachable host would
	for (const name of ['ssh-bin/ssh', 'ssh-bin/wrap', 'ssh bin/ssh'])
		script(join(dir, name), 'echo "$*" >>"$LOG"; exit 255')
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
	const env = (more?: Record<string, string>) => ({
		PATH: `${pathBin}:${process.env.PATH}`,
		HOME: join(dir, 'home'),
		GIT_CONFIG_NOSYSTEM: '1',
		...more
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
			const child = spawn(shell, [KEN, ...args], { cwd, env: env() })
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
			const around = `${dir}/missing-${shell}/../root/around-${shell}`
			const r = ken(['init', around], { cwd: outside() })
			expect(r.status).toBe(1)
			expect(r.stderr).toContain('climbs out of')
			expect(existsSync(join(root, `around-${shell}`))).toBe(false)
			for (const shallow of [`dot-${shell}/./repo`, `slash-${shell}//repo`]) {
				expect(ken(['init', `${root}/.repos/${shallow}`], { cwd: outside() }).status).toBe(1)
			}
			expect(existsSync(join(root, `.repos/dot-${shell}`))).toBe(false)
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

	describe('reconcile, run by init', () => {
		const outside = () => join(dir, 'outside')
		const status = (repo: string) =>
			spawnSync('git', ['-C', repo, 'status', '--porcelain'], { encoding: 'utf8', env: env() })
				.stdout

		it('clones layers and theirs at the top, links them, and undoes the links of a layer removed', () => {
			const at = join(dir, `layered-${shell}`)
			const clone = (name: string) => join(at, '.repos/example.com/acme', name)
			const owner = (name: string) => join(at, '.repos/github.com', name, 'AGENTS.md')
			write(join(at, '.ken'), 'layer.A=example.com/acme/la\nlayer.gone=example.com/acme/gone\n')
			write(owner('shared'), 'mine\n')
			symlinkSync('.repos/example.com/acme/la', join(at, 'A'))
			const r = ken(['init', at], { cwd: outside() })
			expect(r.status).toBe(0)
			expect(r.stdout).toContain(`Layer A: cloned example.com/acme/la at ${clone('la')}.`)
			expect(r.stdout).toContain('Layer A/B: cloned example.com/acme/lb')
			expect(r.stdout).toContain('Layer A/B/C: cloned example.com/acme/lc')
			expect(r.stderr).toContain(
				'ken: layer gone, example.com/acme/gone, is offline on this machine'
			)
			expect(r.stderr).toContain('does not appear to be a git repository')
			expect(r.stderr).toContain(`run \`ken init ${at}\` again`)
			// the tracked links resolve through the hoisted clones, the cycle back to A included
			expect(readFileSync(join(at, 'A/B/C/c.md'), 'utf8')).toBe('c\n')
			expect(readFileSync(join(at, 'A/B/C/A/page.md'), 'utf8')).toBe('a\n')
			for (const name of ['la', 'lb', 'lc']) expect(status(clone(name))).toBe('')
			expect(readdirSync(join(at, '.repos/example.com/acme')).sort()).toEqual(['la', 'lb', 'lc'])
			// owner context from every reachable layer where the root has none; skills from A only
			for (const name of ['a', 'b', 'c']) {
				expect(readFileSync(owner(`team-${name}`), 'utf8')).toBe(`team ${name}\n`)
			}
			expect(readFileSync(owner('shared'), 'utf8')).toBe('mine\n')
			expect(readFileSync(join(at, '.agents/skills/sa/SKILL.md'), 'utf8')).toBe('skill a\n')
			expect(existsSync(join(at, '.agents/skills/sb'))).toBe(false)
			expect(r.stdout).toContain(` '.agents/skills/review notes' .agents/skills/sa `)
			const again = ken(['init', at], { cwd: outside() })
			expect(again.stdout).toContain('Layer A/B/C: example.com/acme/lc is cloned already')
			expect(again.stdout).not.toContain('Linked')
			// A no longer listed: its links and those of the layers it brought go, the clones stay
			write(join(at, '.ken'), 'layer.gone=example.com/acme/gone\n')
			const removed = ken(['init', at], { cwd: outside() })
			expect(removed.status).toBe(0)
			expect(removed.stdout).toContain(
				`Removed ${owner('team-c')}, a link into example.com/acme/lc`
			)
			for (const name of ['a', 'b', 'c']) expect(existsSync(owner(`team-${name}`))).toBe(false)
			expect(existsSync(join(at, '.agents/skills/sa'))).toBe(false)
			expect(readFileSync(owner('shared'), 'utf8')).toBe('mine\n')
			expect(readdirSync(join(at, '.repos/example.com/acme')).sort()).toEqual(['la', 'lb', 'lc'])
		}, 20_000)

		it('takes only a real clone as a layer that is there, and adds an exclude rule as its own line', () => {
			const at = join(dir, `there-${shell}`)
			const la = join(at, '.repos/example.com/acme/la')
			write(join(at, '.ken'), 'layer.A=example.com/acme/la\nlayer.P=example.com/acme/plain\n')
			write(join(at, '.repos/example.com/acme/plain/.ken'), 'layer.X=example.com/acme/lc\n')
			mkdirSync(join(at, '.repos/example.com/acme/plain/.git'))
			git(dir, 'clone', '-q', join(dir, 'remotes/acme/la.git'), la)
			write(join(la, '.git/info/exclude'), 'mine')
			const r = ken(['init', at], { cwd: outside() })
			expect(r.status).toBe(0)
			expect(r.stderr).toContain('ken: layer P, example.com/acme/plain, is offline')
			expect(r.stderr).toContain('but it is a folder whose .git git does not take as its repo')
			expect(r.stdout).toContain('Layer A: example.com/acme/la is cloned already')
			expect(r.stdout).not.toContain('Layer P')
			expect(existsSync(join(at, '.repos/example.com/acme/plain/.repos'))).toBe(false)
			expect(readFileSync(join(la, '.git/info/exclude'), 'utf8')).toBe(
				'mine\n/.repos/example.com/acme/lb\n'
			)
			expect(status(la)).toBe('')
		}, 20_000)

		it('leaves a folder that is a link alone, and drops the skills of a direct layer gone offline', () => {
			const at = join(dir, `linked-${shell}`)
			const la = join(at, '.repos/example.com/acme/la')
			const away = join(dir, `linked-away-${shell}`)
			write(join(at, '.ken'), 'layer.A=example.com/acme/la\n')
			git(dir, 'clone', '-q', join(dir, 'remotes/acme/la.git'), la)
			mkdirSync(away)
			symlinkSync(away, join(la, '.repos/example.com'))
			const r = ken(['init', at], { cwd: outside() })
			expect(r.stdout).toContain(
				`Left ${la}/.repos/example.com/acme/lb alone: ${la}/.repos/example.com is a link`
			)
			expect(readdirSync(away)).toEqual([])
			expect(existsSync(join(at, '.agents/skills/sa'))).toBe(true)
			// .repos itself a link in another layer's clone: left alone too
			const lb = join(at, '.repos/example.com/acme/lb')
			rmSync(join(lb, '.repos/example.com/acme/lc'))
			renameSync(join(lb, '.repos'), join(lb, 'moved'))
			symlinkSync('moved', join(lb, '.repos'))
			expect(ken(['init', at], { cwd: outside() }).stdout).toContain(
				`Left ${lb}/.repos/example.com/acme/lc alone: ${lb}/.repos is a link`
			)
			expect(existsSync(join(lb, 'moved/example.com/acme/lc'))).toBe(false)
			// the scope's .repos a link: A is offline, its skills go, and nothing under the link is touched
			const repos = join(dir, `linked-repos-${shell}`)
			const teamA = join(repos, 'github.com/team-a/AGENTS.md')
			renameSync(join(at, '.repos'), repos)
			symlinkSync(repos, join(at, '.repos'))
			const offline = ken(['init', at], { cwd: outside() })
			expect(offline.stderr).toContain('ken: layer A, example.com/acme/la, is offline')
			expect(offline.stdout).toContain(
				`Removed ${at}/.agents/skills/sa, a link into example.com/acme/la`
			)
			expect(existsSync(join(at, '.agents/skills/sa'))).toBe(false)
			expect(offline.stdout).toContain(
				`Left ${at}/.repos/github.com/team-a/AGENTS.md alone: ${at}/.repos is a link`
			)
			expect(lstatSync(teamA).isSymbolicLink()).toBe(true)
		}, 20_000)

		it('get -b of a layer reconciles its worktree, saying so on stderr, stdout the path alone', () => {
			const at = join(dir, `branched-${shell}`)
			const la = join(at, '.repos/example.com/acme/la')
			write(join(at, '.ken'), 'layer.A=example.com/acme/la\n')
			expect(ken(['init', at], { cwd: outside() }).status).toBe(0)
			const r = ken(['get', 'example.com/acme/la', '-b', 'feat'], { cwd: at })
			expect(r.status).toBe(0)
			expect(r.stdout).toBe(`${la}.feat\n`)
			expect(r.stderr).toContain('Layer B/C: example.com/acme/lc is cloned already')
			expect(r.stderr).toContain(`Linked ${la}.feat/.repos/example.com/acme/lb -> `)
			expect(readFileSync(join(`${la}.feat`, 'B/C/c.md'), 'utf8')).toBe('c\n')
			// the link to the hoisted clone is excluded; the owner and skill links are the worktree's to track
			expect(status(`${la}.feat`)).not.toContain('example.com')
			expect(r.stderr).toContain(`Track the links at ${la}.feat with`)
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

		it('writers take turns, so parallel sets of different repos lose none', async () => {
			const r = fresh('')
			const keys = [1, 2, 3, 4, 5, 6].map((i) => `github.com/acme/r${i}`)
			const all = await Promise.all(
				keys.map((k) => kenAsync(['index', 'set', k, 'desc=R.'], r.cwd))
			)
			expect(all.map((a) => a.status)).toEqual(keys.map(() => 0))
			for (const k of keys) expect(r.read()).toContain(`repo: ${k}\ndesc: R.\n`)
			expect(readdirSync(join(r.cwd, '.repos'))).toEqual(['index'])
		})

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

	describe('get', () => {
		const KEY = 'example.com/acme/lib'
		let n = 0
		// A fresh root whose .ken holds `settings`.
		const fresh = (settings = '') => {
			const at = join(dir, `get-${shell}-${n++}`)
			write(join(at, '.ken'), settings)
			return at
		}
		const cloneOf = (at: string, key = KEY) => join(at, '.repos', key)
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

		it('clones blobless at the top, registers the key and says to describe it; again is silent', () => {
			const at = fresh()
			const clone = cloneOf(at)
			const first = ken(['get', KEY], { cwd: join(dir, 'outside'), env: { KEN_ROOT: at } })
			expect(first.status).toBe(0)
			expect(first.stdout).toBe(`${clone}\n`)
			expect(first.stderr).toContain(registered(`${at}/.repos/index`))
			expect(first.stderr).toContain(`Run \`ken index set ${KEY} desc="..."\``)
			expect(readFileSync(join(at, '.repos/index'), 'utf8')).toBe(`repo: ${KEY}\n`)
			expect(readFileSync(join(clone, 'README.md'), 'utf8')).toBe('lib\n')
			expect(config(clone, 'worktree.useRelativePaths')).toBe('true\n')
			expect(config(clone, 'remote.origin.partialclonefilter')).toBe('blob:none\n')
			expect(readdirSync(join(at, '.repos/example.com/acme'))).toEqual(['lib'])
			expect(ken(['get', `https://${KEY}.git`], { cwd: at })).toEqual({
				status: 0,
				stdout: first.stdout,
				stderr: ''
			})
		})

		it('clones whole when the scope says clone.blobless=false', () => {
			const at = fresh('clone.blobless=false\n')
			expect(ken(['get', KEY], { cwd: at }).status).toBe(0)
			expect(config(cloneOf(at), 'remote.origin.partialclonefilter')).toBe('')
		})

		it('refuses a clone.blobless it cannot read before making anything, so the rerun clones', () => {
			const at = fresh('clone.blobless=flase\n')
			const r = ken(['get', KEY], { cwd: at })
			expect(r.status).toBe(1)
			expect(r.stderr).toContain(`${at}/.ken sets clone.blobless to neither true nor false`)
			expect(existsSync(join(at, '.repos'))).toBe(false)
			write(join(at, '.ken'), 'clone.blobless=false\n')
			expect(ken(['get', KEY], { cwd: at }).stdout).toBe(`${cloneOf(at)}\n`)
		})

		it('uses a repo made with git init where the clone belongs, as it is', () => {
			const at = fresh()
			repo(cloneOf(at))
			const r = ken(['get', KEY], { cwd: at })
			expect(r.stdout).toBe(`${cloneOf(at)}\n`)
			expect(r.stderr).toContain(registered(`${at}/.repos/index`))
			expect(config(cloneOf(at), 'worktree.useRelativePaths')).toBe('true\n')
			expect(config(cloneOf(at), 'remote.origin.url')).toBe('')
		})

		it("from inside a layer clones at the top and registers in the layer's index", () => {
			const at = fresh('layer.team=example.com/acme/team\n')
			const team = cloneOf(at, 'example.com/acme/team')
			write(join(team, '.ken'), '')
			const r = ken(['get', KEY], { cwd: team })
			expect(r.stdout).toBe(`${cloneOf(at)}\n`)
			expect(r.stderr).toContain(registered(`${team}/.repos/index`))
			expect(readFileSync(join(team, '.repos/index'), 'utf8')).toBe(`repo: ${KEY}\n`)
			expect(existsSync(join(at, '.repos/index'))).toBe(false)
		})

		it("registers nothing when the scope's index or a reachable layer's lists the key", () => {
			const listed = fresh()
			const index = `# The index.\n\nrepo: ${KEY}\ndesc: Lib.\n`
			write(join(listed, '.repos/index'), index)
			expect(ken(['get', KEY], { cwd: listed }).stderr).toBe('')
			expect(readFileSync(join(listed, '.repos/index'), 'utf8')).toBe(index)
			// an offline layer is skipped, and a layer's own layer reached, through a cycle back
			const at = fresh('layer.gone=example.com/acme/gone\nlayer.team=example.com/acme/team\n')
			write(join(cloneOf(at, 'example.com/acme/team'), '.ken'), 'layer.hb=example.com/acme/hb\n')
			write(join(cloneOf(at, 'example.com/acme/hb'), '.ken'), 'layer.team=example.com/acme/team\n')
			write(join(cloneOf(at, 'example.com/acme/hb'), '.repos/index'), `repo: ${KEY}\n`)
			expect(ken(['get', KEY], { cwd: at })).toEqual({
				status: 0,
				stdout: `${cloneOf(at)}\n`,
				stderr: ''
			})
			expect(existsSync(join(at, '.repos/index'))).toBe(false)
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
				const r = ken(['get', KEY], { cwd: at })
				expect(r.status).toBe(1)
				expect(r.stdout).toBe('')
				expect(r.stderr).toContain(
					`${clone} is where the clone of ${KEY} belongs, but it is ${what}`
				)
				expect(r.stderr).toContain(`\`mv ${clone} ~/lib.aside\``)
				expect(shape(clone)).toBe(before)
				expect(existsSync(join(at, '.repos/index'))).toBe(false)
			}
			const plain = fresh()
			mkdirSync(cloneOf(plain), { recursive: true })
			expect(ken(['get', KEY], { cwd: plain }).stderr).toContain(
				`run \`git init ${cloneOf(plain)}\` then \`ken get ${KEY}\``
			)
		})

		it('refuses .repos, or the owner folder, as a symlink, which leads out of the top', () => {
			const at = fresh()
			const away = join(dir, `away-${shell}-${n}`)
			mkdirSync(away)
			symlinkSync(away, join(at, '.repos'))
			const r = ken(['get', KEY], { cwd: at })
			expect(r.status).toBe(1)
			expect(r.stderr).toContain(`${at}/.repos is a symlink to ${away}`)
			expect(r.stderr).toContain(`\`rm ${at}/.repos && mv ${away} ${at}/.repos\``)
			expect(readdirSync(away)).toEqual([])
			const owner = fresh()
			mkdirSync(join(owner, '.repos/example.com'), { recursive: true })
			symlinkSync(away, join(owner, '.repos/example.com/acme'))
			expect(ken(['get', KEY], { cwd: owner }).stderr).toContain(
				`${owner}/.repos/example.com/acme is a symlink to ${away}`
			)
			expect(readdirSync(away)).toEqual([])
		})

		it('a failed clone leaves no folder, says what git said and what to rerun', () => {
			const at = fresh()
			const r = ken(['get', 'example.com/acme/missing'], { cwd: at })
			expect(r.status).toBe(1)
			expect(r.stdout).toBe('')
			expect(r.stderr).toContain('does not appear to be a git repository')
			expect(r.stderr).toContain('A key alone clones https://example.com/acme/missing.git')
			expect(r.stderr).toContain('run `ken get example.com/acme/missing` again')
			expect(readdirSync(join(at, '.repos/example.com/acme'))).toEqual([])
			expect(existsSync(join(at, '.repos/index'))).toBe(false)
		})

		it('two gets at once: one clones, the other waits for it, and both print the path', async () => {
			const at = fresh()
			const both = await Promise.all([kenAsync(['get', KEY], at), kenAsync(['get', KEY], at)])
			for (const r of both) expect([r.status, r.stdout]).toEqual([0, `${cloneOf(at)}\n`])
			expect(both.filter((r) => r.stderr.includes('ken: registered')).length).toBe(1)
			expect(readdirSync(join(at, '.repos/example.com/acme'))).toEqual(['lib'])
			expect(readFileSync(join(at, '.repos/index'), 'utf8')).toBe(`repo: ${KEY}\n`)
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
			const r = ken(['get', KEY], {
				cwd: at,
				env: { PATH: `${join(dir, 'old-git')}:${process.env.PATH}` }
			})
			expect(r.status).toBe(1)
			expect(r.stderr).toContain('git version 2.47.1 is too old: ken needs git 2.48 or newer')
			expect(existsSync(join(at, '.repos'))).toBe(false)
		})
	})

	describe('get -b', () => {
		const KEY = 'example.com/acme/lib'
		let n = 0
		// A fresh root with lib cloned into it.
		const cloned = () => {
			const at = join(dir, `get-b-${shell}-${n++}`)
			write(join(at, '.ken'), '')
			expect(ken(['get', KEY], { cwd: at }).status).toBe(0)
			const clone = join(at, '.repos', KEY)
			return { at, clone, wt: (folder: string) => `${clone}.${folder}` }
		}
		const out = (cwd: string, ...args: string[]) =>
			spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8', env: env() }).stdout
		const head = (cwd: string) => out(cwd, 'rev-parse', '--abbrev-ref', 'HEAD').trim()

		it('a new branch gets its worktree beside the clone, linked relatively; again prints it', () => {
			const { at, clone, wt } = cloned()
			const r = ken(['get', KEY, '-b', 'feat/x'], { cwd: at })
			expect(r).toEqual({ status: 0, stdout: `${wt('feat-x')}\n`, stderr: '' })
			expect(readFileSync(join(wt('feat-x'), '.git'), 'utf8')).toMatch(
				/^gitdir: \.\.\/lib\/\.git\/worktrees\/[^/]+\n$/
			)
			expect(head(wt('feat-x'))).toBe('feat/x')
			expect(out(wt('feat-x'), 'rev-parse', 'HEAD')).toBe(out(clone, 'rev-parse', 'HEAD'))
			expect(ken(['get', KEY, '-b', 'feat/x'], { cwd: at })).toEqual(r)
		})

		it('a root whose path holds a tab and a newline: again prints the same worktree', () => {
			const at = join(dir, `get-b-${shell}-odd\t\nroot`)
			write(join(at, '.ken'), '')
			expect(ken(['get', KEY], { cwd: at }).status).toBe(0)
			const first = ken(['get', KEY, '-b', 'feat'], { cwd: at })
			expect(first.stdout).toBe(`${join(at, '.repos', KEY)}.feat\n`)
			expect(ken(['get', KEY, '-b', 'feat'], { cwd: at })).toEqual(first)
		})

		it('the default branch prints the clone; an existing branch gets its worktree', () => {
			const { at, clone, wt } = cloned()
			expect(ken(['get', KEY, '-b', 'main'], { cwd: at }).stdout).toBe(`${clone}\n`)
			git(clone, 'branch', 'old', 'v1')
			expect(ken(['get', KEY, '-b', 'old'], { cwd: at }).stdout).toBe(`${wt('old')}\n`)
			expect(head(wt('old'))).toBe('old')
			// a tag named main makes git shorten the default branch to heads/main, a branch of its own
			git(clone, 'tag', 'main')
			expect(ken(['get', KEY, '-b', 'heads/main'], { cwd: at }).stdout).toBe(
				`${wt('heads-main')}\n`
			)
			expect(ken(['get', KEY, '-b', 'main'], { cwd: at }).stdout).toBe(`${clone}\n`)
		})

		it('--from starts a new branch there, and is refused for one that exists', () => {
			const { at, wt } = cloned()
			expect(ken(['get', KEY, '-b', 'fix', '--from', 'v1'], { cwd: at }).stdout).toBe(
				`${wt('fix')}\n`
			)
			expect(existsSync(join(wt('fix'), 'README.md'))).toBe(false)
			for (const branch of ['fix', 'main']) {
				const r = ken(['get', KEY, '-b', branch, '--from', 'v1'], { cwd: at })
				expect(r.status).toBe(1)
				expect(r.stderr).toContain(`Run \`ken get ${KEY} -b ${branch}\` for its worktree`)
			}
		})

		it("a branch named for a folder of another's is refused, never given that one's worktree", () => {
			const { at, clone, wt } = cloned()
			ken(['get', KEY, '-b', 'feat/x'], { cwd: at })
			const r = ken(['get', KEY, '-b', 'feat'], { cwd: at })
			expect([r.status, r.stdout]).toEqual([1, ''])
			expect(r.stderr).toContain('could not make the branch feat')
			expect(readdirSync(join(clone, '..'))).toEqual(['lib', 'lib.feat-x'])
			expect(head(wt('feat-x'))).toBe('feat/x')
		})

		it('a bad branch name is refused before the clone is touched', () => {
			const at = join(dir, `get-b-${shell}-${n++}`)
			write(join(at, '.ken'), '')
			const r = ken(['get', KEY, '-b', 'a..b'], { cwd: at })
			expect(r.status).toBe(1)
			expect(r.stderr).toContain('is not a branch name git accepts')
			expect(existsSync(join(at, '.repos'))).toBe(false)
		})

		it('a folder differing only by case is refused, naming the branch its worktree holds', () => {
			const { at, clone, wt } = cloned()
			ken(['get', KEY, '-b', 'feat'], { cwd: at })
			const r = ken(['get', KEY, '-b', 'Feat'], { cwd: at })
			expect(r.status).toBe(1)
			expect(r.stderr).toContain(`but ${wt('feat')} differs only by case from it`)
			expect(r.stderr).toContain(`a worktree of ${clone} holding the branch feat`)
			expect(out(clone, 'branch', '--list', 'Feat')).toBe('')
			expect(readdirSync(join(clone, '..'))).toEqual(['lib', 'lib.feat'])
		})

		it('an unborn default branch without --from, or a detached clone, is refused', () => {
			const at = join(dir, `get-b-${shell}-${n++}`)
			write(join(at, '.ken'), '')
			const clone = join(at, '.repos', KEY)
			mkdirSync(clone, { recursive: true })
			git(clone, 'init', '-q', '-b', 'main')
			const r = ken(['get', KEY, '-b', 'feat'], { cwd: at })
			expect(r.status).toBe(1)
			expect(r.stderr).toContain('has no commit yet, so there is nothing to start feat from')
			expect(r.stderr).toContain(`\`ken get ${KEY} -b feat --from <ref>\``)
			git(clone, 'commit', '-q', '--allow-empty', '-m', 'one')
			git(clone, 'switch', '-q', '--detach')
			const detached = ken(['get', KEY, '-b', 'feat'], { cwd: at })
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
			const r = ken(['get', KEY, '-b', 'feat'], {
				cwd: at,
				env: { PATH: `${bin}:${process.env.PATH}` }
			})
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
			const r = ken(['get', KEY, '-b', 'feat'], {
				cwd: at,
				env: { PATH: `${bin}:${process.env.PATH}` }
			})
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
		const own = () => join(at(), '.repos/example.com/acme')
		// A root listing app, lib with no desc, and its layer team; team, cloned, lists lib too
		// (the root's entry wins), tool, and docs, its own layer, which lists manual with no desc;
		// the layer gone has no clone. On disk: app on main with a worktree where its branch
		// puts it, a detached one, and one moved off its folder; lib switched to side; loose, a
		// clone no index lists. Clones of src-lib have origin/HEAD, the others none.
		beforeAll(() => {
			const o = own()
			write(
				join(at(), '.ken'),
				'layer.team=example.com/acme/team\nlayer.gone=example.com/acme/gone\n'
			)
			write(
				join(at(), '.repos/index'),
				'repo: example.com/acme/app\ndesc: The app.\n\nrepo: example.com/acme/lib\n\nrepo: example.com/acme/team\ndesc: The team layer.\n'
			)
			repo(join(o, 'team'))
			write(join(o, 'team/.ken'), 'layer.docs=example.com/acme/docs\n')
			write(
				join(o, 'team/.repos/index'),
				'repo: example.com/acme/lib\ndesc: Lib, as the team says.\n\nrepo: example.com/acme/tool\ndesc: A tool.\n\nrepo: example.com/acme/docs\ndesc: The docs layer.\n'
			)
			repo(join(o, 'docs'))
			write(join(o, 'docs/.ken'), '')
			write(join(o, 'docs/.repos/index'), 'repo: example.com/acme/manual\n')
			git(dir, 'clone', '-q', 'src-lib', join(o, 'app'))
			git(dir, 'clone', '-q', 'src-lib', join(o, 'lib'))
			git(join(o, 'lib'), 'switch', '-q', '-c', 'side')
			repo(join(o, 'loose'))
			const app = join(o, 'app')
			git(app, 'worktree', 'add', '-q', '-b', 'feat/ok', '../app.feat-ok')
			git(app, 'worktree', 'add', '-q', '--detach', '../app.pinned')
			git(app, 'worktree', 'add', '-q', '-b', 'feat/x', '../app.feat-x')
			git(app, 'worktree', 'move', '../app.feat-x', '../app.renamed')
		})
		const noDesc =
			'stray: no desc, and a desc is what lets an agent choose a repo before cloning it. Run'
		const offSide = () =>
			`  stray: the clone has the branch side checked out, not its default branch main, which every \`ken get -b\` starts from. Run \`git -C ${own()}/lib switch main\`, then \`ken get example.com/acme/lib -b side\`.`
		const manual = () =>
			`  ${noDesc} \`cd ${own()}/docs && ken index set example.com/acme/manual desc="..."\`.`

		it('merges the indexes over the disk, a row per key with its worktrees and strays', () => {
			const o = own()
			const r = ken(['repos'], { cwd: at() })
			expect(r.status).toBe(0)
			expect(r.stdout).toBe(
				[
					'example.com/acme/app  listed by root, cloned on main',
					'  The app.',
					`  worktree feat/ok  ${o}/app.feat-ok`,
					`  worktree (detached)  ${o}/app.pinned`,
					`  worktree feat/x  ${o}/app.renamed`,
					`  stray: the worktree of feat/x is at ${o}/app.renamed, not ${o}/app.feat-x, where \`ken get -b\` and \`ken path code\` look for it. Run \`git -C ${o}/app worktree move ${o}/app.renamed ${o}/app.feat-x\`.`,
					'example.com/acme/docs  listed by team, cloned on main',
					'  The docs layer.',
					'example.com/acme/lib  listed by root, cloned on side',
					`  ${noDesc} \`ken index set example.com/acme/lib desc="..."\`.`,
					offSide(),
					'example.com/acme/loose  listed by no index, cloned on main',
					'  stray: no index lists it, so nothing says what it is and only this disk knows it. Run `ken index set example.com/acme/loose desc="..."`.',
					'example.com/acme/manual  listed by team/docs, not cloned',
					manual(),
					'example.com/acme/team  listed by root, cloned on main',
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
			const r = ken(['repos', '--porcelain'], { cwd: at() })
			expect(r.status).toBe(0)
			expect(
				r.stdout
					.replace(/\n$/, '')
					.split('\n')
					.map((line) => line.split('\t'))
			).toEqual([
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
			const r = ken(['repos'], { cwd: join(own(), 'team') })
			expect(r).toEqual({
				status: 0,
				stdout: [
					'example.com/acme/docs  listed by root, cloned on main',
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

		it('with no repo at all says so and what to run', () => {
			const empty = join(dir, `repos-empty-${shell}`)
			write(join(empty, '.ken'), '')
			const r = ken(['repos'], { cwd: empty })
			expect(r.status).toBe(0)
			expect(r.stdout).toBe('')
			expect(r.stderr).toBe(
				`ken: no index of ${empty} or of its layers lists a repo, and ${empty}/.repos holds no clone, so there is nothing to list. Run \`ken get <key>\` to clone a repo and list it, or \`ken index set <key> desc="..."\` to list one uncloned.\n`
			)
		})

		it('refuses an argument it does not take', () => {
			const r = ken(['repos', '-v'], { cwd: at() })
			expect(r.status).toBe(1)
			expect(r.stderr).toBe(
				'ken: ken repos takes only --porcelain, not -v. Run `ken repos --help`.\n'
			)
		})
	})

	describe('help', () => {
		it('carries the same examples as <command> --help, and the external commands found', () => {
			const all = ken(['help']).stdout
			for (const name of ['init', 'path', 'which', 'get', 'repos', 'index']) {
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

it('the kernel stays under its cap of 1,500 lines, so it is read in a sitting', () => {
	expect(readFileSync(KEN, 'utf8').split('\n').length).toBeLessThan(1500)
})
