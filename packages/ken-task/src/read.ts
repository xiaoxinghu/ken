/** The fields of a task, as its front matter gives them, with `status` defaulting to `todo`. */
export type Fields = {
	status: string
	created?: string
	closed?: string
	repo?: string
	'blocked-by': string[]
	scheduled?: string
	due?: string
	/** Every other front matter field, its value as written. */
	other: Record<string, string>
}

/**
 * A task file as read: `flags` are the tolerated deviations from the canonical shape,
 * `problems` what kept it from being fully read, each with its fix.
 */
export type Read = { title: string; fields: Fields; flags: string[]; problems: string[] }

const SCALARS = new Set(['status', 'created', 'closed', 'repo', 'scheduled', 'due'])
const DATES = new Set(['created', 'closed', 'scheduled', 'due'])
const ALIASES = new Set(['blocked_by', 'blockedBy', 'depends_on', 'depends-on'])
export const STATUSES = ['todo', 'done', 'wontfix']

export const isDate = (text: string): boolean =>
	/^\d{4}-\d{2}-\d{2}$/.test(text) && new Date(`${text}T00:00:00Z`).toISOString().startsWith(text)

/** A YAML value as written: its trailing comment dropped, unquoted. */
function scalar(raw: string): string {
	const text = (/^["']/.test(raw) ? raw : raw.replace(/(^|\s+)#.*$/, '')).trim()
	const double = /^"(.*)"$/.exec(text)?.[1]
	if (double !== undefined) return double.replace(/\\(["\\])/g, '$1')
	const single = /^'(.*)'$/.exec(text)?.[1]
	return single === undefined ? text : single.replaceAll("''", "'")
}

/**
 * Read a task file named `name`. Only a `.md` has front matter, read one line at a time so
 * that a deviation is flagged, never refused. The title is the first `# ` heading, else
 * the name without its extension, dashes as spaces.
 */
export function readTask(name: string, text: string): Read {
	const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/)
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
			frontMatter(lines.slice(1, end), read)
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

function frontMatter(lines: string[], read: Read): void {
	const { fields, flags, problems } = read
	const entries: { key: string; value: string; more: string[] }[] = []
	lines.forEach((line, i) => {
		if (/^\s*(#.*)?$/.test(line)) return
		const field = /^([A-Za-z_][\w.-]*)[ \t]*:(?:[ \t]+(.*))?$/.exec(line)
		const last = entries.at(-1)
		if (field?.[1]) entries.push({ key: field[1], value: field[2] ?? '', more: [] })
		else if (last && /^[\s-]/.test(line)) last.more.push(line.trim())
		else {
			problems.push(
				`line ${i + 2}, ${JSON.stringify(line)}, is not a \`field: value\` line of its front matter: make it one, or remove it`
			)
		}
	})
	const seen = new Map<string, string>()
	for (const { key, value, more } of entries) {
		const name = ALIASES.has(key) ? 'blocked-by' : key
		if (name !== 'blocked-by' && !SCALARS.has(name)) {
			fields.other[key] = [value, ...more].filter(Boolean).join('\n')
			continue
		}
		const before = seen.get(name)
		if (before !== undefined) {
			problems.push(
				`${name} is written twice, as ${before} and as ${key}, so which one holds is unclear: keep one line`
			)
			continue
		}
		seen.set(name, key)
		if (name === 'blocked-by') {
			if (key !== name) flags.push(`${key} reads as blocked-by: rename the field to blocked-by`)
			fields['blocked-by'] = list(key, scalar(value), more, read)
			continue
		}
		const text = scalar(value)
		if (more.length) {
			problems.push(`${key} goes on past its line: write it on one line, \`${key}: <value>\``)
		} else if (DATES.has(key) && text && !isDate(text)) {
			problems.push(
				`${key} ${JSON.stringify(text)} is not a date: write it as \`${key}: YYYY-MM-DD\``
			)
		} else if (text) Object.assign(fields, { [key]: text })
	}
}

/** `blocked-by` as written: a one-line `[a.md, b.md]`, or a scalar or a block list, flagged. */
function list(key: string, value: string, more: string[], read: Read): string[] {
	const canonical = 'the canonical form is one line, `blocked-by: [a.md, b.md]`'
	if (value.startsWith('[') && value.endsWith(']') && !more.length) {
		return value.slice(1, -1).split(',').map(scalar).filter(Boolean)
	}
	if (!value && more.every((line) => line.startsWith('-'))) {
		if (more.length) read.flags.push(`${key} is a block list: ${canonical}`)
		return more.map((line) => scalar(line.slice(1))).filter(Boolean)
	}
	if (value && !value.startsWith('[') && !more.length) {
		read.flags.push(`${key} is a single value, not a list: ${canonical}`)
		return [value]
	}
	read.problems.push(`${key} is not a list that reads on its own line: ${canonical}`)
	return []
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
