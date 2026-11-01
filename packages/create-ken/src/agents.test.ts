import { execFileSync, spawnSync } from 'node:child_process'
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readlinkSync,
	realpathSync,
	statSync,
	writeFileSync
} from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const pkg = require.resolve('@unclex/ken/package.json')
const KEN = join(dirname(pkg), require(pkg).bin.ken)

let dir: string
let root: string
let env: NodeJS.ProcessEnv

const run = (command: string, stdin = '') =>
	spawnSync('sh', ['-c', command], { cwd: root, env, input: stdin, encoding: 'utf8' })

beforeEach(() => {
	dir = realpathSync.native(mkdtempSync(join(tmpdir(), 'create-ken-agents-')))
	// a space in the root, which the hooks' shell must not split
	root = join(dir, 'my ken')
	// the hook runs `ken` from PATH: this one, with no ken-task beside it
	const bin = join(dir, 'bin')
	mkdirSync(bin)
	writeFileSync(join(bin, 'ken'), `#!/bin/sh\nexec ${process.execPath} ${KEN} "$@"\n`, {
		mode: 0o755
	})
	const git = execFileSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim()
	env = {
		HOME: join(dir, 'home'),
		XDG_CONFIG_HOME: join(dir, 'config'),
		KEN_ROOT: root,
		PATH: [bin, dirname(process.execPath), dirname(git), '/usr/bin', '/bin'].join(':')
	}
	const r = spawnSync(
		process.execPath,
		[join(import.meta.dirname, 'cli.ts'), root, '--template', 'agents'],
		{ env, encoding: 'utf8' }
	)
	expect(r.stderr).toBe('')
	expect(r.status).toBe(0)
	expect(run('ken index set example.com/acme/web desc="The web."').status).toBe(0)
	// each ken call is a node process: slow under a full parallel run
}, 30_000)

const read = (file: string) => JSON.parse(readFileSync(join(root, file), 'utf8'))

describe('the agents template', { timeout: 30_000 }, () => {
	it('gives Claude Code and Codex one hooks object, and links what npm cannot publish', () => {
		// a settings file carries other keys, so it holds a copy, which must not drift
		expect(read('.claude/settings.json').hooks).toEqual(read('.agents/hooks.json').hooks)
		expect(readlinkSync(join(root, '.codex/hooks.json'))).toBe('../.agents/hooks.json')
		expect(read('.codex/hooks.json')).toEqual(read('.agents/hooks.json'))
		expect(readlinkSync(join(root, 'CLAUDE.md'))).toBe('AGENTS.md')
		expect(statSync(join(root, '.bin/ken-status')).mode & 0o111).toBe(0o111)
		// the template's ignores, and ken init's added to them
		const ignore = readFileSync(join(root, '.gitignore'), 'utf8').split('\n')
		expect(ignore).toEqual(expect.arrayContaining(['CLAUDE.local.md', 'node_modules', '.env']))
		expect(readFileSync(join(root, 'AGENTS.md'), 'utf8').split('\n').length).toBeLessThan(41)
	})

	it('ken status lists the repos and layers, without ken-task', () => {
		expect(run('command -v ken-task').status).not.toBe(0)
		const r = run('ken status')
		expect(r.status).toBe(0)
		expect(r.stdout).toContain('example.com/acme/web')
		expect(r.stdout).toContain('layers:')
	})

	it('the pi shim sends the session-start hook output with the first prompt only', async () => {
		const handlers: Record<string, (event: unknown, ctx: { cwd: string }) => unknown> = {}
		const { default: shim } = await import(join(root, '.pi/extensions/ken-hooks.ts'))
		shim({ on: (event: string, handler: (typeof handlers)[string]) => (handlers[event] = handler) })
		const saved = { ...process.env }
		Object.assign(process.env, env)
		try {
			const ctx = { cwd: root }
			await handlers.session_start?.({ reason: 'startup' }, ctx)
			const start = (await handlers.before_agent_start?.({}, ctx)) as {
				message: { content: string }
			}
			expect(start.message.content).toContain('example.com/acme/web')
			// the status reaches the model once, not with every prompt
			expect(await handlers.before_agent_start?.({}, ctx)).toBeUndefined()
		} finally {
			process.env = saved
		}
	})
})
