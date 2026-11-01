import { mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { Document } from 'yaml'
import { inFolder, outside, real, resolveTask } from './resolve.ts'

// a part of a task's path is letters, digits and dashes, so its branch name is too
const PART = /^[\p{L}\p{N}][\p{L}\p{N}-]*$/u
const EXT = /\.[\p{L}\p{N}]+$/u
const KEY = /^[a-z0-9._-]+\/[a-z0-9._-]+\/[a-z0-9._-]+$/

/** Whether `text` is a repo key, `<host>/<owner>/<repo>` in lowercase, naming a folder under .repos/. */
export const isKey = (text: string) =>
	KEY.test(text) && text.split('/').every((p) => p !== '.' && p !== '..')
const stemOf = (name: string) => name.replace(/(.)\.[^.]*$/, '$1')

export type Added = {
	/** The file made, absolute. */
	path: string
	/** What the normalisation changed, when it changed anything. */
	renamed?: string
}

/**
 * Add the task `arg` names, a path into the task folder `configured` read as `resolveTask`
 * reads one, in the canonical shape of docs/ken-task.md: `status: todo`, `created: <today>`,
 * `repo` and `blocked-by` when given, then the heading. Everything is checked before anything
 * is written; the file is made with the exclusive-create flag, so of two adds of one path
 * exactly one wins.
 */
export function addTask(
	root: string,
	configured: string,
	cwd: string,
	arg: string,
	opts: { repo?: string; blockedBy: string[]; today: string }
): Added {
	const { repo, blockedBy, today } = opts
	if (repo !== undefined && !isKey(repo)) {
		throw new Error(
			`-r ${JSON.stringify(repo)} is not a repo key, so \`ken task claim\` could not find its clone: ` +
				'a key is <host>/<owner>/<repo> in lowercase, e.g. `-r github.com/acme/portal`, as `ken which` prints it inside the clone.'
		)
	}
	const folder = real(configured)
	const [typed] = inFolder(root, folder, cwd, arg)
	if (typed === undefined) throw outside(root, folder, arg)
	// the one normalisation: lowercase, spaces to dashes
	const rel = typed.toLowerCase().replaceAll(' ', '-')
	const ext = EXT.exec(rel)?.[0] ?? ''
	if (ext && ext !== '.md') {
		throw new Error(
			`${typed} is a ${ext}, but what add writes is front matter, which ken-task reads only in a .md, so its fields would be lost: ` +
				`run \`ken task add ${join(folder, rel.slice(0, -ext.length))}\` for the .md. A file of another extension is a task with every default, written by hand.`
		)
	}
	const parts = rel.slice(0, rel.length - ext.length).split('/')
	if (!parts.every((p) => PART.test(p))) {
		const name = parts
			.map((p) => p.replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, ''))
			.join('/')
		throw new Error(
			`${typed} has punctuation other than dashes, and a task's path is its branch name, so ken-task names tasks ` +
				`with letters, digits and dashes only: run \`ken task add ${join(folder, name + ext)}\`.`
		)
	}
	const path = join(folder, ext ? rel : `${rel}.md`)
	// the normalised path may lead elsewhere than the typed one did, through a link
	if (!inFolder(root, folder, folder, path).length) throw outside(root, folder, path)
	const dir = dirname(path)
	const stem = stemOf(path.slice(dir.length + 1))
	const taken = files(dir).find((e) => stemOf(e).toLowerCase() === stem)
	if (taken) {
		const existing = join(dir, taken)
		throw new Error(
			existing === path
				? `${path} exists, so it cannot be added: add more to it with \`cat >> ${path}\`, or give this task another name.`
				: `${existing} exists, and a task's branch is its path without the extension, so ${path} would share its branch: ` +
						'give this task another name.'
		)
	}
	const refs = blockedBy.map((b) => relative(dir, resolveTask(root, folder, cwd, b)))
	const lines = ['---', 'status: todo', `created: ${today}`]
	if (repo) lines.push(`repo: ${repo}`)
	if (refs.length) {
		const list = new Document(refs)
		;(list.contents as { flow: boolean }).flow = true
		lines.push(
			`blocked-by: ${list.toString({ lineWidth: 0, flowCollectionPadding: false }).trim()}`
		)
	}
	lines.push('---', '', `# ${stem.replaceAll('-', ' ')}`, '')
	mkdirSync(dir, { recursive: true })
	try {
		writeFileSync(path, lines.join('\n'), { flag: 'wx' })
	} catch (e) {
		if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e
		throw new Error(
			`${path} exists, made since this add looked, most likely by another \`ken task add\`: read it with \`cat ${path}\`, or give this task another name.`
		)
	}
	if (typed === rel) return { path }
	const renamed = `${typed} is named ${relative(folder, path)}: a task's path is its branch name, so it is lowercase, with dashes for spaces.`
	return { path, renamed }
}

/** The entries of `dir` other than folders; none if it does not exist. */
function files(dir: string): string[] {
	try {
		return readdirSync(dir, { withFileTypes: true })
			.filter((e) => !e.isDirectory())
			.map((e) => e.name)
	} catch {
		return []
	}
}
