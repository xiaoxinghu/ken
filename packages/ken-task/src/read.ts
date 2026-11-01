import { isSeq, parseDocument } from 'yaml'

/** The fields of a task, as its front matter gives them, with `status` defaulting to `todo`. */
export type Fields = {
	status: string
	created?: string
	closed?: string
	repo?: string
	'blocked-by': string[]
	scheduled?: string
	due?: string
	/** Every other front matter field, as YAML reads it. */
	other: Record<string, unknown>
}

/**
 * A task file as read: `flags` are the tolerated deviations from the canonical shape,
 * `problems` what kept it from being fully read, each with its fix.
 */
export type Read = { title: string; fields: Fields; flags: string[]; problems: string[] }

const SCALARS = new Set(['status', 'created', 'closed', 'repo', 'scheduled', 'due'])
const DATES = new Set(['created', 'closed', 'scheduled', 'due'])
const ALIASES = new Set(['blocked_by', 'blockedBy', 'depends_on', 'depends-on'])
const STATUSES = ['todo', 'done', 'wontfix']
const CANONICAL = 'the canonical form is one line, `blocked-by: [a.md, b.md]`'

export function isDate(text: string): boolean {
	const date = new Date(`${text}T00:00:00Z`)
	return (
		/^\d{4}-\d{2}-\d{2}$/.test(text) &&
		!Number.isNaN(date.getTime()) &&
		date.toISOString().startsWith(text)
	)
}

/**
 * Read a task file named `name`. Only a `.md` has front matter: YAML between `---` lines,
 * read by a YAML parser, then held to the tolerance list of docs/ken-task.md, so that a
 * deviation is flagged, never refused. The title is the first `# ` heading, else the name
 * without its extension, dashes as spaces.
 */
export function readTask(name: string, text: string): Read {
	const lines = text.replace(/^﻿/, '').split(/\r?\n/)
	const read: Read = {
		title: '',
		fields: { status: 'todo', 'blocked-by': [], other: {} },
		flags: [],
		problems: []
	}
	let body = 0
	if (name.endsWith('.md') && /^---\s*$/.test(lines[0] ?? '')) {
		const end = lines.findIndex((line, i) => i > 0 && /^---\s*$/.test(line))
		if (end < 0) {
			read.flags.push(
				'its front matter has no closing `---`, so every field reads as absent: add a `---` line after the last field'
			)
		} else {
			frontMatter(lines.slice(1, end).join('\n'), read)
			body = end + 1
		}
	}
	const status = read.fields.status
	if (!STATUSES.includes(status)) {
		read.flags.push(
			`status ${JSON.stringify(status)} is none of ${STATUSES.join(', ')}, so it reads as open: set one of them`
		)
	}
	read.title = heading(lines.slice(body)) ?? name.replace(/(.)\.[^.]*$/, '$1').replaceAll('-', ' ')
	return read
}

function frontMatter(source: string, read: Read): void {
	const { fields, flags, problems } = read
	const doc = parseDocument(source)
	let data: unknown
	try {
		const [error] = doc.errors
		if (error) throw error
		// an alias to no anchor is no parse error, but throws here
		data = doc.toJS()
	} catch (e) {
		const { message, linePos } = e as Error & { linePos?: { line: number }[] }
		// the front matter starts on the file's second line
		const at = linePos?.[0] ? `line ${linePos[0].line + 1}: ` : ''
		problems.push(
			`its front matter is not YAML (${at}${message.split(/ at line |\n/)[0]}): fix that line, or quote its value`
		)
		return
	}
	try {
		// what a row carries must print as JSON; an alias inside its own anchor never would
		data = JSON.parse(JSON.stringify(data) ?? 'null')
	} catch {
		problems.push(
			'its front matter has a value that contains itself, through a YAML alias inside its own anchor: write the value out'
		)
		return
	}
	if (data === null) return
	if (typeof data !== 'object' || Array.isArray(data)) {
		problems.push('its front matter is not `field: value` lines: write it as such, or remove it')
		return
	}
	const seen = new Map<string, string>()
	for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
		const field = ALIASES.has(key) ? 'blocked-by' : key
		if (field !== 'blocked-by' && !SCALARS.has(field)) {
			fields.other[key] = value
			continue
		}
		const before = seen.get(field)
		seen.set(field, key)
		if (before !== undefined) {
			problems.push(
				`${field} is written twice, as ${before} and as ${key}, so which one holds is unclear: keep one`
			)
		} else if (field === 'blocked-by') {
			if (key !== field) flags.push(`${key} reads as blocked-by: rename the field to blocked-by`)
			const node = doc.get(key, true)
			const form = isSeq(node) ? (node.flow ? 'list' : 'block list') : 'single value'
			fields['blocked-by'] = list(key, value, form, read)
		} else if (value === null) {
			// `field:` with nothing after it is absent
		} else if (typeof value === 'object') {
			problems.push(`${key} is not a single value: write it as \`${key}: <value>\``)
		} else if (DATES.has(key) && !isDate(String(value))) {
			problems.push(
				`${key} ${JSON.stringify(String(value))} is not a date: write it as \`${key}: YYYY-MM-DD\``
			)
		} else Object.assign(fields, { [key]: String(value) })
	}
}

/** `blocked-by` as read: a one-line list, or a block list or a single value, flagged. */
function list(key: string, value: unknown, form: string, read: Read): string[] {
	if (value === null) return []
	const items = Array.isArray(value) ? value : [value]
	if (items.some((item) => item === null || typeof item === 'object')) {
		read.problems.push(`${key} is not a list of paths: ${CANONICAL}`)
		return []
	}
	if (form !== 'list') read.flags.push(`${key} is a ${form}: ${CANONICAL}`)
	return items.map(String)
}

/** The text of the first `# ` heading of `lines`, outside fenced code. */
function heading(lines: string[]): string | undefined {
	let fenced = false
	for (const line of lines) {
		if (/^ {0,3}(```|~~~)/.test(line)) fenced = !fenced
		const text = fenced ? undefined : /^ {0,3}#[ \t]+(.*\S)/.exec(line)?.[1]
		if (text) return text
	}
}
