import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'

let root: string
let link: string
let onPath: string
let layerBin: string

const script = (file: string, body: string, mode = 0o755) =>
	writeFileSync(file, `#!/bin/sh\n${body}\n`, { mode })

// a root with one layer, reached through a symlink so KEN_ROOT given is not the real path, and
// a folder on PATH
beforeAll(() => {
	const dir = realpathSync.native(mkdtempSync(join(tmpdir(), 'ken-ext-')))
	root = join(dir, 'ken')
	link = join(dir, 'link')
	onPath = join(dir, 'path-bin')
	layerBin = join(root, '.repos/github.com/acme/atlas/.bin')
	mkdirSync(join(root, '.bin'), { recursive: true })
	mkdirSync(layerBin, { recursive: true })
	mkdirSync(onPath)
	symlinkSync(root, link)
	writeFileSync(
		join(root, '.ken.yaml'),
		'layers:\n  - name: atlas\n    key: github.com/acme/atlas\n'
	)
	script(join(root, '.bin/ken-hello'), 'printf "%s|" "$KEN_ROOT" "$@"')
	script(join(root, '.bin/ken-both'), 'echo root')
	script(join(layerBin, 'ken-both'), 'echo layer')
	script(join(layerBin, 'ken-team'), 'echo team')
	script(join(onPath, 'ken-far'), 'echo far')
	script(join(onPath, '../ken-here'), 'echo here')
	script(join(root, '.bin/ken-path'), 'echo shadowed')
	script(join(root, '.bin/ken-fail'), 'exit 3')
	script(join(root, '.bin/ken-killed'), 'kill -TERM $$')
	script(join(root, '.bin/ken-plain'), 'echo plain', 0o644)
})

const ken = (...args: string[]) => {
	const r = spawnSync(process.execPath, [join(import.meta.dirname, 'cli.ts'), ...args], {
		encoding: 'utf8',
		env: { ...process.env, KEN_ROOT: link, PATH: `${onPath}:${process.env.PATH}` }
	})
	return { status: r.status, stdout: r.stdout, stderr: r.stderr }
}

describe('ken <name>', () => {
	it("runs the root's ken-<name> with the arguments as given and KEN_ROOT the real root", () => {
		expect(ken('hello', 'a b', '--help')).toEqual({
			status: 0,
			stdout: `${root}|a b|--help|`,
			stderr: ''
		})
	})

	it("runs a layer's, and the root's wins over a layer's of the same name", () => {
		expect(ken('team').stdout).toBe('team\n')
		expect(ken('both').stdout).toBe('root\n')
	})

	it('runs one found only on PATH', () => {
		expect(ken('far').stdout).toBe('far\n')
	})

	it('takes an empty PATH entry as the current directory, as a shell does', () => {
		const r = spawnSync(process.execPath, [join(import.meta.dirname, 'cli.ts'), 'here'], {
			cwd: join(onPath, '..'),
			encoding: 'utf8',
			env: { ...process.env, KEN_ROOT: link, PATH: `:${process.env.PATH}` }
		})
		expect(r.stdout).toBe('here\n')
	})

	it('never lets a ken-<builtin> shadow the builtin', () => {
		expect(ken('path', 'root')).toEqual({ status: 0, stdout: `${root}\n`, stderr: '' })
	})

	it("exits with the child's code, 128 + the signal number when it was killed", () => {
		expect(ken('fail').status).toBe(3)
		expect(ken('killed').status).toBe(128 + 15)
	})

	it('says where it looked, in order, and points at ken help when nothing is found', () => {
		const r = ken('frobnicate')
		expect(r.status).toBe(1)
		expect(r.stderr).toContain('"frobnicate" is not a ken command')
		const order = [join(root, '.bin'), layerBin, onPath].map((dir) =>
			r.stderr.indexOf(`  ${dir}  (`)
		)
		expect(order.every((at, i) => at > (order[i - 1] ?? 0))).toBe(true)
		expect(r.stderr).toContain('Run `ken help`')
	})

	it('names a ken-<name> that is not executable and gives the chmod to run', () => {
		const r = ken('plain')
		expect(r.status).toBe(1)
		expect(r.stderr).toContain(`Run \`chmod +x ${join(root, '.bin/ken-plain')}\``)
	})
})

describe('ken help', () => {
	it('lists the external commands that would run, by where they were found', () => {
		const out = ken('help').stdout
		expect(out).toContain(`  the root, ${join(root, '.bin')}: both, fail, hello, killed\n`)
		expect(out).toContain(`  layer atlas, ${layerBin}: team\n`)
		expect(out).toContain(`  PATH, ${onPath}: far\n`)
	})
})
