// The knowledge-base lint: is the root still safe to read top down? See "`ken-lint`" in
// docs/prd.md. Files are parsed as CommonMark, so a link, a code span and a label are what a
// Markdown reader sees, never a guess at where one ends.
import { type SpawnSyncReturns, spawnSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { basename, dirname, join, relative, resolve, sep } from 'node:path'
import type { Nodes } from 'mdast'
import { fromMarkdown } from 'mdast-util-from-markdown'

// The caps, in lines, and the age of a page nobody links to before it is proposed for
// .archive/. The one place to change them.
export const FRONT_PAGE_MAX = 60
export const SECTION_README_MAX = 150
export const AGENTS_MAX = 40
export const STALE_DAYS = 365

// the names at the top of the root that are not pages: the front page, the reserved
// files, and the index and the checkouts, which are hidden too
const RESERVED = new Set([
	'README.md',
	'AGENTS.md',
	'CLAUDE.md',
	'log.md',
	'.repos.index',
	'.repos'
])
// `<host>/<owner>/<repo>:<path>`, each part as `ken path` takes it, in prose or a code span
const REFERENCE = /(?<![\w./:-])([\w-][\w.-]*\/[\w.-]+\/[\w.-]+):([^\s'"<>#,;*]+)/gi
const IS_REFERENCE = /^[\w-][\w.-]*\/[\w.-]+\/[\w.-]+:/

type Page = { path: string; listedBy: string[] }

const ken = (args: string[]) => spawnSync('ken', args, { encoding: 'utf8' })

/** A word for sh, whatever it holds. */
const quote = (word: string) => `'${word.replaceAll("'", `'\\''`)}'`

/**
 * The task folder of the root, absolute, from its `.ken` as docs/files.md reads it: a repeated
 * key is its last line, a value is trimmed. One it cannot read stops the lint.
 */
function taskFolder(root: string): string {
	const file = join(root, '.ken')
	const unknown = 'so the task folder is unknown'
	let text: string
	try {
		text = readFileSync(file, 'utf8')
	} catch (e) {
		throw new Error(
			`${file} could not be read (${(e as Error).message}), ${unknown}. Every root holds a .ken: make it with \`ken init ${quote(root)}\`, then run \`ken lint\` again.`
		)
	}
	let folder = 'tasks'
	for (const [i, line] of text.split('\n').entries()) {
		if (!line.startsWith('task.folder=')) continue
		folder = line.slice('task.folder='.length).trim()
		if (!folder) {
			throw new Error(
				`${file} line ${i + 1}, ${JSON.stringify(line)}, sets task.folder to nothing, ${unknown}. It is a folder, relative to the root or absolute, like task.folder=tasks: fix the line, or delete it for the default, tasks.`
			)
		}
	}
	return resolve(root, folder)
}

/** A path keeps its brackets, `src/app/[id]/page.ts`, not the prose's punctuation after it. */
function trimPath(path: string): string {
	const p = path.replace(/[.:!?]+$/, '')
	const close = p.at(-1) ?? ''
	const open = { ')': '(', ']': '[' }[close]
	const count = (c: string) => p.split(c).length
	return open && count(open) < count(close) ? trimPath(p.slice(0, -1)) : p
}

function decode(url: string): string {
	try {
		return decodeURIComponent(url)
	} catch {
		return url
	}
}

function visit(node: Nodes, fn: (node: Nodes) => void): void {
	fn(node)
	if ('children' in node) for (const child of node.children as Nodes[]) visit(child, fn)
}

