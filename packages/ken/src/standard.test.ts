// The standard commands status, log, digest and session, run as a user runs them, `ken <name>`,
// against temp roots, with a PATH on which there is no ken and no jq.
import { spawnSync } from 'node:child_process'
import {
	existsSync,
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

const CLI = join(import.meta.dirname, 'cli.ts')
const dir = realpathSync.native(mkdtempSync(join(tmpdir(), 'ken-standard-')))
let n = 0

type Run = { cwd: string; env?: Record<string, string>; input?: string }
/** `ken <args>`: PATH has sh and git, HOME is the temp folder, times are UTC unless `env` says
 * otherwise, and no session or env file comes from the caller. */
const ken = (args: string[], { cwd, env = {}, input }: Run) => {
	const r = spawnSync(process.execPath, [CLI, ...args], {
		cwd,
		input,
		encoding: 'utf8',
		env: { PATH: '/usr/bin:/bin', HOME: dir, TZ: 'UTC', ...env }
	})
	return { status: r.status, stdout: r.stdout, stderr: r.stderr }
}
/** A new root, made by `ken init`, with a folder `sub/deep` to run from. */
const newRoot = () => {
	const root = join(dir, `root ${++n}`)
	mkdirSync(join(root, 'sub/deep'), { recursive: true })
	expect(ken(['init'], { cwd: root }).status).toBe(0)
	return root
}
const lines = (root: string) => readFileSync(join(root, 'log.md'), 'utf8').split('\n').slice(0, -1)

describe('ken log', { timeout: 30_000 }, () => {
	let root: string
	beforeAll(() => {
		root = newRoot()
	})
	const log = (...args: string[]) => ken(['log', ...args], { cwd: join(root, 'sub/deep') })

	it('from a subfolder, appends one line to the root log.md: local time and offset, kind, subject, what', () => {
		for (const _ of [1, 2]) {
			const r = log('query', 'flow/README.md', 'answered', 'X')
			expect(r.stdout + r.stderr).toBe('')
			expect(r.status).toBe(0)
		}
		expect(lines(root)).toHaveLength(2)
		for (const line of lines(root))
			expect(line).toMatch(
				/^\d{4}-\d\d-\d\dT\d\d:\d\d[+-]\d{4} query flow\/README\.md: answered X$/
			)
		expect(
			ken(['log', 'page', 'a.md', 'x'], { cwd: root, env: { TZ: 'Pacific/Chatham' } }).status
		).toBe(0)
		expect(lines(root).at(-1)).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d\+1[23]45 page a\.md: x$/)
	})

	it.each([
		[['nope', 'a', 'b'], "'nope' is not a kind"],
		[['ingest query', 'a', 'b'], "'ingest query' is not a kind"],
		[['page', 'a b', 'c'], "'a b' is not one word"],
		[['page', 'a', 'one\ntwo'], 'spans lines'],
		[['page', 'a', ' \t'], 'is empty'],
		[['page', 'a'], 'are needed']
	])('refuses %j, naming the rule and the kinds, and writes nothing', (args, rule) => {
		const before = lines(root).length
		const r = log(...args)
		expect(r.status).toBe(2)
		expect(r.stderr).toContain(rule)
		expect(r.stderr).toContain('ingest query page task promote layer')
		expect(lines(root)).toHaveLength(before)
	})
})

