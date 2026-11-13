// `ken session <id> [<range>]` prints the digest of one agent session, .sessions/<id>.jsonl, the
// story behind a log.md line that ends in s=<id>: a header line, then the last 20 entries, or
// the range, one line per entry and per tool call, as the ghost's transcript tool shows them
// (justfiles:packages/ghost/transcript-tool.ts#transcriptTool). `ken session grep <pattern>`
// searches every digest, one `<id>:<n>:<kind> <text>` per entry that matches. A digest from
// before, .sessions/<id>.md, is printed whole and grepped by line. The folder is hidden, so a
// grep of the root skips it.
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { cut, type Obj, objects, rootOf, strftime, wantsHelp } from './shared.ts'

const USAGE = `Usage: \`ken session <id>\` prints the last entries of the digest a log.md line's s=<id>
names, \`ken session <id> <range>\` the entries in a range, 12, 12-30 or 1- for all;
\`ken session grep <pattern>\` searches every digest. Read a digest when its line is not enough;
never list or read .sessions/ whole.`

const args = process.argv.slice(2)
if (wantsHelp(args)) {
	process.stdout.write(`${USAGE}\n`)
	process.exit(0)
}
const root = rootOf('session')
const dir = join(root, '.sessions')
const stop = (message: string, code: number, usage = true) => {
	process.stderr.write(`${message}\n${usage ? `${USAGE}\n` : ''}`)
	process.exit(code)
}

/** A line collapsed to one of 200 characters. */
const collapse = (s: string) => cut(s.replace(/\s+/g, ' ').replace(/^ /, '').replace(/ $/, ''), 200)
/** An ISO time as local time by `format`, `?` when it is none. */
const local = (at: unknown, format: string) => {
	const ms = typeof at === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d/.test(at) ? Date.parse(at) : NaN
	return Number.isNaN(ms) ? '?' : strftime(new Date(ms), format)
}
const read = (file: string) => {
	try {
		return readFileSync(file, 'utf8')
	} catch {
		return undefined
	}
}
/** POSIX bracket classes, which jq's regular expressions read and JavaScript's do not. */
const POSIX: Record<string, string> = {
	alnum: 'a-zA-Z0-9',
	alpha: 'a-zA-Z',
	blank: ' \\t',
	cntrl: '\\x00-\\x1f\\x7f',
	digit: '0-9',
	graph: '\\x21-\\x7e',
	lower: 'a-z',
	print: '\\x20-\\x7e',
	punct: '!-\\/:-@\\[-`{-~',
	space: '\\s',
	upper: 'A-Z',
	word: '\\w',
	xdigit: '0-9A-Fa-f'
}
/** A pattern as jq read it, Oniguruma's syntax, where JavaScript's differs: flags at its start,
 * `(?i)` for any case and `(?m)` for a dot that matches a newline, and POSIX classes inside a
 * bracket, `[[:upper:]]`, and a `]` first in one. Throws when JavaScript reads no such pattern. */