/** Lint the root at `root`: one line per problem, then the summary; `errors` decides the exit. */
export function lint(root: string): { lines: string[]; errors: number } {
	// The task folder holds tasks, not pages: compared by real path, so a link to a folder above
	// it does not reach it either. The checkouts are never walked, whatever link reaches into them.
	const folder = taskFolder(root)
	const tasks = existsSync(folder) ? realpathSync(folder) : folder
	const seen = new Set([realpathSync(root)]) // folders walked
	const repos = existsSync(join(root, '.repos')) ? realpathSync(join(root, '.repos')) : undefined

	const problems: string[] = []
	const report = (kind: 'error' | 'note', file: string, text: string, line?: number) =>
		problems.push(`${kind}: ${relative(root, file)}${line ? `:${line}` : ''}: ${text}`)
	const lines = (file: string) => {
		const text = readFileSync(file, 'utf8')
		return text.split('\n').length - (text.endsWith('\n') ? 1 : 0)
	}
	const cap = (file: string, max: number, why: string) => {
		if (existsSync(file) && lines(file) > max) {
			report('error', file, `${lines(file)} lines, over the cap of ${max}. ${why}`)
		}
	}

	// The walk, as `find -L`: links followed, each folder read once. A page is keyed by its real
	// path, so a link that reaches it by another path still finds it.
	const pages = new Map<string, Page>()
	const readmes: string[] = []
	const walk = (dir: string) => {
		const real = realpathSync(dir)
		if (real === tasks || seen.has(real)) return
		if (repos && (real === repos || real.startsWith(repos + sep))) return
		seen.add(real)
		for (const name of readdirSync(dir).sort()) {
			const path = join(dir, name)
			const stat = statSync(path, { throwIfNoEntry: false })
			if (name.startsWith('.') || !stat) continue
			if (stat.isDirectory()) walk(path)
			else if (name === 'README.md') readmes.push(path)
			else if (name.endsWith('.md')) pages.set(realpathSync(path), { path, listedBy: [] })
		}
	}
	for (const name of readdirSync(root).sort()) {
		const path = join(root, name)
		if (name.startsWith('.') || RESERVED.has(name)) continue
		const stat = statSync(path, { throwIfNoEntry: false })
		if (stat?.isDirectory()) walk(path)
		// a page at the top is in no section: reported below
		else if (stat && name.endsWith('.md')) pages.set(realpathSync(path), { path, listedBy: [] })
	}
	cap(
		join(root, 'README.md'),
		FRONT_PAGE_MAX,
		'The front page is read first for every question: keep one line per section and the few evergreen pages, and move the rest into pages.'
	)
	cap(
		join(root, 'AGENTS.md'),
		AGENTS_MAX,
		'It is loaded on every turn: keep the non-obvious only, and move the rest into a page.'
	)
	for (const readme of readmes) {
		cap(
			readme,
			SECTION_README_MAX,
			`Split the section: move groups of pages into subfolders, each with its own README.md, and list the subfolders in ${relative(root, readme)}.`
		)
	}

	// Links and code references, in the front pages, the section READMEs and the pages.
	const inbound = new Set<string>() // real paths of pages some front page or page links to
	const paths = new Map<string, SpawnSyncReturns<string>>() // reference -> `ken path` of it
	const uncloned = new Map<string, number>() // key -> references into it not checked
	const checkReference = (file: string, key: string, path: string, line?: number) => {
		const ref = `${key}:${path}`
		const r = paths.get(ref) ?? ken(['path', ref])
		paths.set(ref, r)
		const out = r.stdout.trim()
		if (r.status !== 0)
			report('error', file, `\`ken path ${ref}\` failed: ${r.stderr.trim()}`, line)
		else if (out.startsWith('https://')) uncloned.set(key, (uncloned.get(key) ?? 0) + 1)
		else if (!existsSync(out)) {
			report(
				'error',
				file,
				`${ref} names a file not in the clone. Find where it went, \`git -C "$(ken path code ${key})" log --oneline -- '${path}'\`, and fix the reference.`,
				line
			)
		}
	}
	// in prose or a code span, a reference ends where the text says it does
	const checkReferences = (file: string, text: string, line?: number) => {
		for (const m of text.matchAll(REFERENCE)) {
			// the node's first line, plus the lines before the match within it
			const at = line && line + text.slice(0, m.index).split('\n').length - 1
			checkReference(file, m[1] ?? '', trimPath(m[2] ?? ''), at)
		}
	}
	const front = [join(root, 'README.md')].filter((f) => existsSync(f))
	for (const file of [...front, ...readmes, ...[...pages.values()].map((p) => p.path)]) {
		const tree = fromMarkdown(readFileSync(file, 'utf8'))
		// a reference link renders through its definition; a definition alone renders nothing
		const definitions = new Map<string, string>()
		visit(tree, (node) => {
			if (node.type === 'definition' && !definitions.has(node.identifier)) {
				definitions.set(node.identifier, node.url)
			}
		})
		const listed = new Set<string>()
		// code blocks are examples: neither their links nor their references are checked
		visit(tree, (node) => {
			const line = node.position?.start.line
			if (node.type === 'text' || node.type === 'inlineCode') {
				return checkReferences(file, node.value, line)
			}
			// every definition's target is checked once, at the definition; only a rendered link,
			// inline or through a definition, lists a page or links to it
			const url =
				node.type === 'link' || node.type === 'definition'
					? node.url
					: node.type === 'linkReference'
						? definitions.get(node.identifier)
						: undefined
			const checks = node.type !== 'linkReference'
			if (url === undefined) return
			// as a link's destination, a reference is the whole of it, URL-encoded: `%20` is a space
			if (IS_REFERENCE.test(url)) {
				const ref = url.replace(/#.*$/, '')
				const colon = ref.indexOf(':')
				if (checks) checkReference(file, ref.slice(0, colon), decode(ref.slice(colon + 1)), line)
				return
			}
			// a URL or an anchor
			if (/^[a-z][a-z0-9+.-]*:|^#|^\/\//i.test(url)) return
			const path = decode(url.replace(/[#?].*$/, ''))
			const to = path.startsWith('/') ? join(root, path) : resolve(dirname(file), path)
			if (!existsSync(to)) {
				if (checks) {
					report(
						'error',
						file,
						`links to ${url}, which does not exist. Fix the path, or remove the link.`,
						line
					)
				}
				return
			}
			if (node.type === 'definition') return
			const real = realpathSync(to)
			if (pages.has(real) && readmes.includes(file)) listed.add(real)
			else if (real !== realpathSync(file)) inbound.add(real)
		})
		for (const page of listed) pages.get(page)?.listedBy.push(file)
	}

	for (const [real, { path: page, listedBy }] of pages) {
		if (dirname(page) === root) {
			report(
				'error',
				page,
				`a page at the top of the root, where only the front page and the reserved files live, so it is in no section. Move it into the section it belongs to with \`git mv\`, and add its line to that section's README.md.`
			)
		} else if (listedBy.length === 0) {
			report(
				'error',
				page,
				`listed in no section README.md, so an agent reading down from the front page never finds it. Add a line \`- [${basename(page, '.md')}](${encodeURI(basename(page))}): <what it says>\` to ${relative(root, join(dirname(page), 'README.md'))}, making it if missing.`
			)
		} else if (listedBy.length > 1) {
			report(
				'error',
				page,
				`listed in ${listedBy.length} section READMEs, ${listedBy.map((f) => relative(root, f)).join(' and ')}; a page has one home. Keep its line in one and drop it from the others.`
			)
		}
		if (inbound.has(real)) continue
		const log = spawnSync('git', ['log', '-1', '--format=%ct', '--', basename(page)], {
			cwd: dirname(real),
			encoding: 'utf8'
		})
		const changed = Number(log.stdout.trim()) * 1000
		if (!changed || Date.now() - changed < STALE_DAYS * 86_400_000) continue
		const rel = relative(root, page)
		report(
			'note',
			page,
			`nobody links to it and nobody has changed it since ${new Date(changed).toISOString().slice(0, 10)}. If it is settled, propose archiving it: \`cd "$(ken path root)" && mkdir -p -- ${quote(join('.archive', dirname(rel)))} && git mv -- ${quote(rel)} ${quote(join('.archive', rel))}\`, then drop its line from its README.md.`
		)
	}

	if (uncloned.size) {
		const keys = [...uncloned.keys()]
		const count = [...uncloned.values()].reduce((a, b) => a + b, 0)
		problems.push(
			`note: not checked: ${count} code references into ${keys.join(', ')}, not cloned here. To check them, run ${keys.map((k) => `\`ken get ${k}\``).join(' and ')}, then \`ken lint\` again.`
		)
	}
	const errors = problems.filter((p) => p.startsWith('error:')).length
	problems.push(
		errors
			? `ken lint: ${errors} errors in ${pages.size} pages. Fix each as it says, then run \`ken lint\` again.`
			: `ken lint: no errors in ${pages.size} pages.`
	)
	return { lines: problems, errors }
}
