// The templates, templates/<name>/ (docs/templates.md): each holds the rules a root starts
// from, and installs the way the workflow publishes its branch, with no ken on PATH.
import { spawnSync } from 'node:child_process'
import {
	copyFileSync,
	cpSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	readlinkSync,
	realpathSync,
	rmSync,
	symlinkSync,
	writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'

const REPO = join(import.meta.dirname, '..')
const KEN = join(REPO, 'ken')
const TEMPLATES = join(REPO, 'templates')
const NAMES = readdirSync(TEMPLATES)
// no ken on PATH, no ~/ken: the root must be found and run through its own .bin/ken
const BARE = { PATH: '/usr/bin:/bin', HOME: '' }

let dir: string

// The template as the branch template/<name> holds it: the folder, with .bin/ken a copy of
// the kernel in place of the link, made a git repo.
const install = (name: string, as = name) => {
	const at = join(dir, as)
	cpSync(join(TEMPLATES, name), at, { recursive: true, verbatimSymlinks: true })
	rmSync(join(at, '.bin/ken'))
	copyFileSync(KEN, join(at, '.bin/ken'))
	spawnSync('git', ['init', '-q', '-b', 'main'], { cwd: at })
	return at
}
const sh = (cwd: string, env: Record<string, string>, ...args: string[]) => {
	const r = spawnSync('sh', args, { cwd, encoding: 'utf8', env: { ...BARE, ...env, HOME: dir } })
	return { status: r.status, stdout: r.stdout, stderr: r.stderr }
}

beforeAll(() => {
	dir = realpathSync.native(mkdtempSync(join(tmpdir(), 'ken-templates-')))
})

it('there is the one template docs/templates.md describes', () => {
	expect(NAMES).toEqual(['agents'])
})

describe.each(NAMES)('template %s', (name) => {
	const at = join(TEMPLATES, name)
	const read = (file: string) => readFileSync(join(at, file), 'utf8')

	it('holds what ken init makes, .bin/ken a link to the kernel the workflow copies in', () => {
		expect(readlinkSync(join(at, '.bin/ken'))).toBe('../../../ken')
		expect(read('.ken')).toContain(`\ntemplate.name=${name}\n`)
		expect(read('.repos')).toMatch(/^# \.repos:/)
		expect(read('.gitignore').split('\n')).toContain('.env')
	})

	it('has a front page, and an AGENTS.md under 40 lines that says where the CLI is', () => {
		expect(read('README.md')).toContain('\n## Layers\n')
		expect(readlinkSync(join(at, 'CLAUDE.md'))).toBe('AGENTS.md')
		const agents = read('AGENTS.md')
		expect(agents.match(/\n/g)?.length).toBeLessThan(40) // lines as wc -l and ken lint count them
		expect(agents).toContain('`.bin/ken`')
		expect(agents).toContain('`ken help`')
	})

	it('installed, is a root already: init adds nothing, and ken runs from .bin with no PATH', () => {
		const root = install(name)
		const init = sh(root, {}, '.bin/ken', 'init')
		expect(init.status).toBe(0)
		expect(init.stdout).toContain('is a root already with every file ken owns: nothing was created')
		expect(sh(root, {}, '.bin/ken', 'path', 'root').stdout).toBe(`${root}\n`)
	})
})

describe('the agents template', () => {
	const at = join(TEMPLATES, 'agents')

	it('keeps one hooks object, copied into Claude Code settings and linked for Codex', () => {
		const hooks = JSON.parse(readFileSync(join(at, '.agents/hooks.json'), 'utf8'))
		const settings = JSON.parse(readFileSync(join(at, '.claude/settings.json'), 'utf8'))
		expect(settings).toEqual({ hooks: hooks.hooks })
		// biome-ignore lint/suspicious/noTemplateCurlyInString: the hook line is shell, run by sh -c
		expect(hooks.hooks.SessionStart[0].hooks[0].command).toBe('"${KEN_ROOT:-.}/.bin/ken" status')
		expect(readlinkSync(join(at, '.codex/hooks.json'))).toBe('../.agents/hooks.json')
	})

	it("the hook runs the root's ken status from a checkout once KEN_ROOT is set, and from the root without", () => {
		// a root path with a space is one word in the hook
		const root = install('agents', 'hooked root')
		const hook = JSON.parse(readFileSync(join(at, '.agents/hooks.json'), 'utf8')).hooks
			.SessionStart[0].hooks[0].command
		const checkout = join(dir, 'src/example.com/acme/app')
		mkdirSync(checkout, { recursive: true })
		expect(sh(checkout, { KEN_ROOT: root }, '-c', hook).stdout).toContain(
			`This is a ken root: ${root}.`
		)
		expect(sh(root, {}, '-c', hook).stdout).toContain(`This is a ken root: ${root}.`)
	})

	it('.bin/ken status: a screen naming the CLI, exit 0, and ken on PATH through CLAUDE_ENV_FILE', () => {
		const root = install('agents', 'status')
		const envFile = join(dir, 'env.sh')
		writeFileSync(envFile, '')
		const r = sh(root, { CLAUDE_ENV_FILE: envFile }, '.bin/ken', 'status')
		expect(r.status).toBe(0)
		expect(r.stdout).toContain(`This is a ken root: ${root}.`)
		expect(r.stdout).toContain('`ken help`')
		expect(r.stdout).toContain('nothing to list')
		expect(r.stdout).toContain('  template.name=agents\n')
		// sourced before each shell command, it makes `ken` this root's kernel, acting on this root
		// from a folder with no .ken above it, as a checkout is
		const sourced = sh(dir, {}, '-c', `. ${envFile} && command -v ken && ken path root`)
		expect(sourced.stdout).toBe(`${root}/.bin/ken\n${root}\n`)
		const ken = sh(dir, {}, '-c', `. ${envFile} && echo "$KEN_ROOT" && ${KEN} path root`)
		expect(ken.stdout).toBe(`${root}\n${root}\n`)
	})

	it('.bin/ken status with no CLAUDE_ENV_FILE writes no file and still exits 0', () => {
		const root = install('agents', 'plain')
		mkdirSync(join(root, 'nowhere'))
		const r = sh(join(root, 'nowhere'), {}, '../.bin/ken', 'status')
		expect(r.status).toBe(0)
		expect(r.stdout).toContain(`This is a ken root: ${root}.`)
		expect(r.stdout).not.toContain('log.md')
	})

	describe('ken log', () => {
		let root: string
		beforeAll(() => {
			root = install('agents', 'log')
			mkdirSync(join(root, 'flow/deep'), { recursive: true })
		})
		const log = (...args: string[]) =>
			sh(join(root, 'flow/deep'), {}, '../../.bin/ken', 'log', ...args)
		const lines = () => readFileSync(join(root, 'log.md'), 'utf8').split('\n').slice(0, -1)

		it('from a subfolder, creates the root log.md with one line: local time and offset, kind, subject, what', () => {
			for (const shell of ['sh', 'dash']) {
				const r = spawnSync(
					shell,
					['../../.bin/ken', 'log', 'query', 'flow/README.md', 'answered', 'X'],
					{
						cwd: join(root, 'flow/deep'),
						encoding: 'utf8',
						env: { ...BARE, HOME: dir }
					}
				)
				expect(r.status).toBe(0)
				expect(r.stdout + r.stderr).toBe('')
			}
			expect(lines()).toHaveLength(2)
			for (const line of lines()) {
				expect(line).toMatch(
					/^\d{4}-\d\d-\d\dT\d\d:\d\d[+-]\d{4} query flow\/README\.md: answered X$/
				)
			}
		})

		it.each([
			[['nope', 'a', 'b'], "'nope' is not a kind"],
			[['ingest query', 'a', 'b'], "'ingest query' is not a kind"],
			[['page', 'a b', 'c'], "'a b' is not one word"],
			[['page', 'a', 'one\ntwo'], 'spans lines'],
			[['page', 'a', ' '], 'is empty'],
			[['page', 'a'], 'are needed']
		])('refuses %j, naming the rule and the kinds, and writes nothing', (args, rule) => {
			const before = lines().length
			const r = log(...args)
			expect(r.status).toBe(2)
			expect(r.stderr).toContain(rule)
			expect(r.stderr).toContain('ingest query page task promote layer')
			expect(lines()).toHaveLength(before)
		})

		it('ken status ends with the last 10 lines in time order and the current time', () => {
			const entries = Array.from(
				{ length: 12 },
				(_, i) => `2026-01-${String(i + 1).padStart(2, '0')}T09:00+1300 page p${i}.md: x`
			)
			// a union merge appends the other side after this one's: out of order
			writeFileSync(
				join(root, 'log.md'),
				`${[...entries.slice(6), ...entries.slice(0, 6)].join('\n')}\n`
			)
			const r = sh(root, {}, '.bin/ken', 'status')
			expect(r.status).toBe(0)
			expect(r.stdout).toMatch(/Recent, log\.md \(now \d{4}-\d\d-\d\dT\d\d:\d\d[+-]\d{4}\)/)
			expect(r.stdout.endsWith(`:\n${entries.slice(2).join('\n')}\n`)).toBe(true)
		})

		it('two branches that each append merge without a conflict, keeping both lines', () => {
			const git = (...args: string[]) =>
				spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], {
					cwd: root,
					encoding: 'utf8',
					env: { ...BARE, HOME: dir }
				})
			git('add', '-A')
			git('commit', '-qm', 'root')
			git('checkout', '-qb', 'other')
			log('task', 'tasks/b.md', 'added')
			git('commit', '-qam', 'b')
			git('checkout', '-q', 'main')
			log('task', 'tasks/a.md', 'added')
			git('commit', '-qam', 'a')
			const merge = git('merge', '-q', '-m', 'merge', 'other')
			expect(merge.status).toBe(0)
			const text = readFileSync(join(root, 'log.md'), 'utf8')
			expect(text).toContain('task tasks/a.md: added\n')
			expect(text).toContain('task tasks/b.md: added\n')
			expect(text).not.toContain('<<<<<<<')
		})
	})
})

