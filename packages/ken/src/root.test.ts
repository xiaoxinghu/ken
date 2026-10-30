import { mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { configPath, findRoot } from './root.ts'

let dir: string
let env: NodeJS.ProcessEnv

beforeEach(() => {
	dir = realpathSync.native(mkdtempSync(join(tmpdir(), 'ken-root-')))
	for (const d of ['home/ken', 'env', 'file']) mkdirSync(join(dir, d), { recursive: true })
	env = { HOME: join(dir, 'home'), XDG_CONFIG_HOME: join(dir, 'config') }
})

const write = (text: string) => {
	mkdirSync(join(dir, 'config', 'ken'), { recursive: true })
	writeFileSync(configPath(env), text)
}

describe('findRoot', () => {
	it('takes KEN_ROOT over the config file, the file over ~/ken', () => {
		expect(findRoot(env)).toBe(join(dir, 'home/ken'))
		write(JSON.stringify({ root: join(dir, 'file') }))
		expect(findRoot(env)).toBe(join(dir, 'file'))
		expect(findRoot({ ...env, KEN_ROOT: join(dir, 'env') })).toBe(join(dir, 'env'))
	})

	it('reads the config file under ~/.config without XDG_CONFIG_HOME', () => {
		mkdirSync(join(dir, 'home/.config/ken'), { recursive: true })
		writeFileSync(join(dir, 'home/.config/ken/config.json'), '{"root": "~/ken"}')
		expect(findRoot({ HOME: env.HOME })).toBe(join(dir, 'home/ken'))
	})

	it('expands ~ in the config file', () => {
		mkdirSync(join(dir, 'home/notes'))
		write('{"root": "~/notes"}')
		expect(findRoot(env)).toBe(join(dir, 'home/notes'))
	})

	it('resolves a root reached through a symlink to its real path', () => {
		symlinkSync(join(dir, 'env'), join(dir, 'link'))
		expect(findRoot({ ...env, KEN_ROOT: join(dir, 'link') })).toBe(join(dir, 'env'))
	})

	it('resolves a root spelled in another case to its real path, on a case-insensitive disk', (ctx) => {
		mkdirSync(join(dir, 'MyRoot'))
		const other = join(dir, 'myroot')
		try {
			realpathSync(other)
		} catch {
			ctx.skip() // a case-sensitive disk: there it is another folder
		}
		expect(findRoot({ ...env, KEN_ROOT: other })).toBe(join(dir, 'MyRoot'))
	})

	it('names a missing root, where it came from, and how to make one', () => {
		const missing = join(dir, 'nope')
		expect(() => findRoot({ ...env, KEN_ROOT: missing })).toThrow(
			`the ken root ${missing} (from KEN_ROOT) does not exist`
		)
		expect(() => findRoot({ ...env, KEN_ROOT: missing })).toThrow(`npm create ken ${missing}`)
		write(JSON.stringify({ root: missing }))
		expect(() => findRoot(env)).toThrow(`(from "root" in ${configPath(env)})`)
	})

	it('refuses a root that is a file, which no checkout can live under', () => {
		writeFileSync(join(dir, 'file.txt'), '')
		expect(() => findRoot({ ...env, KEN_ROOT: join(dir, 'file.txt') })).toThrow(
			`the ken root ${join(dir, 'file.txt')} (from KEN_ROOT) is not a folder`
		)
	})

	it.each([
		['not JSON', '{root:', 'is not valid JSON'],
		['not an object', '["~/ken"]', 'must be a JSON object'],
		['null', 'null', 'must be a JSON object'],
		['a root that is no path', '{"root": 1}', 'must be a JSON object'],
		['an empty root', '{"root": ""}', 'must be a JSON object']
	])('refuses a config file holding %s, naming it', (_, text, message) => {
		write(text)
		expect(() => findRoot(env)).toThrow(`${configPath(env)} ${message}`)
	})
})