describe('ken status', { timeout: 30_000 }, () => {
	it('names the CLI, lists the repos and settings, exits 0, and with no stdin writes no pointer', () => {
		const root = newRoot()
		const r = ken(['status'], { cwd: join(root, 'sub/deep') })
		expect(r.status).toBe(0)
		expect(r.stdout).toMatch(
			new RegExp(
				`^This is a ken root: ${root}\\. Its CLI is \`ken\`; \`ken help\` lists the commands\\.\n\nken: .*nothing to\\s+list`
			)
		)
		expect(r.stdout).toContain('\n\nSettings, .ken:\n  # ken settings')
		expect(r.stdout).toContain('\n  ken.format=1\n')
		// no ken-task anywhere, so no ready tasks; no log.md, so no recent lines
		expect(r.stdout).not.toContain('task')
		expect(r.stdout).not.toContain('log.md')
		expect(existsSync(join(dir, '.local/state/ken', root.replaceAll('/', '-')))).toBe(false)
	})

	it('outside any root, says so and exits 0', () => {
		const away = join(dir, 'away')
		mkdirSync(away)
		const r = ken(['status'], { cwd: away })
		expect(r.status).toBe(0)
		expect(r.stdout).toContain(`This is no ken root: ken found no .ken at or above ${away}`)
	})

	it('ends with the last 10 lines of log.md in time order and the current time', () => {
		const root = newRoot()
		const entries = Array.from(
			{ length: 12 },
			(_, i) => `2026-01-${String(i + 1).padStart(2, '0')}T09:00+1300 page p${i}.md: x`
		)
		// a union merge appends the other side after this one's: out of order
		writeFileSync(
			join(root, 'log.md'),
			`${[...entries.slice(6), ...entries.slice(0, 6)].join('\n')}\n`
		)
		const r = ken(['status'], { cwd: root })
		expect(r.status).toBe(0)
		expect(r.stdout).toMatch(/Recent, log\.md \(now \d{4}-\d\d-\d\dT\d\d:\d\d\+0000\)/)
		expect(r.stdout.endsWith(`:\n${entries.slice(2).join('\n')}\n`)).toBe(true)
	})

	it("lists the ready tasks when there is a ken task, from the root's .bin/ or PATH", () => {
		const root = newRoot()
		mkdirSync(join(root, '.bin'))
		writeFileSync(join(root, '.bin/ken-task'), '#!/bin/sh\necho "tasks: $*"\n', { mode: 0o755 })
		expect(ken(['status'], { cwd: root }).stdout).toContain('\n  ken.format=1\n\ntasks: ready\n')
	})

	it('puts the root’s .bin/ and the session in CLAUDE_ENV_FILE, else the session in a pointer out of the root, which ken log reads', () => {
		const root = newRoot()
		const pointer = join(dir, '.local/state/ken', root.replaceAll('/', '-'))
		const transcript = join(dir, "it's.jsonl")
		writeFileSync(transcript, CLAUDE_CODE)
		const input = JSON.stringify({
			session_id: 'abc-123',
			transcript_path: transcript,
			hook_event_name: 'SessionStart'
		})
		const envFile = join(dir, 'env.sh')
		writeFileSync(envFile, '')
		expect(ken(['status'], { cwd: root, input, env: { CLAUDE_ENV_FILE: envFile } }).status).toBe(0)
		// sourced before each shell command: the root's own tools by name, no KEN_ROOT
		const sourced = spawnSync(
			'sh',
			[
				'-c',
				`. '${envFile}' && echo "$PATH|$KEN_SESSION|$KEN_SESSION_TRANSCRIPT|\${KEN_ROOT-unset}"`
			],
			{ encoding: 'utf8', env: { PATH: '/usr/bin:/bin' } }
		)
		expect(sourced.stdout).toBe(`${root}/.bin:/usr/bin:/bin|abc-123|${transcript}|unset\n`)
		expect(existsSync(pointer)).toBe(false)

		// Codex: the same stdin, no env file: the pointer is machine-local, never in the root
		expect(ken(['status'], { cwd: root, input }).status).toBe(0)
		expect(readFileSync(pointer, 'utf8')).toBe(
			`KEN_SESSION=abc-123\nKEN_SESSION_TRANSCRIPT=${transcript}\n`
		)
		expect(ken(['log', 'task', 't.md', 'added'], { cwd: root }).status).toBe(0)
		expect(lines(root).at(-1)).toMatch(/ task t\.md: added s=abc-123$/)
		expect(readFileSync(join(root, '.sessions/abc-123.jsonl'), 'utf8')).toBe(DIGEST)

		// pi: a hook that names no session leaves no other session's to be logged under
		const pi = JSON.stringify({ hook_event_name: 'SessionStart', cwd: root, source: 'startup' })
		expect(ken(['status'], { cwd: root, input: pi }).status).toBe(0)
		expect(existsSync(pointer)).toBe(false)
		expect(ken(['log', 'task', 'u.md', 'added'], { cwd: root }).status).toBe(0)
		expect(lines(root).at(-1)).toMatch(/ task u\.md: added$/)
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
const CLAUDE_CODE = `${[
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
		`<system-reminder>${SECRET}</system-reminder>Why is the "sky" blue?\nAnswer with C:\\path in é<system-reminder>\n${SECRET}\n</system-reminder>`
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
	.join('\n')}\n{"type":"user","message":{"content":"half`
// The last line is one the harness is still writing: not JSON, skipped.
// The digest the ghost's mirror would write for it: the shape of
// justfiles:packages/ghost/mirror.ts#MirroredEntry, a tool input cut as its digest() cuts it.
const head = (input: unknown) => `${JSON.stringify(input).slice(0, 120)}…`
const DIGEST = [
	{ kind: 'session', session: 'abc-123', harness: 'claude-code', started: at(0), cwd: '/w' },
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
	.map((e) => `${JSON.stringify(e)}\n`)
	.join('')
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

describe('session digests', { timeout: 30_000 }, () => {
	let root: string
	let transcript: string
	beforeAll(() => {
		root = newRoot()
		transcript = join(dir, 'abc-123.jsonl')
		writeFileSync(transcript, CLAUDE_CODE)
	})
	const run = (env: Record<string, string>, ...args: string[]) =>
		ken(args, { cwd: join(root, 'sub/deep'), env })
	const digest = () => readFileSync(join(root, '.sessions/abc-123.jsonl'), 'utf8')

	it("ken digest writes a header and the ghost's entries, a reply and its tool calls one, and nothing else, the same twice", () => {
		for (const _ of [1, 2]) {
			const r = run({}, 'digest', transcript)
			expect(r.stdout + r.stderr).toBe('')
			expect(r.status).toBe(0)
			expect(digest()).toBe(DIGEST)
		}
		expect(digest()).not.toContain('SECRET')
		expect(digest()).not.toContain('harness text')
		expect(digest()).not.toContain('done')
		expect(readdirSync(join(root, '.sessions'))).toEqual(['abc-123.jsonl'])
	})

	it("ken digest <transcript> in another session writes the transcript's session, not that one", () => {
		const r = run({ KEN_SESSION: 'other' }, 'digest', transcript)
		expect(r.status).toBe(0)
		expect(readdirSync(join(root, '.sessions'))).toEqual(['abc-123.jsonl'])
	})

	it('ken digest with no transcript, one gone, or one no harness wrote, says so and exits 0', () => {
		expect(run({}, 'digest').stderr).toContain('no transcript: KEN_SESSION_TRANSCRIPT is unset')
		const gone = run({ KEN_SESSION_TRANSCRIPT: join(dir, 'nope.jsonl') }, 'digest')
		expect([gone.status, gone.stderr]).toEqual([
			0,
			`ken digest: the transcript ${dir}/nope.jsonl cannot be read, so no digest was written: the harness may have deleted it.\n`
		])
		const other = join(dir, 'other.jsonl')
		writeFileSync(other, '{"a":1}\n')
		const r = run({}, 'digest', other)
		expect(r.status).toBe(0)
		expect(r.stderr).toContain('is no transcript ken reads (Claude Code, pi or Codex)')
	})

	it('ken log in a session writes the digest and ends the line with s=<id>; with none, logs as before', () => {
		rmSync(join(root, '.sessions'), { recursive: true, force: true })
		const r = run(
			{ KEN_SESSION: 'abc-123', KEN_SESSION_TRANSCRIPT: transcript },
			'log',
			'query',
			'flow/README.md',
			'answered',
			'X'
		)
		expect(r.stdout + r.stderr).toBe('')
		expect(digest()).toBe(DIGEST)
		expect(run({}, 'log', 'page', 'flow/a.md', 'added').status).toBe(0)
		expect(lines(root).at(-2)).toMatch(/ query flow\/README\.md: answered X s=abc-123$/)
		expect(lines(root).at(-1)).toMatch(/ page flow\/a\.md: added$/)
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
		expect(lines(root).at(-1)).toMatch(/ page p\.md: x s=gone$/)
	})

	it('ken session prints the entries from any folder in local time; a bad id or range is refused', () => {
		expect(run({}, 'session', 'abc-123').stdout).toBe(SHOWN)
		for (const TZ of ['NZDT-13', 'Pacific/Auckland']) {
			const nz = run({ TZ }, 'session', 'abc-123').stdout
			expect(nz).toContain('started 2026-11-06 14:00')
			expect(nz).toContain('#1 14:00 user:')
		}
		const missing = run({}, 'session', 'nope')
		expect(missing.status).toBe(1)
		expect(missing.stderr).toContain('no digest nope.jsonl')
		for (const args of [[], ['../log'], ['abc-123', '1-2-3'], ['abc-123', 'x'], ['abc-123', '-3']])
			expect(run({}, 'session', ...args).status).toBe(2)
		expect(run({}, 'session', 'abc-123', '1', '2').stderr).toContain('at most a range')
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
		expect(run({}, 'session', 'long', '30-').stdout).toBe(
			'Session long, claude-code, started 2026-11-06 12:00, 25 entries, none in 30-: `ken session long 1-` prints them all.\n'
		)
		rmSync(join(root, '.sessions/long.jsonl'))
	})

	it('ken session grep names the session, entry and kind of each match, exit 1 for none and 2 for a bad pattern; a digest from before is still read', () => {
		expect(run({}, 'session', 'grep', 'Rayleigh').stdout).toBe(
			'abc-123:3:assistant Rayleigh scattering.\n'
		)
		expect(run({}, 'session', 'grep', 'WebFetch').stdout).toMatch(
			/^abc-123:2:assistant Looking\. Bash \{"command".*…\n$/
		)
		const none = run({}, 'session', 'grep', 'no such words')
		expect([none.status, none.stdout]).toEqual([1, ''])
		expect(run({}, 'session', 'grep', '[').status).toBe(2)
		// the patterns jq read: its flags at the start, POSIX classes in a bracket
		for (const p of [
			'(?i)RAYLEIGH',
			'[[:upper:]]ayleigh',
			'(?im)rayleigh.scat',
			'^[^[:digit:]]ayl',
			'[]R]ayleigh',
			'R[^]]yleigh'
		])
			expect(run({}, 'session', 'grep', p).stdout).toBe(
				'abc-123:3:assistant Rayleigh scattering.\n'
			)
		expect(run({}, 'session', 'grep', '[[:digit:]]ayleigh').status).toBe(1)
		// ^ and $ anchor at what an entry says, whole, as in jq, not at each line of it
		expect(run({}, 'session', 'grep', '^Read ').status).toBe(1)
		expect(run({}, 'session', 'grep', '^Looking\\. Bash').status).toBe(1)
		expect(run({}, 'session', 'grep', '^Looking\\.\n').stdout).toMatch(/^abc-123:2:assistant /)
		expect(run({}, 'session', 'grep', '"prompt":"p"}$').stdout).toMatch(/^abc-123:2:assistant /)
		expect(run({}, 'session', 'grep').status).toBe(2)
		const old = '---\nsession: old\n---\n\n## you 2026-11-06T01:00:01Z\n\nRayleigh, before\n'
		writeFileSync(join(root, '.sessions/old.md'), old)
		expect(run({}, 'session', 'old').stdout).toBe(old)
		expect(run({}, 'session', 'grep', 'Rayleigh').stdout).toBe(
			'abc-123:3:assistant Rayleigh scattering.\nold:7:Rayleigh, before\n'
		)
		// searched by grep, as before: a basic regular expression, where + ( ) ? are literal
		writeFileSync(join(root, '.sessions/old.md'), 'a+b (x)? here\naaab\n')
		expect(run({}, 'session', 'grep', 'a+b (x)?').stdout).toBe('old:1:a+b (x)? here\n')
		expect(run({}, 'session', 'grep', 'a\\{3\\}b').stdout).toBe('old:2:aaab\n')
		rmSync(join(root, '.sessions/old.md'))
	})

	it('ken session grep with no digest yet says what writes one, exit 1', () => {
		const empty = newRoot()
		const r = ken(['session', 'grep', 'x'], { cwd: empty })
		expect(r.status).toBe(1)
		expect(r.stderr).toContain('holds no digest yet: `ken log` writes one')
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
		expect(readFileSync(join(root, '.sessions/cx-1.jsonl'), 'utf8')).not.toContain(SECRET)
	})
})