// A Claude Code transcript, one JSON value per line, with every kind of entry a digest keeps or
// drops: the secret sits only where a digest never looks. A reply is several entries, one per
// content block, sharing message.id.
const SECRET = 'sk-SECRET'
const at = (s: number) => `2026-11-06T01:00:${String(s).padStart(2, '0')}.123Z`
const user = (s: number, content: unknown, extra = {}) => ({
	type: 'user',
	message: { role: 'user', content },
	timestamp: at(s),
	sessionId: 'abc-123',
	cwd: '/w',
	...extra
})
const claude = (s: number, id: string, ...content: unknown[]) => ({
	type: 'assistant',
	message: { id, role: 'assistant', content },
	timestamp: at(s),
	sessionId: 'abc-123'
})
const bash = { command: `echo one\n${'x'.repeat(150)}`, description: 'd' }
const CLAUDE_CODE = [
	// the first entry may name no session
	{ type: 'file-history-snapshot', messageId: 'm', snapshot: { trackedFileBackups: {} } },
	{ type: 'permission-mode', permissionMode: 'default', sessionId: 'abc-123' },
	{
		type: 'attachment',
		attachment: { type: 'hook_success', content: SECRET },
		timestamp: at(0),
		sessionId: 'abc-123',
		cwd: '/w'
	},
	user(
		1,
		`<system-reminder>${SECRET}</system-reminder>Why is the "sky" blue?\nAnswer with C:\\path in é<system-reminder>${SECRET}</system-reminder>`
	),
	user(2, '<local-command-caveat>harness text</local-command-caveat>', { isMeta: true }),
	claude(3, 'm1', { type: 'thinking', thinking: `thought ${SECRET}` }),
	claude(4, 'm1', { type: 'text', text: 'Looking.' }),
	claude(5, 'm1', { type: 'tool_use', id: 't1', name: 'Bash', input: bash }),
	claude(6, 'm1', { type: 'tool_use', id: 't2', name: 'Read', input: { file_path: '/w/a.md' } }),
	claude(7, 'm1', {
		type: 'tool_use',
		id: 't3',
		name: 'WebFetch',
		input: { url: 'https://e.x', prompt: 'p' }
	}),
	user(8, [{ type: 'tool_result', tool_use_id: 't1', content: SECRET }], {
		toolUseResult: { stdout: SECRET }
	}),
	claude(9, 'm2', { type: 'text', text: 'Rayleigh scattering.' }),
	user(10, '<task-notification>done</task-notification>'),
	{
		type: 'system',
		subtype: 'compact_boundary',
		content: 'Conversation compacted',
		timestamp: at(11),
		sessionId: 'abc-123'
	},
	user(12, `summary ${SECRET}`, { isCompactSummary: true }),
	user(13, [
		{ type: 'image', source: { data: SECRET } },
		{ type: 'text', text: 'And this?' }
	]),
	claude(14, 'm3', { type: 'text', text: 'A cat.' }),
	// a failed response, with no time of its own
	{
		...claude(0, 'm4', { type: 'text', text: 'API Error: offline' }),
		timestamp: undefined,
		isApiErrorMessage: true,
		error: 'server_error'
	}
]
	.map((e) => JSON.stringify(e))
	.join('\n')
