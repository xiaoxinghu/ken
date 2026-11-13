// The core's commands as a user runs them: cli.ts in a child process, against temp folders.
import { spawnSync } from 'node:child_process'
import {
	chmodSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	realpathSync,
	symlinkSync,
	writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const CLI = join(import.meta.dirname, 'cli.ts')
const VERSION = JSON.parse(
	readFileSync(join(import.meta.dirname, '../package.json'), 'utf8')
).version
const dir = realpathSync.native(mkdtempSync(join(tmpdir(), 'ken-core-')))
let n = 0
/** A new empty folder under the temp folder, which no root is above. */
const fresh = () => {
	const at = join(dir, `t${++n}`)
	mkdirSync(at)
	return at
}

/** `ken <args>` run from `cwd`, KEN_ROOT unset unless `root` is given, under `runtime`. */
const ken = (args: string[], cwd: string, root?: string, runtime = process.execPath) => {
	const env = { ...process.env }
	delete env.KEN_ROOT
	if (root !== undefined) env.KEN_ROOT = root
	const r = spawnSync(runtime, [CLI, ...args], { cwd, env, encoding: 'utf8' })
	return { status: r.status, stdout: r.stdout, stderr: r.stderr }
}

const KEN = `# ken settings: <key>=<value> lines, the first segment of a key naming its tool.
# The format is docs/files.md in github.com/xiaoxinghu/ken.
ken.format=1
`
const INDEX = "# .repos.index: what each repo is. Whether it exists is the remote's business.\n"

/** A root made by hand, its `.ken` holding `settings`. */
const rootWith = (settings: string) => {
	const at = fresh()
	writeFileSync(join(at, '.ken'), settings)
	return at
}

describe('init', () => {
	it('gives a folder, made when missing, only the files ken owns; a rerun creates nothing', () => {
		const at = join(fresh(), 'new')
		const r = ken(['init', at], dir)
		expect(r.status).toBe(0)
		expect(r.stdout).toContain(
			`${at} is a root. Made or added to:\n  .ken\n  .repos.index\n  .gitignore\n`
		)
		expect(r.stdout).toContain(`\`git -C ${at} add .ken .repos.index .gitignore\``)
		expect(readdirSync(at).sort()).toEqual(['.gitignore', '.ken', '.repos.index'])
		expect(readFileSync(join(at, '.ken'), 'utf8')).toBe(KEN)
		expect(readFileSync(join(at, '.repos.index'), 'utf8')).toBe(INDEX)
		expect(readFileSync(join(at, '.gitignore'), 'utf8')).toBe('.env\n.repos/\n')

		const again = ken(['init'], at)
		expect(again.status).toBe(0)
		expect(again.stdout).toBe(
			`${at} is a root already, with every file ken owns: nothing was created.\n`
		)
	})

	it('keeps what is there: an existing .gitignore gains only the lines it lacks', () => {
		const at = fresh()
		writeFileSync(join(at, '.ken'), 'ken.format=1\ntask.folder=todo\n')
		writeFileSync(join(at, '.repos.index'), 'repo: a/b/c\n')
		writeFileSync(join(at, '.gitignore'), 'node_modules\n.env  \n/dist')
		const r = ken(['init'], at)
		expect(r.stdout).toContain(`${at} is a root. Made or added to:\n  .gitignore\n`)
		expect(readFileSync(join(at, '.ken'), 'utf8')).toBe('ken.format=1\ntask.folder=todo\n')
		expect(readFileSync(join(at, '.repos.index'), 'utf8')).toBe('repo: a/b/c\n')
		expect(readFileSync(join(at, '.gitignore'), 'utf8')).toBe(
			'node_modules\n.env  \n/dist\n.repos/\n'
		)
	})

	it('refuses a folder inside a root, or in its .repos/, naming the root, and makes nothing', () => {
		const root = rootWith(KEN)
		const section = ken(['init', 'notes/deep'], root)
		expect(section.status).toBe(1)
		expect(section.stderr).toContain(
			`${root}/notes/deep is inside the root ${root}, and roots do not nest`
		)
		const checkout = join(root, '.repos/github.com/acme/atlas')
		mkdirSync(checkout, { recursive: true })
		const r = ken(['init'], checkout)
		expect(r.status).toBe(1)
		expect(r.stderr).toContain(
			`${checkout} is inside ${root}/.repos, where the root ${root} keeps its checkouts`
		)
		expect(existsSync(join(root, 'notes'))).toBe(false)
		expect(readdirSync(checkout)).toEqual([])
	})

	it('refuses a file it owns that is a folder or a dangling link, before making anything', () => {
		for (const name of ['.ken', '.repos.index', '.gitignore']) {
			const folder = fresh()
			mkdirSync(join(folder, name))
			const dangling = fresh()
			symlinkSync('nowhere', join(dangling, name))
			for (const at of [folder, dangling]) {
				const r = ken(['init', at], dir)
				expect(r.status).toBe(1)
				expect(r.stderr).toContain(`${at}/${name} is there but is not a file`)
				expect(readdirSync(at)).toEqual([name])
			}
		}
	})

	it('leaves a root from before the rewrite alone, naming the migration', () => {
		const at = rootWith('template.name=agents\n')
		const r = ken(['init'], at)
		expect(r.status).toBe(1)
		expect(r.stderr).toContain('is a root from before the rewrite of ken')
		expect(r.stderr).toContain('docs/prd.md#from-before-the-rewrite')
		expect(readdirSync(at)).toEqual(['.ken'])
	})

	it('refuses more than one folder, or a flag', () => {
		expect(ken(['init', 'a', 'b'], fresh()).stderr).toContain('ken init takes one folder, got 2')
		expect(ken(['init', '--force'], fresh()).stderr).toContain('ken init does not take --force')
	})

	it('says to cd into the root only when ken run from here would not find it', () => {
		const away = fresh()
		const at = join(fresh(), 'r')
		expect(ken(['init', at], away).stdout).toContain(
			`ken run from here finds no root, not ${at}. To work in it, run \`cd ${at}\`.`
		)
		const other = rootWith(KEN)
		expect(ken(['init', at], away, other).stdout).toContain(
			`KEN_ROOT is ${other}, so ken acts on that`
		)
		expect(ken(['init'], at).stdout).not.toContain('To work in it')
	})
})

describe('path root', () => {
	it('is the nearest .ken at or above the current folder, as a real path', () => {
		const root = rootWith(KEN)
		mkdirSync(join(root, 'a/b'), { recursive: true })
		const link = join(fresh(), 'link')
		symlinkSync(root, link)
		expect(ken(['path', 'root'], join(link, 'a/b')).stdout).toBe(`${root}\n`)
		expect(ken(['path', 'root'], root).stdout).toBe(`${root}\n`)
	})

	it('is KEN_ROOT when set, over the folder ken runs in', () => {
		const root = rootWith(KEN)
		const link = join(fresh(), 'link')
		symlinkSync(root, link)
		expect(ken(['path', 'root'], rootWith(KEN), link).stdout).toBe(`${root}\n`)
	})

	it('stops outside any root, and on a KEN_ROOT that is no root, saying what to run', () => {
		const away = fresh()
		const outside = ken(['path', 'root'], away)
		expect(outside.status).toBe(1)
		expect(outside.stderr).toContain(`${away} is in no ken root`)
		expect(outside.stderr).toContain('`ken init <dir>`')
		const file = join(away, 'file')
		writeFileSync(file, '')
		for (const [root, says] of [
			[join(away, 'gone'), `KEN_ROOT is ${away}/gone, which does not exist`],
			[file, `KEN_ROOT is ${file}, which is not a folder`],
			[away, `KEN_ROOT is ${away}, which holds no .ken file`]
		] as const) {
			const r = ken(['path', 'root'], away, root)
			expect(r.status).toBe(1)
			expect(r.stderr).toContain(says)
		}
	})

	it('reads a format up to its own, and stops on a newer one or none, saying what to do', () => {
		expect(ken(['path', 'root'], rootWith('x.y=1\nken.format=1\n')).status).toBe(0)

		const newer = ken(['path', 'root'], rootWith('ken.format=2\n'))
		expect(newer.status).toBe(1)
		expect(newer.stderr).toContain(
			'says ken.format=2, and this ken reads formats up to 1, so it is too old'
		)
		expect(newer.stderr).toContain('npm install -g @unclex/ken@latest')

		const old = rootWith('template.name=agents\n')
		const none = ken(['path', 'root'], old)
		expect(none.status).toBe(1)
		expect(none.stderr).toContain(
			`${old}/.ken has no ken.format line, so ${old} is a root from before the rewrite`
		)

		const bad = ken(['path', 'root'], rootWith('# c\nken.format=one\n'))
		expect(bad.stderr).toContain('.ken line 2, ken.format=one, is not a format ken can read')
		const unreadable = ken(['path', 'root'], rootWith('ken.format=1\nnot a setting\n'))
		expect(unreadable.stderr).toContain(".ken line 2, 'not a setting', is not a line ken can read")
	})

	it.skipIf(process.getuid?.() === 0)(
		'stops on a .ken it cannot read, saying how to fix it',
		() => {
			const root = rootWith(KEN)
			chmodSync(join(root, '.ken'), 0)
			for (const args of [['path', 'root'], ['init']]) {
				const r = ken(args, root)
				expect(r.status).toBe(1)
				expect(r.stderr).toMatch(new RegExp(`^ken: could not read ${root}/\\.ken: .*chmod u\\+r`))
			}
		}
	)

	it.skipIf(process.getuid?.() === 0)('stops on a folder it may not enter, naming it', () => {
		const shut = fresh()
		chmodSync(shut, 0)
		const r = ken(['path', 'root'], fresh(), join(shut, 'root'))
		chmodSync(shut, 0o755)
		expect(r.status).toBe(1)
		expect(r.stderr).toBe(
			`ken: could not stat ${shut}/root: EACCES, so ken cannot go on. Check who may read and enter it and the folders above it, e.g. \`ls -ld ${shut}/root\`, then rerun.\n`
		)
	})

	it('refuses any other form of path, and arguments after root', () => {
		const r = ken(['path', 'nope'], rootWith(KEN))
		expect(r.status).toBe(1)
		expect(r.stderr).toContain('ken path does not take nope: it takes root, code <key> [<branch>]')
		expect(ken(['path', 'root', 'x'], rootWith(KEN)).stderr).toContain(
			'ken path root takes no arguments'
		)
	})
})

describe('help, version and the rest', () => {
	it('lists every command with its examples, and the root found from here', () => {
		const root = rootWith(KEN)
		const r = ken(['help'], root)
		expect(r.status).toBe(0)
		for (const line of [
			'  init [<dir>]',
			'      ken init ~/ken',
			'  path root | code <key> [<branch>] | <key>:<path>[#<symbol>]',
			'  which [<path>]',
			'  get <url|key> [-b <branch> [--from <ref>]]',
			'  repos [--porcelain]',
			'  index set <key> <field>=<value>...',
			'  help [<command>]',
			'  version'
		])
			expect(r.stdout).toContain(`${line}\n`)
		expect(r.stdout).toContain(`Here the root is ${root}.`)
		expect(ken([], root).stdout).toBe(r.stdout)
		expect(ken(['--help'], fresh()).stdout).toContain('Here there is no root')
	})

	it('shows one command in full, as help <command> and as <command> --help', () => {
		const away = fresh()
		const page = ken(['help', 'init'], away).stdout
		expect(page).toMatch(/^ken init \[<dir>\]\n\nMake <dir>/)
		expect(page).toContain('\nExamples:\n  ken init ~/ken\n')
		expect(ken(['init', '--help'], away).stdout).toBe(page)
		expect(readdirSync(away)).toEqual([])
		expect(ken(['help', 'nope'], away).stderr).toContain(
			'nope is not a ken command, and no executable ken-nope was found'
		)
	})

	it('prints the version and the newest format it reads', () => {
		expect(ken(['version'], fresh()).stdout).toBe(
			`@unclex/ken-core ${VERSION}, reads ken.format 1 and older\n`
		)
	})

	it('looks for a name every object has as any other, never running the object’s', () => {
		for (const name of ['constructor', 'toString', '__proto__']) {
			for (const args of [[name], ['help', name]]) {
				const r = ken(args, fresh())
				expect(r.status).toBe(1)
				expect(r.stderr).toContain(`${name} is not a ken command`)
			}
		}
	})

	it('runs a command it does not have as an extension, saying where it looked when none', () => {
		const root = rootWith(KEN)
		const r = ken(['nope'], root)
		expect(r.status).toBe(1)
		expect(r.stderr).toContain(
			'ken: nope is not a ken command, and no executable ken-nope was found. Looked in, in order:\n  the core commands: init, path, which, get, repos, index, help, version\n'
		)
		expect(r.stderr).toContain('\n  the bundled commands: none\n')
		mkdirSync(join(root, '.bin'))
		writeFileSync(join(root, '.bin/ken-nope'), '#!/bin/sh\necho "nope of $KEN_ROOT"\n', {
			mode: 0o755
		})
		expect(ken(['nope'], root).stdout).toBe(`nope of ${root}\n`)
	})
})

const bun = spawnSync('bun', ['--version']).status === 0 ? 'bun' : undefined
if (!bun) console.warn('bun is not on PATH, so the smoke test under bun is skipped.')

describe.skipIf(!bun)('under bun', () => {
	it('runs init, then path root, in an empty folder', () => {
		const at = fresh()
		expect(ken(['init'], at, undefined, 'bun').status).toBe(0)
		expect(ken(['path', 'root'], at, undefined, 'bun').stdout).toBe(`${at}\n`)
	})
})