const regex = (pattern: string) => {
	const lead = pattern.match(/^\(\?([im]+)\)/)
	const flags = [...new Set(lead?.[1] ?? '')].map((f) => (f === 'm' ? 's' : f)).join('')
	let source = ''
	let inClass = false
	let opened = 0
	const rest = pattern.slice(lead?.[0].length ?? 0)
	for (let i = 0; i < rest.length; i++) {
		const posix = inClass && rest.slice(i).match(/^\[:(\w+):\]/)
		if (posix && POSIX[posix[1] ?? '']) {
			source += POSIX[posix[1] ?? '']
			i += posix[0].length - 1
			continue
		}
		const c = rest[i]
		if (c === '\\') {
			source += rest.slice(i, i + 2)
			i++
			continue
		}
		// a ] first in a bracket is literal, where JavaScript reads [] as empty
		const first = inClass && /^\[\^?$/.test(source.slice(opened))
		if (c === '[' && !inClass) {
			inClass = true
			opened = source.length
		} else if (c === ']' && first) {
			source += '\\]'
			continue
		} else if (c === ']' && inClass) inClass = false
		source += c
	}
	return new RegExp(source, flags)
}
const entries = (text: string) => objects(text).filter((e) => typeof e.id === 'number')

const [first = '', second = ''] = args
if (first === '') stop('ken session: a session id is needed.', 2)

if (first === 'grep') {
	if (args.length !== 2)
		stop('ken session grep: one pattern is needed, quoted if it has spaces.', 2)
	let files: string[] = []
	try {
		files = readdirSync(dir)
			.filter((f) => !f.startsWith('.') && (f.endsWith('.jsonl') || f.endsWith('.md')))
			.sort()
	} catch {}
	if (!files.length)
		stop(
			`ken session grep: ${dir} holds no digest yet: \`ken log\` writes one in a session the start hook named.`,
			1,
			false
		)
	let pattern = /$^/
	try {
		pattern = regex(second)
	} catch {
		stop(
			`ken session grep: '${second}' is no pattern ken reads, a regular expression; quote what is meant literally.`,
			2,
			false
		)
	}
	/** Everything an entry says: its text, and each tool call's name and input. */
	const said = (e: Obj) =>
		e.kind === 'user'
			? e.text
			: e.kind === 'assistant'
				? [e.text, ...(e.toolCalls ?? []).map((c: Obj) => `${c.name} ${c.input}`)].join('\n')
				: e.kind === 'compaction'
					? e.summary
					: (e.handoff ?? '')
	const found: string[] = []
	for (const f of files.filter((f) => f.endsWith('.jsonl')))
		for (const e of entries(read(join(dir, f)) ?? '')) {
			const text = String(said(e))
			if (pattern.test(text))
				found.push(`${f.slice(0, -'.jsonl'.length)}:${e.id}:${e.kind} ${collapse(text)}`)
		}
	for (const f of files.filter((f) => f.endsWith('.md')))
		(read(join(dir, f)) ?? '')
			.replace(/\n$/, '')
			.split('\n')
			.forEach((line, i) => {
				if (pattern.test(line)) found.push(`${f.slice(0, -'.md'.length)}:${i + 1}:${line}`)
			})
	if (!found.length) process.exit(1)
	process.stdout.write(`${found.join('\n')}\n`)
	process.exit(0)
}

if (first.startsWith('.') || first.includes('/'))
	stop(`ken session: '${first}' is no session id: it is the word after s= in a log.md line.`, 2)
if (second.startsWith('-') || /[^0-9-]/.test(second) || /-.*-/.test(second))
	stop(`ken session: '${second}' is no range: entries 12, 12-30, or 1- for all.`, 2)
if (args.length > 2) stop('ken session: an id and at most a range are taken.', 2)

const id = first
const range = second
const jsonl = read(join(dir, `${id}.jsonl`))
if (jsonl === undefined) {
	const md = read(join(dir, `${id}.md`))
	if (md === undefined)
		stop(
			`ken session: no digest ${id}.jsonl in ${dir}: check the id after s= in the log line, or \`ken session grep <pattern>\`.`,
			1,
			false
		)
	process.stdout.write(md ?? '')
	process.exit(0)
}

const header: Obj = objects(jsonl).find((e) => e.kind === 'session') ?? {}
const all = entries(jsonl)
const n = all.length
const [from, to] =
	range === ''
		? [n - 19, n]
		: range.includes('-')
			? [Number(range.split('-')[0]), range.endsWith('-') ? n : Number(range.split('-')[1])]
			: [Number(range), Number(range)]
const shown = all.filter((e) => e.id >= from && e.id <= to)

/** An entry: its first line numbered and timed, a tool call a line of its own. */
const render = (e: Obj) => {
	const head = `#${e.id} ${local(e.at, '%H:%M')}`
	if (e.kind === 'user') return [`${head} user: ${e.text}`]
	if (e.kind === 'assistant')
		return [
			...(e.text === '' && e.toolCalls?.length ? [] : [`${head} assistant: ${e.text}`]),
			...(e.toolCalls ?? []).map((c: Obj) => collapse(`${head} → ${c.name} ${c.input}`)),
			...(e.error !== undefined && e.error !== null && e.error !== false
				? [`${head} (failed: ${e.error})`]
				: [])
		]
	if (e.kind === 'reset') return [`${head} new session${e.handoff ? `: ${e.handoff}` : ''}`]
	if (e.kind === 'compaction') return [collapse(`${head} compacted: ${e.summary}`)]
	return []
}

const last = shown.at(-1)
const out = [
	`Session ${header.session ?? id}, ${header.harness ?? '?'}, started ${local(header.started ?? '', '%Y-%m-%d %H:%M')}, ${n} entries${
		!last
			? `, none in ${range}: \`ken session ${id} 1-\` prints them all.`
			: shown.length === n
				? ', all shown.'
				: range === ''
					? `, the last ${shown.length} shown: \`ken session ${id} <range>\` prints others, 12, 12-30, or 1- for all.`
					: `, ${shown[0]?.id}-${last.id} shown: \`ken session ${id} 1-\` prints all.`
	}`
]
// A day line before the first entry and where the day changes.
let day: string | undefined
for (const e of shown) {
	const d = local(e.at, '%Y-%m-%d')
	if (d !== day) out.push(d)
	day = d
	out.push(...render(e))
}
process.stdout.write(`${out.join('\n')}\n`)