// The digest the ghost's mirror would write for it: the shape of
// justfiles:packages/ghost/mirror.ts#MirroredEntry, a tool input cut as its digest() cuts it.
const head = (input: unknown) => `${JSON.stringify(input).slice(0, 120)}…`
const ENTRIES = [
	{
		kind: 'session',
		session: 'abc-123',
		harness: 'claude-code',
		started: at(0),
		cwd: '/w'
	},
	{ id: 1, at: at(1), kind: 'user', text: 'Why is the "sky" blue?\nAnswer with C:\\path in é' },
	{
		id: 2,
		at: at(3),
		kind: 'assistant',
		text: 'Looking.',
		toolCalls: [
			{ id: 't1', name: 'Bash', input: head(bash) },
			{ id: 't2', name: 'Read', input: '{"file_path":"/w/a.md"}' },
			{ id: 't3', name: 'WebFetch', input: '{"url":"https://e.x","prompt":"p"}' }
		]
	},
	{ id: 3, at: at(9), kind: 'assistant', text: 'Rayleigh scattering.', toolCalls: [] },
	{ id: 4, at: at(11), kind: 'compaction', summary: '(compacted here)' },
	{ id: 5, at: at(13), kind: 'user', text: 'And this?' },
	{ id: 6, at: at(14), kind: 'assistant', text: 'A cat.', toolCalls: [] },
	{
		id: 7,
		at: at(14),
		kind: 'assistant',
		text: 'API Error: offline',
		toolCalls: [],
		error: 'server_error'
	}
]
const DIGEST = ENTRIES.map((e) => `${JSON.stringify(e)}\n`).join('')
const SHOWN = `Session abc-123, claude-code, started 2026-11-06 01:00, 7 entries, all shown.
2026-11-06
#1 01:00 user: Why is the "sky" blue?
Answer with C:\\path in é
#2 01:00 assistant: Looking.
#2 01:00 → Bash ${head(bash)}
#2 01:00 → Read {"file_path":"/w/a.md"}
#2 01:00 → WebFetch {"url":"https://e.x","prompt":"p"}
#3 01:00 assistant: Rayleigh scattering.
#4 01:00 compacted: (compacted here)
#5 01:00 user: And this?
#6 01:00 assistant: A cat.
#7 01:00 assistant: API Error: offline
#7 01:00 (failed: server_error)
`

