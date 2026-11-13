// ken as a user runs it, the core with its bundled commands: dispatch to ken-<name>, in a child
// process, against temp roots, with a PATH on which no ken is installed.
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const CLI = join(import.meta.dirname, 'cli.ts')
const VERSION = JSON.parse(
	readFileSync(join(import.meta.dirname, '../package.json'), 'utf8')
).version
/** What ken-<name> run by the tests need, sh and cat; no ken and no ken-<name> is there. */
const BASE = '/usr/bin:/bin'
const dir = realpathSync.native(mkdtempSync(join(tmpdir(), 'ken-')))
let n = 0
const fresh = () => {
	const at = join(dir, `t${++n}`)
	mkdirSync(at)
	return at
}

type Run = { root?: string; path?: string; input?: string; runtime?: string }
/** `ken <args>` run from `cwd`, KEN_ROOT unset unless `root` is given, PATH `path` then BASE. */
const ken = (args: string[], cwd: string, { root, path, input, runtime }: Run = {}) => {
	const env: NodeJS.ProcessEnv = { ...process.env, PATH: path ? `${path}:${BASE}` : BASE }
	delete env.KEN_ROOT
	if (root !== undefined) env.KEN_ROOT = root
	const r = spawnSync(runtime ?? process.execPath, [CLI, ...args], {
		cwd,
		env,
		input,
		encoding: 'utf8'
	})
	return { status: r.status, stdout: r.stdout, stderr: r.stderr }
}

/** A new root, made by `ken init`. */
const newRoot = () => {
	const at = fresh()
	expect(ken(['init'], at).status).toBe(0)
	return at
}

/** `dir/ken-<name>`, an sh script running `body`, executable unless `plain`. */
const script = (dir: string, name: string, body: string, plain = false) => {
	mkdirSync(dir, { recursive: true })
	const file = join(dir, `ken-${name}`)
	writeFileSync(file, `#!/bin/sh\n${body}\n`, { mode: plain ? 0o644 : 0o755 })
	return file
}

