// `ken digest [<transcript>]`: writes the root's record of one agent session,
// .sessions/<id>.jsonl, from the harness's transcript, KEN_SESSION_TRANSCRIPT or the argument,
// whole each time, so running it twice gives the same file. A header line, then one entry per
// line in the ghost's shape (justfiles:packages/ghost/mirror.ts#MirroredEntry): the user's
// prompts, the agent's replies with their tool calls, a name and the head of the input, and
// compactions, in transcript order; never tool results, attachments, system reminders, thinking
// or images: they are the bulk and where secrets live. `ken session` reads it. `ken log` runs
// it before each line it tags with `s=<id>`. A missing or unreadable transcript is a message
// and exit 0, so `ken log` still logs.
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { cut, type Obj, objects, rootOf, wantsHelp } from './shared.ts'

const args = process.argv.slice(2)
if (wantsHelp(args)) {
	process.stdout.write(`Usage: ken digest [<transcript>]: writes .sessions/<id>.jsonl, the digest of one agent
session, from a Claude Code, Codex or pi transcript, KEN_SESSION_TRANSCRIPT when none is
named. \`ken log\` runs it in a session the start hook named; \`ken session <id>\` reads it.
  ken digest
  ken digest ~/.claude/projects/-Users-me-ken/abc-123.jsonl
`)
	process.exit(0)
}
const root = rootOf('digest')
const transcript = args[0] || process.env.KEN_SESSION_TRANSCRIPT || ''
const say = (message: string, code: number) => {
	process.stderr.write(`ken digest: ${message}\n`)
	process.exit(code)
}
if (!transcript)
	say(
		'no transcript: KEN_SESSION_TRANSCRIPT is unset and none was given, so no digest was written. The session-start hook sets it; `ken digest <transcript>` names one.',
		0
	)
let text = ''
try {
	text = readFileSync(transcript, 'utf8')
} catch {
	say(
		`the transcript ${transcript} cannot be read, so no digest was written: the harness may have deleted it.`,
		0
	)
}
const lines = objects(text)
// The format: pi's session header or Codex's session_meta is the first line; Claude Code's
// entries carry sessionId, though the first may be a file-history snapshot that has none.
const first = objects(text.slice(0, text.indexOf('\n') + 1 || undefined))[0]
const harness =
	first?.type === 'session' ? 'pi' : first?.type === 'session_meta' ? 'codex' : 'claude-code'
if (harness === 'claude-code' && !lines.some((e) => typeof e.sessionId === 'string'))
	say(
		`${transcript} is no transcript ken reads (Claude Code, pi or Codex), so no digest was written.`,
		0
	)

type Call = { id: string; name: string; input: string }
type Entry = {
	kind: 'user' | 'assistant' | 'compaction'
	text?: string
	toolCalls?: Call[]
	summary?: string
	at: string | null
	mid?: string | null
	join?: boolean
	error?: unknown
}

/** A value jq's `//` keeps: anything but null, undefined and false. */
const set = (v: unknown) => v !== null && v !== undefined && v !== false
const or = <T>(v: unknown, fallback: T) => (set(v) ? v : fallback)
const clean = (s: string) => s.replace(/^[ \t\n]+/, '').replace(/[ \t\n]+$/, '')
const time = (v: unknown) => (typeof v === 'string' && v !== '' ? v : null)
const blocks = (content: unknown): Obj[] =>
	Array.isArray(content) ? content.filter((b) => b && typeof b === 'object') : []

/** Harness-made text, a background task finishing, a command output, a reminder, is not the
 * user speaking. */
const spoken = (s: string) =>
	!/^<(task-notification|bash-stdout|local-command-)/.test(s) &&
	(harness !== 'codex' ||
		!/^(<(environment_context|user_instructions|external_codex_apps_open_page)>|# AGENTS\.md instructions)/.test(
			s
		))

/** A user message: its text, a string or text blocks; a reminder the harness put in a prompt is
 * cut out, wherever it sits. */
const user = (content: unknown, at: unknown): Entry | undefined => {
	const texts = (
		typeof content === 'string'
			? [content]
			: blocks(content)
					.filter((b) => b.type === 'text' || b.type === 'input_text')
					.map((b) => b.text)
	)
		.filter((t): t is string => typeof t === 'string')
		.map((t) => clean(t.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '')))
		.filter((t) => t.length > 0 && spoken(t))
	return texts.length ? { kind: 'user', text: texts.join('\n\n'), at: time(at) } : undefined
}

/** A tool call: its name and its input as JSON text, cut at 120 characters. */
const call = (id: unknown, name: unknown, input: unknown): Call => ({
	id: or(id, '') as string,
	name: or(name, '') as string,
	input: cut(typeof input === 'string' ? input : JSON.stringify(input ?? null), 120)
})

const assistant = (content: unknown, at: unknown, mid: unknown): Entry => ({
	kind: 'assistant',
	text: blocks(content)
		.filter((b) => b.type === 'text' || b.type === 'output_text')
		.map((b) => clean(String(or(b.text, ''))))
		.filter((t) => t !== '')
		.join('\n\n'),
	toolCalls: blocks(content).flatMap((b) =>
		b.type === 'tool_use'
			? [call(b.id, b.name, b.input)]
			: b.type === 'toolCall'
				? [call(b.id, b.name, b.arguments)]
				: []
	),
	at: time(at),
	mid: (mid ?? null) as string | null
})

const note = (summary: string, at: unknown): Entry => ({
	kind: 'compaction',
	summary,
	at: time(at)
})