describe('session digests', () => {
	let root: string
	let transcript: string
	let lintBin: string
	beforeAll(() => {
		root = install('agents', 'digests')
		mkdirSync(join(root, 'flow/deep'), { recursive: true })
		transcript = join(dir, 'abc-123.jsonl')
		// the last line is one the harness is still writing: not JSON, skipped
		writeFileSync(transcript, `${CLAUDE_CODE}\n{"type":"user","message":{"content":"half`)
		// ken-lint as a user installs it, beside node
		lintBin = join(dir, 'lint-bin')
		mkdirSync(lintBin)
		symlinkSync(join(REPO, 'packages/ken-lint/src/cli.ts'), join(lintBin, 'ken-lint'))
	})
	const session = { KEN_SESSION: 'abc-123', KEN_SESSION_TRANSCRIPT: '' }
	// times are local: UTC unless a test says otherwise
	const run = (env: Record<string, string>, ...args: string[]) =>
		sh(join(root, 'flow/deep'), { TZ: 'UTC', ...env }, '../../.bin/ken', ...args)
	const digest = () => readFileSync(join(root, '.sessions/abc-123.jsonl'), 'utf8')

	it("ken digest writes a header and the ghost's entries, a reply and its tool calls one, and nothing else, the same twice", () => {
		for (const shell of ['sh', 'dash']) {
			const r = spawnSync(shell, ['../../.bin/ken', 'digest', transcript], {
				cwd: join(root, 'flow/deep'),
				encoding: 'utf8',
				env: { ...BARE, HOME: dir }
			})
			expect(r.stdout + r.stderr).toBe('')
			expect(r.status).toBe(0)
			expect(digest()).toBe(DIGEST)
		}
		expect(digest()).not.toContain('SECRET')
		expect(digest()).not.toContain('harness text')
		expect(digest()).not.toContain('done')
	})

	it("ken digest <transcript> in another session writes the transcript's session, not that one", () => {
		const other = run({ KEN_SESSION: 'other', KEN_SESSION_TRANSCRIPT: '' }, 'digest', transcript)
		expect(other.status).toBe(0)
		expect(readdirSync(join(root, '.sessions'))).not.toContain('other.jsonl')
		expect(digest()).toBe(DIGEST)
	})

	it('ken log in a session writes the digest and ends the line with s=<id>; with none, logs as before', () => {
		rmSync(join(root, '.sessions'), { recursive: true, force: true })
		const r = run(
			{ ...session, KEN_SESSION_TRANSCRIPT: transcript },
			'log',
			'query',
			'flow/README.md',
			'answered',
			'X'
		)
		expect(r.stdout + r.stderr).toBe('')
		expect(digest()).toBe(DIGEST)
		expect(run({}, 'log', 'page', 'flow/a.md', 'added').status).toBe(0)
		const lines = readFileSync(join(root, 'log.md'), 'utf8').split('\n')
		expect(lines[0]).toMatch(/ query flow\/README\.md: answered X s=abc-123$/)
		expect(lines[1]).toMatch(/ page flow\/a\.md: added$/)
	})

	it('ken log with a transcript gone still logs, saying no digest was written', () => {
		const r = run(
			{ KEN_SESSION: 'gone', KEN_SESSION_TRANSCRIPT: join(dir, 'nope.jsonl') },
			'log',
			'page',
			'p.md',
			'x'
		)
		expect(r.status).toBe(0)
		expect(r.stderr).toContain('cannot be read, so no digest was written')
		expect(readFileSync(join(root, 'log.md'), 'utf8')).toMatch(/ page p\.md: x s=gone\n$/)
	})

	it('ken session prints the entries from any folder in local time; a bad id or range is refused', () => {
		expect(run({}, 'session', 'abc-123').stdout).toBe(SHOWN)
		const nz = run({ TZ: 'NZDT-13' }, 'session', 'abc-123').stdout
		expect(nz).toContain('started 2026-11-06 14:00')
		expect(nz).toContain('#1 14:00 user:')
		const missing = run({}, 'session', 'nope')
		expect(missing.status).toBe(1)
		expect(missing.stderr).toContain('no digest nope.jsonl')
		expect(run({}, 'session', '../log').status).toBe(2)
		expect(run({}, 'session', 'abc-123', '1-2-3').status).toBe(2)
		expect(run({}, 'session', 'abc-123', 'x').status).toBe(2)
	})

	it('ken session shows the last 20 entries with a day line where the day changes, or a range', () => {
		const long = join(dir, 'long.jsonl')
		// 25 prompts an hour apart from 12:00, so the session runs past midnight
		const hour = (h: number) => new Date(Date.UTC(2026, 10, 6, 12 + h)).toISOString()
		writeFileSync(
			long,
			Array.from({ length: 25 }, (_, h) =>
				JSON.stringify({
					type: 'user',
					message: { role: 'user', content: `prompt ${h + 1}` },
					timestamp: hour(h),
					sessionId: 'long',
					cwd: '/w'
				})
			).join('\n')
		)
		expect(run({}, 'digest', long).status).toBe(0)
		const last = run({}, 'session', 'long').stdout.split('\n')
		expect(last[0]).toBe(
			'Session long, claude-code, started 2026-11-06 12:00, 25 entries, the last 20 shown: `ken session long <range>` prints others, 12, 12-30, or 1- for all.'
		)
		expect(last.slice(1, 3)).toEqual(['2026-11-06', '#6 17:00 user: prompt 6'])
		expect(last.slice(8, 11)).toEqual([
			'#12 23:00 user: prompt 12',
			'2026-11-07',
			'#13 00:00 user: prompt 13'
		])
		expect(last.at(-2)).toBe('#25 12:00 user: prompt 25')
		const first = run({}, 'session', 'long', '1-5').stdout.split('\n')
		expect(first[0]).toMatch(/, 25 entries, 1-5 shown: `ken session long 1-` prints all\.$/)
		expect(first.slice(1, -1)).toEqual([
			'2026-11-06',
			...[1, 2, 3, 4, 5].map((n) => `#${n} ${11 + n}:00 user: prompt ${n}`)
		])
		expect(run({}, 'session', 'long', '1-').stdout.split('\n')).toHaveLength(25 + 2 + 2)
		expect(run({}, 'session', 'long', '7').stdout).toContain('7-7 shown')
		rmSync(join(root, '.sessions/long.jsonl'))
	})

	it('ken session grep names the session, entry and kind of each match; a digest from before is still read', () => {
		expect(run({}, 'session', 'grep', 'Rayleigh').stdout).toBe(
			'abc-123:3:assistant Rayleigh scattering.\n'
		)
		expect(run({}, 'session', 'grep', 'WebFetch').stdout).toMatch(
			/^abc-123:2:assistant Looking\. Bash \{"command".*…\n$/
		)
		const none = run({}, 'session', 'grep', 'no such words')
		expect([none.status, none.stdout]).toEqual([1, ''])
		expect(run({}, 'session', 'grep', '[').status).toBe(2)
		const old = '---\nsession: old\n---\n\n## you 2026-11-06T01:00:01Z\n\nRayleigh, before\n'
		writeFileSync(join(root, '.sessions/old.md'), old)
		expect(run({}, 'session', 'old').stdout).toBe(old)
		expect(run({}, 'session', 'grep', 'Rayleigh').stdout).toBe(
			'abc-123:3:assistant Rayleigh scattering.\nold:7:Rayleigh, before\n'
		)
		rmSync(join(root, '.sessions/old.md'))
	})

	it('ken lint passes with digests in .sessions/ and no README line for them', () => {
		const node = dirname(process.execPath)
		const r = sh(root, { PATH: `${lintBin}:${node}:/usr/bin:/bin` }, '.bin/ken', 'lint')
		expect(r.stderr).toBe('')
		expect(r.status).toBe(0)
	})

	it("ken status exports the hook's session through CLAUDE_ENV_FILE, else into a pointer out of the root for ken log", () => {
		const pointer = join(dir, '.local/state/ken', root.replaceAll('/', '-'))
		const input = JSON.stringify({
			session_id: 'abc-123',
			transcript_path: transcript,
			hook_event_name: 'SessionStart'
		})
		const envFile = join(dir, 'digest-env.sh')
		writeFileSync(envFile, '')
		const status = (env: Record<string, string>) =>
			spawnSync('sh', ['.bin/ken', 'status'], {
				cwd: root,
				input,
				encoding: 'utf8',
				env: { ...BARE, ...env, HOME: dir }
			})
		expect(status({ CLAUDE_ENV_FILE: envFile }).status).toBe(0)
		const sourced = sh(dir, {}, '-c', `. ${envFile} && echo "$KEN_SESSION $KEN_SESSION_TRANSCRIPT"`)
		expect(sourced.stdout).toBe(`abc-123 ${transcript}\n`)
		expect(existsSync(pointer)).toBe(false)
		// Codex: the same stdin, no env file: the pointer is machine-local, never in the root
		expect(status({}).status).toBe(0)
		expect(readFileSync(pointer, 'utf8')).toBe(
			`KEN_SESSION=abc-123\nKEN_SESSION_TRANSCRIPT=${transcript}\n`
		)
		expect(readdirSync(root)).not.toContain('.ken-session')
		rmSync(join(root, '.sessions'), { recursive: true, force: true })
		expect(run({}, 'log', 'task', 't.md', 'added').status).toBe(0)
		expect(readFileSync(join(root, 'log.md'), 'utf8')).toMatch(/ task t\.md: added s=abc-123\n$/)
		expect(digest()).toBe(DIGEST)
		// pi: a hook that names no session leaves no other session's to be logged under
		const pi = spawnSync('sh', ['.bin/ken', 'status'], {
			cwd: root,
			input: JSON.stringify({ hook_event_name: 'SessionStart', cwd: root, source: 'startup' }),
			encoding: 'utf8',
			env: { ...BARE, HOME: dir }
		})
		expect(pi.status).toBe(0)
		expect(existsSync(pointer)).toBe(false)
		expect(run({}, 'log', 'task', 'u.md', 'added').status).toBe(0)
		expect(readFileSync(join(root, 'log.md'), 'utf8')).toMatch(/ task u\.md: added\n$/)
	})

	it('ken digest reads pi from the leaf back, dropping the branch left, and Codex without its injected context', () => {
		const pi = join(dir, 'pi.jsonl')
		const entry = (id: string, parentId: string | null, role: string, content: unknown) =>
			JSON.stringify({
				type: 'message',
				id,
				parentId,
				timestamp: at(1),
				message: { role, content }
			})
		writeFileSync(
			pi,
			[
				JSON.stringify({ type: 'session', version: 3, id: 'pi-1', timestamp: at(0), cwd: '/w' }),
				entry('a', null, 'user', 'first'),
				entry('b', 'a', 'assistant', [{ type: 'text', text: 'abandoned' }]),
				JSON.stringify({
					type: 'branch_summary',
					id: 'c',
					parentId: 'a',
					timestamp: at(2),
					summary: 's'
				}),
				entry('d', 'c', 'assistant', [
					{ type: 'toolCall', id: 'x', name: 'bash', arguments: { command: 'ls' } }
				]),
				entry('e', 'd', 'toolResult', [{ type: 'text', text: SECRET }])
			].join('\n')
		)
		expect(run({}, 'digest', pi).status).toBe(0)
		expect(run({}, 'session', 'pi-1').stdout).toBe(
			'Session pi-1, pi, started 2026-11-06 01:00, 3 entries, all shown.\n2026-11-06\n#1 01:00 user: first\n#2 01:00 compacted: (branched here: the path below left another)\n#3 01:00 → bash {"command":"ls"}\n'
		)
		const codex = join(dir, 'codex.jsonl')
		const item = (payload: unknown) =>
			JSON.stringify({ timestamp: at(1), type: 'response_item', payload })
		writeFileSync(
			codex,
			[
				JSON.stringify({
					timestamp: at(0),
					type: 'session_meta',
					payload: { id: 'cx-1', timestamp: at(0), cwd: '/w' }
				}),
				item({
					type: 'message',
					role: 'user',
					content: [{ type: 'input_text', text: '<environment_context>x</environment_context>' }]
				}),
				item({
					type: 'message',
					role: 'user',
					content: [{ type: 'input_text', text: '<task>hi</task>' }]
				}),
				item({
					type: 'message',
					role: 'assistant',
					content: [{ type: 'output_text', text: 'Looking.' }]
				}),
				item({
					type: 'function_call',
					call_id: 'c1',
					name: 'exec_command',
					arguments: JSON.stringify({ cmd: 'ls -a' })
				}),
				item({ type: 'function_call_output', call_id: 'c1', output: SECRET }),
				item({
					type: 'message',
					role: 'assistant',
					content: [{ type: 'output_text', text: 'done' }]
				})
			].join('\n')
		)
		expect(run({}, 'digest', codex).status).toBe(0)
		expect(run({}, 'session', 'cx-1').stdout).toBe(
			'Session cx-1, codex, started 2026-11-06 01:00, 3 entries, all shown.\n2026-11-06\n#1 01:00 user: <task>hi</task>\n#2 01:00 assistant: Looking.\n#2 01:00 → exec_command {"cmd":"ls -a"}\n#3 01:00 assistant: done\n'
		)
	})
})
