import { readFileSync, realpathSync, statSync } from 'node:fs'
import { basename, dirname, extname, relative } from 'node:path'
import { parse } from 'yaml'
import { load, localDate, resolveRef, since, walk } from './list.ts'
import { type Read, readTask } from './read.ts'
import { real } from './resolve.ts'
import { flowList, replaceFile, withField } from './set.ts'

/**
 * How a file deviates from the canonical shape: `what`, and the `upgrade` to make, or `set`,
 * the front matter line `lint --fix` writes, losing nothing.
 */
type Deviation = { what: string; upgrade?: string; set?: [field: string, value: string] }

/**
 * `ken task lint`: every deviation from the canonical shape in the task folder, one line
 * each, the path first. With `fix`, the lossless upgrades of each file are written through
 * `set`'s one-line writer, all or none, and printed as done. `deviates` is whether any is
 * left.
 */
export function lintTasks(
	root: string,
	configured: string,
	fix: boolean
): { lines: string[]; deviates: boolean } {
	const folder = real(configured)
	const paths = walk(folder)
	const live = new Set(paths)
	const created = since(root, folder)
	const lines: string[] = []
	let deviates = false
	for (const path of paths) {
		const read = load(path)
		const found = deviations(path, read)
		const fixes = found.filter((d) => d.set)
		const refused = fix && fixes.length ? upgrade(path, read, fixes) : undefined
		if (refused) lines.push(`${path}: ${refused}`)
		for (const d of found) {
			const line = d.set?.join(': ')
			if (fix && line && !refused) lines.push(`${path}: ${d.what}: wrote \`${line}\``)
			else {
				deviates = true
				lines.push(`${path}: ${d.what}${d.upgrade ? `: ${d.upgrade}` : ''}`)
			}
		}
	}
	return { lines, deviates }

	function deviations(path: string, read: Read): Deviation[] {
		const found: Deviation[] = [...read.problems, ...read.flags].map((what) => ({ what }))
		const ext = extname(path)
		if (ext !== '.md') {
			const md = `${ext ? path.slice(0, -ext.length) : path}.md`
			found.push({
				what: `${ext ? `a ${ext}` : 'a file with no extension'} has no front matter, so every field is its default`,
				upgrade: `make it a .md, \`mv "${path}" "${md}"\`, and name the .md in any blocked-by that names it`
			})
			return found
		}
		// nothing can be written into a file that is not fully read, or not closed
		if (read.problems.length || !read.written) return found
		const { fields } = read
		const lossless = (what: string, field: string, value: string): Deviation => ({
			what,
			upgrade: `\`ken task lint --fix\` writes \`${field}: ${value}\``,
			set: [field, value]
		})
		if (!read.written.includes('status')) {
			found.push(lossless('no status line, so it reads as todo', 'status', 'todo'))
		}
		if (!fields.created) {
			const [date, by] = created(path)
			found.push(lossless(`no created line, so it is taken from ${by}`, 'created', date))
		}
		if ((fields.status === 'done' || fields.status === 'wontfix') && !fields.closed) {
			const date = localDate(statSync(path).mtime)
			found.push(
				lossless(`status ${fields.status} with no closed line; its mtime says when`, 'closed', date)
			)
		}
		const reshape = [...read.reshape]
		const refs = fields['blocked-by'].map((ref) => {
			const to = resolveRef(root, folder, live, path, ref)
			if (!to) {
				found.push({
					what: `blocked-by ${ref} is in neither the folder nor its .archive/, so it blocks the task`,
					upgrade: `name the task it waits on, \`ken task set ${path} blocked-by <tasks>\`, or remove it`
				})
			}
			if (!to?.from) return ref
			reshape.push(`blocked-by ${ref} resolves from ${to.from}, not from this file`)
			return relative(dirname(path), to.target)
		})
		if (reshape.length) found.push(lossless(reshape.join('; '), 'blocked-by', flowList(refs)))
		return found
	}
}

/**
 * Write `fixes` into the file at `path`, as read in `read`: every other field must read back
 * as it was and the file in the canonical shape, or nothing is written and the reason is
 * returned.
 */
function upgrade(path: string, read: Read, fixes: Deviation[]): string | undefined {
	const file = realpathSync(path)
	let next = readFileSync(file, 'utf8')
	try {
		for (const { set } of fixes) if (set) next = withField(next, ...set)
	} catch (e) {
		return `its upgrades cannot be written (${(e as Error).message}), so it is left as it was; make them by hand`
	}
	const back = readTask(basename(path), next)
	const expected = {
		...read.fields,
		...Object.fromEntries(fixes.flatMap(({ set }) => (set ? [[set[0], parse(set[1])]] : [])))
	}
	const sorted = (fields: object) =>
		JSON.stringify(Object.entries(fields).sort(([a], [b]) => (a < b ? -1 : 1)))
	if (back.problems.length || back.reshape.length || sorted(back.fields) !== sorted(expected)) {
		return 'its upgrades would not read back as written, so it is left as it was; make them by hand, then run `ken task lint`'
	}
	replaceFile(file, next)
}
