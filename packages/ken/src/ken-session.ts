// `ken session <id> [<range>]` prints the digest of one agent session, .sessions/<id>.jsonl, the
// story behind a log.md line that ends in s=<id>: a header line, then the last 20 entries, or
// the range, one line per entry and per tool call, as the ghost's transcript tool shows them
// (justfiles:packages/ghost/transcript-tool.ts#transcriptTool). A digest from before,
// .sessions/<id>.md, is printed whole. A search of every digest is grep's, over the files: each
// is JSON lines, one entry per line, so ken holds no search of its own. The folder is hidden, so
// a grep of the root skips it.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { cut, type Obj, objects, rootOf, strftime, wantsHelp } from './shared.ts'

const USAGE = `Usage: \`ken session <id>\` prints the last entries of the digest a log.md line's s=<id>
names, \`ken session <id> <range>\` the entries in a range, 12, 12-30 or 1- for all. Read a
digest when its line is not enough, through ken session, never whole. To search every digest,
grep the files: .sessions/<id>.jsonl at the root, JSON lines, a header and then one entry per
line, its text JSON-escaped, a newline as \\n; a digest from before is .sessions/<id>.md.
With jq, a search prints \`<id> <n>\` per matching entry, and \`ken session <id> <n>\` reads it.
  ken session 1a096823-97d3-4055-b82d-f29760687aa0 12-30
  grep -il 'rayleigh' "$(ken path root)"/.sessions/*.jsonl
  jq -r 'select(.id and (tostring | test("rayleigh"; "i"))) | "\\(input_filename | split("/")[-1] | rtrimstr(".jsonl")) \\(.id)"' "$(ken path root)"/.sessions/*.jsonl`

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
const entries = (text: string) => objects(text).filter((e) => typeof e.id === 'number')

const [first = '', second = ''] = args
if (first === '') stop('ken session: a session id is needed.', 2)

if (first.startsWith('.') || first.includes('/'))
	stop(`ken session: '${first}' is no session id: it is the word after s= in a log.md line.`, 2)
if (second.startsWith('-') || /[^0-9-]/.test(second) || /-.*-/.test(second))
	stop(`ken session: '${second}' is no range: entries 12, 12-30, or 1- for all.`, 2)
if (args.length > 2) stop('ken session: an id and at most a range are taken.', 2)

const id = first
const range = second
const jsonl = read(join(dir, `${id}.jsonl`))
const md = jsonl === undefined ? read(join(dir, `${id}.md`)) : undefined
if (jsonl === undefined && md === undefined)
	stop(
		`ken session: no digest ${id}.jsonl in ${dir}: check the id after s= in the log line, or search every digest with \`grep -l <pattern> ${dir}/*.jsonl\`.`,
		1,
		false
	)

const header: Obj = objects(jsonl ?? '').find((e) => e.kind === 'session') ?? {}
const all = entries(jsonl ?? '')
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
// No process.exit after it: a large digest into a pipe takes more than one write, and an exit
// drops what is not written yet.
process.stdout.write(md ?? `${out.join('\n')}\n`)