/** Claude Code: entries in file order, one per content block, a reply its entries sharing
 * message.id; isMeta text is the harness speaking, a compact summary is the model rewriting the
 * past, and a rewound branch stays in the file and in the digest. */
const claude = (e: Obj): Entry | undefined => {
	if (e.type === 'system' && e.subtype === 'compact_boundary')
		return note('(compacted here)', e.timestamp)
	if (e.type === 'user' && e.isMeta !== true && e.isCompactSummary !== true)
		return user(e.message?.content, e.timestamp)
	if (e.type === 'assistant') {
		const a = assistant(e.message?.content, e.timestamp, e.message?.id)
		return e.isApiErrorMessage === true ? { ...a, error: or(e.error, 'error') } : a
	}
}

/** pi: a tree, id and parentId; the digest is the path from the last entry back to the root. */
const pi = (e: Obj): Entry | undefined => {
	if (e.type === 'compaction') return note('(compacted here)', e.timestamp)
	if (e.type === 'branch_summary')
		return note('(branched here: the path below left another)', e.timestamp)
	if (e.type !== 'message') return
	const m = e.message ?? {}
	if (m.role === 'user') return user(m.content, e.timestamp)
	if (m.role === 'assistant') {
		const a = assistant(m.content, e.timestamp, null)
		return m.stopReason === 'error' || m.stopReason === 'aborted'
			? { ...a, error: or(m.errorMessage, m.stopReason) }
			: a
	}
}
const piPath = (all: Obj[]) => {
	const withId = all.filter((e) => 'id' in e)
	const by = new Map(withId.map((e) => [String(e.id), e]))
	const path: Obj[] = []
	const seen = new Set<string>()
	let id = String(or(withId.at(-1)?.id, ''))
	while (id !== '' && !seen.has(id)) {
		seen.add(id)
		const e = by.get(id)
		if (e) path.push(e)
		id = String(or(e?.parentId, ''))
	}
	return path.reverse()
}

/** Codex: the response items in file order; a tool call is an item of its own, joined to the
 * reply before it. */
const codex = (e: Obj): Entry | undefined => {
	if (e.type === 'compacted') return note('(compacted here)', e.timestamp)
	if (e.type !== 'response_item') return
	const p = e.payload ?? {}
	if (p.type === 'message' && p.role === 'user') return user(p.content, e.timestamp)
	if (p.type === 'message' && p.role === 'assistant') return assistant(p.content, e.timestamp, null)
	if (p.type === 'custom_tool_call' || p.type === 'function_call')
		return {
			kind: 'assistant',
			text: '',
			toolCalls: [call(p.call_id, p.name, or(p.input, p.arguments))],
			at: time(e.timestamp),
			join: true
		}
}

/** The replies merged, an entry with nothing in it dropped. */
const merge = (entries: Entry[]) => {
	const out: Entry[] = []
	for (const e of entries) {
		const last = out.at(-1)
		if (
			e.kind === 'assistant' &&
			last?.kind === 'assistant' &&
			(e.join === true || (set(e.mid) && e.mid === last.mid))
		) {
			last.text = [last.text, e.text].filter((t) => t !== '').join('\n\n')
			last.toolCalls = [...(last.toolCalls ?? []), ...(e.toolCalls ?? [])]
			if (set(e.error)) last.error = e.error
		} else out.push({ ...e })
	}
	return out.filter(
		(e) => e.kind !== 'assistant' || e.text !== '' || e.toolCalls?.length || set(e.error)
	)
}

const emit = (session: unknown, started: unknown, cwd: unknown, entries: (Entry | undefined)[]) => {
	const header = {
		kind: 'session',
		session: or(session, ''),
		harness,
		started: or(started, ''),
		cwd: or(cwd, '')
	}
	// An entry without a time takes the one before it, the first the time the session started.
	let at = time(started) ?? ''
	const numbered = merge(entries.filter((e) => e !== undefined)).map(
		({ at: own, kind, mid: _mid, join: _join, ...rest }, i) => {
			at = own ?? at
			return { id: i + 1, at, kind, ...rest }
		}
	)
	return [header, ...numbered]
}

const firstString = (key: string) => lines.find((e) => typeof e[key] === 'string')?.[key]
const digest =
	harness === 'pi'
		? emit(lines[0]?.id, lines[0]?.timestamp, lines[0]?.cwd, piPath(lines).map(pi))
		: harness === 'codex'
			? emit(
					lines[0]?.payload?.id,
					lines[0]?.payload?.timestamp,
					lines[0]?.payload?.cwd,
					lines.map(codex)
				)
			: emit(
					firstString('sessionId'),
					firstString('timestamp'),
					firstString('cwd'),
					lines.map(claude)
				)

// The session ken log tags its line with; a transcript named by hand is its own session's.
const own = (digest[0] as { session: unknown }).session
const id = String((args.length === 0 && process.env.KEN_SESSION) || own)
if (id === '' || id.startsWith('.') || id.includes('/') || id.includes(' '))
	say(
		`'${id}' is no session id: it names the file .sessions/<id>.jsonl. KEN_SESSION is the harness's id, set by the session-start hook.`,
		2
	)
const dir = join(root, '.sessions')
mkdirSync(dir, { recursive: true })
const tmp = join(dir, `.digest.${process.pid}`)
try {
	writeFileSync(tmp, digest.map((e) => `${JSON.stringify(e)}\n`).join(''))
	renameSync(tmp, join(dir, `${id}.jsonl`))
} catch (e) {
	rmSync(tmp, { force: true })
	say(
		`writing ${join(dir, `${id}.jsonl`)} failed, so no digest was written: ${(e as Error).message}.`,
		1
	)
}
