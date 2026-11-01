import { readFileSync, realpathSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, relative } from 'node:path'
import { isMap, isNode, isScalar, parse, parseDocument } from 'yaml'
import { isDate, readTask } from './read.ts'
import { resolveTask } from './resolve.ts'

/** The fields `set` writes, in the order its messages name them. */
export const FIELDS = ['status', 'repo', 'blocked-by', 'scheduled', 'due'] as const
const STATUSES = ['todo', 'done', 'wontfix']
const ALIASES = ['blocked_by', 'blockedBy', 'depends_on', 'depends-on']
const FENCE = /^---\s*$/
const PART = /^[a-z0-9._-]+$/

/**
 * `text` with the front matter line of `field` set to `value`, or removed when `value` is
 * undefined: only that line changes, keeping the space after its colon and a trailing
 * comment, and the lines that continue its value go with it. A missing line is appended at
 * the end of the front matter; a file with none gets one at the top. An alias of
 * `blocked-by` is its line, written back as `blocked-by`. Every other byte stays, the line
 * endings included. Throws on front matter with no closing `---`.
 */
export function withField(text: string, field: string, value: string | undefined): string {
	const bom = text.startsWith('\uFEFF') ? '\uFEFF' : ''
	const body = text.slice(bom.length)
	// each line with its own ending, split as the reader splits, so mixed endings survive
	const lines = body.match(/[^\n]*\n|[^\n]+$/g) ?? []
	const bare = (l = '') => l.replace(/\r?\n$/, '')
	const ending = (l = '') => /\r?\n$/.exec(l)?.[0] ?? '\n'
	const line = (indent: string, eol: string) =>
		value === undefined ? [] : [`${indent}${field}: ${value}${eol}`]
	if (!FENCE.test(bare(lines[0]))) {
		const eol = ending(lines[0])
		return value === undefined ? text : `${bom}---${eol}${line('', eol).join('')}---${eol}${body}`
	}
	const end = lines.findIndex((l, i) => i > 0 && FENCE.test(bare(l)))
	if (end < 0) {
		throw new Error(
			'its front matter has no closing `---`, so a field written into it would not read back: add a `---` line after the last field'
		)
	}
	const keys = field === 'blocked-by' ? [field, ...ALIASES] : [field]
	const { found, comment, indent } = span(lines.slice(1, end).map(bare).join('\n'), keys)
	if (!found) {
		lines.splice(end, 0, ...line(indent, ending(lines[end - 1])))
		return bom + lines.join('')
	}
	const [at, next] = [found[0] + 1, found[1] + 1]
	const old = bare(lines[at])
	const gap = /^[ \t]*/.exec(old.slice(old.indexOf(':') + 1))?.[0] || ' '
	const set = `${indent}${field}:${gap}${value}${comment ?? ''}${ending(lines[next - 1])}`
	lines.splice(at, next - at, ...(value === undefined ? [] : [set]))
	return bom + lines.join('')
}

/**
 * The lines of `source`, front matter, that hold the first of `keys`, as YAML reads the key
 * (quoted or not): from the key's line to past the line its value ends on, so a value over
 * several lines, with blank lines or comments between its items, goes whole; the comment
 * that ends the value's last line, else its key's line, to keep; and the indentation of the
 * mapping's keys, for a line written into it.
 */
function span(
	source: string,
	keys: string[]
): { found?: [number, number]; comment?: string; indent: string } {
	const doc = parseDocument(source)
	const [error] = doc.errors
	if (error)
		throw new Error(`its front matter is not YAML (${error.message.split('\n')[0]}): fix it`)
	if (!isMap(doc.contents)) return { indent: '' }
	if (doc.contents.flow) {
		throw new Error(
			'its front matter is one `{...}` mapping, so one field cannot be rewritten without the others: write each field as `field: value` on a line of its own'
		)
	}
	const line = (offset: number) => source.slice(0, offset).split('\n').length - 1
	const start = doc.contents.range?.[0] ?? 0
	const indent = source.slice(source.lastIndexOf('\n', start - 1) + 1, start)
	for (const pair of doc.contents.items) {
		const key = pair.key
		if (!isScalar(key) || !keys.includes(String(key.value)) || !key.range) continue
		const value = isNode(pair.value) ? pair.value.range : undefined
		const last = Math.max(key.range[1], value?.[1] ?? 0)
		// what follows an offset on its line, when that is a comment, after the colon and a
		// block scalar's header if any
		const tail = (offset: number) =>
			/^(?::[ \t]*(?:[|>][-+0-9]*)?)?([ \t]+#.*)?$/.exec(
				source.slice(offset).split('\n')[0] ?? ''
			)?.[1]
		const comment = tail(last) ?? tail(key.range[1])
		return {
			found: [line(key.range[0]), line(Math.max(last - 1, key.range[0])) + 1],
			comment,
			indent
		}
	}
	return { indent }
}

