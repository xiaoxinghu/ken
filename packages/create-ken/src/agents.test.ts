import { execFileSync, spawnSync } from 'node:child_process'
import {
	existsSync,
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

/** A bare repo with one commit, reached by its key through url.insteadOf. */
function remote(key: string) {
	const work = join(dir, 'work', key)
	mkdirSync(work, { recursive: true })
	writeFileSync(join(work, 'README.md'), `# ${key}\n`)
	const git = (...args: string[]) => execFileSync('git', args, { cwd: work, env, stdio: 'ignore' })
	git('init', '-q', '-b', 'main')
	git('add', '-A')
	git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'x')
	git('clone', '-q', '--bare', work, join(dir, 'remotes', `${key}.git`))
}

const run = (command: string, stdin = '') =>
	spawnSync('sh', ['-c', command], { cwd: root, env, input: stdin, encoding: 'utf8' })
const clone = (repo: string) => join(root, '.repos/example.com/acme', repo)

beforeEach(() => {
	dir = realpathSync.native(mkdtempSync(join(tmpdir(), 'create-ken-agents-')))
	root = join(dir, 'ken')
	// the hooks run `ken` from PATH: this one, with no ken-task beside it
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
		PATH: [bin, dirname(process.execPath), dirname(git), '/usr/bin', '/bin'].join(':'),
		GIT_CONFIG_COUNT: '1',
		GIT_CONFIG_KEY_0: `url.file://${dir}/remotes/.insteadOf`,
		GIT_CONFIG_VALUE_0: 'https://'
	}
	const r = spawnSync(
		process.execPath,
		[join(import.meta.dirname, 'cli.ts'), root, '--template', 'agents'],
		{ env, encoding: 'utf8' }
	)
	expect(r.stderr).toBe('')
	expect(r.status).toBe(0)
	for (const repo of ['web', 'api', 'docs']) {
		remote(`example.com/acme/${repo}`)
		expect(run(`ken index set example.com/acme/${repo} desc="The ${repo}."`).status).toBe(0)
	}
})

const read = (file: string) => JSON.parse(readFileSync(join(root, file), 'utf8'))

describe('the agents template', () => {
	it('gives Claude Code and Codex one hooks object, and links what npm cannot publish', () => {
		// a settings file carries other keys, so it holds a copy, which must not drift
		expect(read('.claude/settings.json').hooks).toEqual(read('.agents/hooks.json').hooks)
		expect(readlinkSync(join(root, '.codex/hooks.json'))).toBe('../.agents/hooks.json')
		expect(read('.codex/hooks.json')).toEqual(read('.agents/hooks.json'))
		expect(readlinkSync(join(root, 'CLAUDE.md'))).toBe('AGENTS.md')
		for (const script of ['ken-status', 'ken-ensure']) {
			expect(statSync(join(root, '.bin', script)).mode & 0o111).toBe(0o111)
		}
		// the template's ignores, and ken init's added to them
		const ignore = readFileSync(join(root, '.gitignore'), 'utf8').split('\n')
		expect(ignore).toEqual(expect.arrayContaining(['CLAUDE.local.md', 'node_modules', '.env']))
		expect(readFileSync(join(root, 'AGENTS.md'), 'utf8').split('\n').length).toBeLessThan(41)
	})

	it('ken ensure clones a listed repo a tool is about to read, and touches nothing else', () => {
		const hook = (tool_name: string, tool_input: object) =>
			run(
				'ken ensure',
				JSON.stringify({ hook_event_name: 'PreToolUse', cwd: root, tool_name, tool_input })
			)

		const outside = hook('Read', { file_path: join(root, 'notes/x.md') })
		expect(outside.status).toBe(0)
		expect(outside.stdout + outside.stderr).toBe('')
		expect(hook('Grep', { pattern: 'x', path: join(root, '.repos') }).status).toBe(0)
		expect(existsSync(clone('web')) || existsSync(clone('api'))).toBe(false)

		const read = hook('Read', { file_path: join(root, '.repos/example.com/acme/web/README.md') })
		expect(read.status).toBe(0)
		expect(readFileSync(join(clone('web'), 'README.md'), 'utf8')).toBe('# example.com/acme/web\n')
		expect(existsSync(clone('api'))).toBe(false)

		// a glob that names the repo in its pattern alone, with no path
		const glob = hook('Glob', { pattern: '.repos/example.com/acme/docs/**/*.md' })
		expect(glob.status).toBe(0)
		expect(existsSync(join(clone('docs'), 'README.md'))).toBe(true)

		// a shell command's words, relative to the cwd
		const bash = hook('Bash', { command: "rg -n 'x' .repos/example.com/acme/api/src | head" })
		expect(bash.status).toBe(0)
		expect(existsSync(join(clone('api'), 'README.md'))).toBe(true)

		// garbage in is no reason to block a tool
		expect(run('ken ensure', 'not json').status).toBe(0)
	})

	it('ken status lists the repos and layers, without ken-task', () => {
		expect(run('command -v ken-task').status).not.toBe(0)
		const r = run('ken status')
		expect(r.status).toBe(0)
		expect(r.stdout).toContain('example.com/acme/web')
		expect(r.stdout).toContain('layers:')
	})

	it('the pi shim runs the same hooks on pi events, and blocks on exit 2', async () => {
		// a hook that blocks, beside the template's own
		const hooks = read('.agents/hooks.json')
		hooks.hooks.PreToolUse.push({
			matcher: 'Write',
			hooks: [{ type: 'command', command: 'echo "not here" >&2; exit 2' }]
		})
		writeFileSync(join(root, '.agents/hooks.json'), JSON.stringify(hooks))

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

			const path = '.repos/example.com/acme/web/README.md'
			expect(await handlers.tool_call?.({ toolName: 'read', input: { path } }, ctx)).toBeUndefined()
			expect(existsSync(join(clone('web'), 'README.md'))).toBe(true)
			expect(await handlers.tool_call?.({ toolName: 'write', input: { path } }, ctx)).toEqual({
				block: true,
				reason: 'not here'
			})
		} finally {
			process.env = saved
		}
	})
})