describe('dispatch', () => {
	it("runs a ken-<name> from the root's .bin/, which calls ken back, and help lists it", () => {
		const root = newRoot()
		script(
			join(root, '.bin'),
			'hello',
			'printf "hello, KEN_ROOT=%s, root %s, args:" "$KEN_ROOT" "$(ken path root)"; printf " %s|" "$@"'
		)
		mkdirSync(join(root, 'notes'))
		const r = ken(['hello', 'a b', '--help', ''], join(root, 'notes'))
		expect(r.stderr).toBe('')
		expect(r.stdout).toBe(`hello, KEN_ROOT=${root}, root ${root}, args: a b| --help| |`)
		expect(r.status).toBe(0)
		expect(ken(['help'], root).stdout).toContain(`\n  the root's .bin/, ${root}/.bin\n    hello\n`)
	})

	it('passes stdin through and returns the exit status as its own', () => {
		const root = newRoot()
		script(join(root, '.bin'), 'echo', 'cat; exit 7')
		const r = ken(['echo'], root, { input: 'from stdin\n' })
		expect(r.stdout).toBe('from stdin\n')
		expect(r.status).toBe(7)
		expect(ken(['lint', 'x'], root).status).toBe(1)
	})

	it("looks in the core, the root's .bin/, the bundled, then PATH, the first winning", () => {
		const root = newRoot()
		const path = fresh()
		script(path, 'lint', 'echo lint from PATH')
		script(path, 'onpath', 'echo onpath from PATH, KEN_ROOT=$KEN_ROOT')
		script(join(root, '.bin'), 'path', 'echo path from .bin')

		expect(ken(['path', 'root'], root, { path }).stdout).toBe(`${root}\n`)
		expect(ken(['onpath'], root, { path }).stdout).toBe(`onpath from PATH, KEN_ROOT=${root}\n`)
		expect(ken(['lint'], root, { path }).stdout).toBe('ken lint: no errors in 0 pages.\n')
		let help = ken(['help'], root, { path }).stdout
		expect(help).toContain(`  the root's .bin/, ${root}/.bin\n    path, shadowed by the core`)
		expect(help).toContain('\n  bundled\n    lint\n    task\n')
		expect(help).toContain(`\n  PATH, ${path}\n    lint, shadowed by the bundled one\n    onpath\n`)

		script(join(root, '.bin'), 'lint', 'echo lint from .bin')
		expect(ken(['lint'], root, { path }).stdout).toBe('lint from .bin\n')
		help = ken(['help'], root, { path }).stdout
		expect(help).toContain(`\n  bundled\n    lint, shadowed by ${root}/.bin/ken-lint\n    task\n`)
	})

	it('outside any root, runs a bundled or PATH command with KEN_ROOT unset, skipping .bin/', () => {
		const away = fresh()
		const path = fresh()
		script(path, 'onpath', 'env | grep ^KEN_ROOT= || echo KEN_ROOT=unset')
		expect(ken(['onpath'], away, { path }).stdout).toBe('KEN_ROOT=unset\n')
		expect(ken(['lint'], away).stderr).toContain('ken-lint: KEN_ROOT is not set')
	})

	it('runs `ken help <name>` as the extension’s own --help', () => {
		expect(ken(['help', 'lint'], fresh()).stdout).toContain('ken lint\n\nCheck the knowledge base')
	})

	it('says where it looked, in order, and what to add, when nothing is found', () => {
		const root = newRoot()
		const path = fresh()
		script(path, 'nope', 'echo never', true)
		const r = ken(['nope'], root, { path })
		expect(r.status).toBe(1)
		expect(r.stderr).toBe(
			`ken: nope is not a ken command, and no executable ken-nope was found. Looked in, in order:
  the core commands: init, path, which, get, repos, index, help, version
  ${root}/.bin, the root's .bin/
  the bundled commands: task, lint
  PATH, each folder in order, as \`echo "$PATH"\` prints them
Add an executable ken-nope to ${root}/.bin, or run \`ken help\` for every command found.\n`
		)
		const outside = ken(['nope'], fresh()).stderr
		expect(outside).toContain("\n  the root's .bin/: skipped, as there is no root here\n")
		expect(outside).toContain('Add an executable ken-nope to the .bin/ of a root, and run ken')
		expect(ken(['a/b'], root).stderr).toContain("a/b is not a ken command: a command's name is")
	})

	it("names a ken-<name> in the root's .bin/ that is not executable, with the chmod, in help too", () => {
		const root = newRoot()
		const file = script(join(root, '.bin'), 'plain', 'echo never', true)
		const r = ken(['plain'], root)
		expect(r.status).toBe(1)
		expect(r.stderr).toBe(
			`ken: ${file} would run as \`ken plain\`, but it is not executable. Run \`chmod +x ${file}\`, then \`ken plain\` again.\n`
		)

		const lint = script(join(root, '.bin'), 'lint', 'echo never', true)
		expect(ken(['lint'], root).stderr).toContain(`ken: ${lint} would run as`)
		const help = ken(['help'], root).stdout
		expect(help).toContain(`\n    plain, not executable: run \`chmod +x ${file}\`\n`)
		expect(help).toContain(`\n  bundled\n    lint, shadowed by ${lint}\n    task\n`)
	})

	it('says it is this package, in version', () => {
		expect(ken(['version'], fresh()).stdout).toBe(
			`@unclex/ken ${VERSION}, reads ken.format 1 and older\n`
		)
	})
})

const bun = spawnSync('sh', ['-c', 'command -v bun'], { encoding: 'utf8' }).stdout.trim()
if (!bun) console.warn('bun is not on PATH, so the dispatch tests under bun are skipped.')

describe.skipIf(!bun)('under bun', () => {
	it("runs a root's ken-<name>, whose ken and bundled command are run by bun too", () => {
		const root = newRoot()
		// no node is on PATH, so the bundled lint runs only under the runtime that runs ken
		script(join(root, '.bin'), 'hello', 'ken path root; ken lint')
		const r = ken(['hello'], root, { runtime: bun })
		expect(r.stdout).toBe(`${root}\nken lint: no errors in 0 pages.\n`)
		expect(r.status).toBe(0)
	})
})