/** `items` as a one-line YAML list, each item plain when YAML reads it back as written. */
function flowList(items: string[]): string {
	const plain = `[${items.join(', ')}]`
	try {
		if (JSON.stringify(parse(plain)) === JSON.stringify(items)) return plain
	} catch {}
	return `[${items.map((item) => JSON.stringify(item)).join(', ')}]`
}

/** `value` checked as `field` takes it, or a refusal that names the format. */
function check(field: string, value: string): void {
	const refuse = (format: string, example: string) =>
		new Error(
			`${field} ${JSON.stringify(value)} is not ${format}, so it would not read as one: run \`ken task set <task> ${field} ${example}\`, ` +
				`or \`ken task set <task> ${field} ''\` to remove the line`
		)
	if (field === 'status' && !STATUSES.includes(value)) {
		throw refuse(`one of ${STATUSES.join(', ')}`, 'done')
	}
	if ((field === 'scheduled' || field === 'due') && !isDate(value)) {
		throw refuse('a date, YYYY-MM-DD', '2026-11-30')
	}
	const parts = value.split('/')
	if (
		field === 'repo' &&
		!(parts.length === 3 && parts.every((p) => PART.test(p) && p !== '.' && p !== '..'))
	) {
		throw refuse('a repo key, <host>/<owner>/<repo> in lowercase', 'github.com/acme/join-web')
	}
}

/**
 * `ken task set`: rewrite the line of `field` in the task `arg` names to `value`, an empty
 * value removing it, and return the file's path. `blocked-by` takes comma-separated paths
 * as typed from `cwd` and writes each relative to the file; `status done` or `wontfix` also
 * writes `closed: <today>`, `status todo` or none removes it. The new text must read back as
 * set, and is written beside the file, then renamed over it.
 */
export function setTask(
	root: string,
	folder: string,
	cwd: string,
	[arg, field, value]: [string, string, string],
	today: string
): string {
	if (!(FIELDS as readonly string[]).includes(field)) {
		throw new Error(
			`${JSON.stringify(field)} is not a field ken task set writes; it writes ${FIELDS.join(', ')}. ` +
				'Run `ken task set --help` for the formats.'
		)
	}
	if (value && field !== 'blocked-by') check(field, value)
	const path = resolveTask(root, folder, cwd, arg)
	if (!path.endsWith('.md')) {
		throw new Error(
			`${path} is not a .md, so it has no front matter to hold ${field}: make it one, ` +
				`\`mv "${path}" "${path.replace(/(.)\.[^./]*$/, '$1')}.md"\`, then rerun; a blocked-by that names it must name the .md too`
		)
	}
	const file = realpathSync(path)
	const stat = statSync(file)
	if (!stat.isFile()) {
		throw new Error(
			`${path} is not a regular file, so it cannot be set: \`ls -ld ${path}\` shows what it is`
		)
	}
	const text = readFileSync(file, 'utf8')
	const { fields: before, problems } = readTask(basename(path), text)
	if (problems.length) {
		throw new Error(
			`${path} could not be fully read, so a field written into it might not read back: ${problems.join('; ')}. Then rerun.`
		)
	}
	const refs = (field === 'blocked-by' ? value : '')
		.split(',')
		.map((ref) => ref.trim())
		.filter(Boolean)
		.map((ref) => relative(dirname(path), resolveTask(root, folder, cwd, ref)))
	const written = !value ? undefined : field === 'blocked-by' ? flowList(refs) : value
	const closes = value === 'done' || value === 'wontfix'
	let next: string
	try {
		next = withField(text, field, written)
		if (field === 'status') next = withField(next, 'closed', closes ? today : undefined)
	} catch (e) {
		throw new Error(`${path} cannot be set: ${(e as Error).message}, then rerun`)
	}

	const { fields: back, problems: after } = readTask(basename(path), next)
	// every field but the one set, and closed with status, reads back as it was
	const others = (fields: object) =>
		JSON.stringify(
			Object.entries(fields)
				.filter(([k]) => k !== field && !(field === 'status' && k === 'closed'))
				.sort(([a], [b]) => (a < b ? -1 : 1))
		)
	const expected =
		field === 'blocked-by' ? refs : value || (field === 'status' ? 'todo' : undefined)
	if (
		after.length ||
		others(back) !== others(before) ||
		JSON.stringify(back[field as keyof typeof back]) !== JSON.stringify(expected) ||
		(field === 'status' && back.closed !== (closes ? today : undefined))
	) {
		throw new Error(
			`${field} written as ${JSON.stringify(written)} would not read back as set, so ${path} is left as it was: ` +
				`edit the line by hand, then run \`ken task list\` to check it`
		)
	}
	const temp = join(dirname(file), `.${basename(file)}.${process.pid}.tmp`)
	writeFileSync(temp, next, { mode: stat.mode & 0o777 })
	renameSync(temp, file)
	return path
}
