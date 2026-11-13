// The two files ken reads and writes, `.ken` and `.repos.index`, by docs/files.md: a reader
// that cannot read a line stops naming it, and a writer changes only the lines it means to.
import { renameSync, rmSync, writeFileSync } from 'node:fs'
import { die, q } from './die.ts'

const SPEC = 'docs/files.md in github.com/xiaoxinghu/ken'

/** The settings of a `.ken`'s text, read from `file`: a key repeated reads as its last line. */
export const parseSettings = (text: string, file: string) => {
	const settings = new Map<string, string>()
	for (const [i, line] of text.split('\n').entries()) {
		if (line.startsWith('#') || line.trim() === '') continue
		const m = /^([A-Za-z0-9_.-]+)=(.*)$/.exec(line)
		if (!m?.[1])
			die(
				`${file} line ${i + 1}, ${q(line)}, is not a line ken can read, so ken cannot tell`,
				'what the root is set to. It expects a comment starting with #, or <key>=<value> with',
				`the key letters, digits, _, . and - and no space before the =, as ${SPEC} says.`,
				'Fix or delete that line, then rerun.'
			)
		else settings.set(m[1], (m[2] ?? '').trim())
	}
	return settings
}

/** `text`, a `.ken`, with `key` set to `value`: its last line replaced, else one appended. */
export const setSetting = (text: string, key: string, value: string) => {
	const lines = splitLines(text)
	const at = lines.findLastIndex((line) => line.startsWith(`${key}=`))
	if (at < 0) lines.push(`${key}=${value}`)
	else lines[at] = `${key}=${value}`
	return `${lines.join('\n')}\n`
}

/** One stanza of `.repos.index`: `repo: <key>` or `owner: <key>`, then its fields in order. */
export type Stanza = { kind: 'repo' | 'owner'; key: string; fields: Map<string, string> }

const FIELD = /^([A-Za-z0-9_-]+):(?:[ \t](.*))?$/
export const KEY = {
	repo: /^[a-z0-9._-]+\/[a-z0-9._-]+\/[a-z0-9._-]+$/,
	owner: /^[a-z0-9._-]+\/[a-z0-9._-]+$/
}

/** The stanzas of a `.repos.index`'s text, read from `file`. */
export const parseIndex = (text: string, file: string) => {
	const stanzas: Stanza[] = []
	let stanza: Stanza | undefined
	for (const [i, line] of text.split('\n').entries()) {
		if (line.startsWith('#')) continue
		if (line.trim() === '') {
			stanza = undefined
			continue
		}
		const bad = (expected: string) =>
			die(
				`${file} line ${i + 1}, ${q(line)}, is not a line ken can read: it expects ${expected},`,
				`as ${SPEC} says. Without it ken cannot tell what the root's repos are.`,
				'Fix that line, then rerun.'
			)
		const m = FIELD.exec(line)
		const name = m?.[1] ?? ''
		const value = (m?.[2] ?? '').trim()
		if (!stanza) {
			if (name !== 'repo' && name !== 'owner')
				bad('the first line of a stanza, repo: <host>/<owner>/<repo> or owner: <host>/<owner>')
			const kind = name as Stanza['kind']
			if (!KEY[kind].test(value) || value.split('/').some((part) => part === '.' || part === '..'))
				bad(
					`${kind}: and a key, lowercase letters, digits, ., _ and -, one part per /, none . or ..`
				)
			if (stanzas.some((s) => s.kind === kind && s.key === value))
				bad(`${kind}: ${value} in one stanza only, and an earlier one has it`)
			stanza = { kind, key: value, fields: new Map() }
			stanzas.push(stanza)
		} else if (!m) bad('a field, <name>: <value>, the name letters, digits, _ and -')
		// owner: is a field of a repo stanza too; only the stanza's own first name is reserved
		else if (name === stanza.kind || stanza.fields.has(name))
			bad(`${name}: once per stanza, and the stanza has it already`)
		else if (name === 'desc' && value === '') bad('desc: with a value, never empty')
		else stanza.fields.set(name, value)
	}
	return stanzas
}

/** `text`, a `.repos.index`, with `fields` set in the stanza of the repo `key`: each field's
 * line replaced or appended to the stanza, a stanza added at the end when none has `key`.
 * The caller has checked each name and value, one line each. */
export const setFields = (text: string, key: string, fields: [string, string][]) => {
	const lines = splitLines(text)
	// the first line of a stanza, never a field such as a repo: inside an owner stanza
	let inStanza = false
	let start = lines.findIndex((line) => {
		if (line.startsWith('#')) return false
		const first = !inStanza
		inStanza = line.trim() !== ''
		const m = FIELD.exec(line)
		return first && m?.[1] === 'repo' && m[2]?.trim() === key
	})
	if (start < 0) {
		if (lines.length && lines.at(-1)?.trim() !== '') lines.push('')
		start = lines.push(`repo: ${key}`) - 1
	}
	let end = lines.findIndex((line, i) => i > start && line.trim() === '')
	if (end < 0) end = lines.length
	for (const [name, value] of fields) {
		const at = lines.findIndex(
			(line, i) => i > start && i < end && !line.startsWith('#') && FIELD.exec(line)?.[1] === name
		)
		if (at >= 0) lines[at] = `${name}: ${value}`
		else lines.splice(end++, 0, `${name}: ${value}`)
	}
	return `${lines.join('\n')}\n`
}

/** The lines of `text`, without the empty one after its last newline. */
const splitLines = (text: string) => {
	const lines = text.split('\n')
	if (lines.at(-1) === '') lines.pop()
	return lines
}

/** Write `text` to `file` beside it and rename it over, so a reader never sees half of it. */
export const writeAtomic = (file: string, text: string) => {
	const tmp = `${file}.tmp.${process.pid}`
	try {
		writeFileSync(tmp, text)
		renameSync(tmp, file)
	} catch (e) {
		rmSync(tmp, { force: true })
		die(
			`could not write ${file}: ${(e as Error).message}. It is unchanged.`,
			'Fix that, then rerun.'
		)
	}
}
