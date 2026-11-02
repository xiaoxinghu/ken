// The knowledge-base lint: is the root still safe to read top down? See "`ken-lint`" in
// docs/prd.md. Files are parsed as CommonMark, so a link, a code span and a label are what a
// Markdown reader sees, never a guess at where one ends.
import { type SpawnSyncReturns, spawnSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { basename, dirname, join, relative, resolve } from 'node:path'
import type { Nodes } from 'mdast'
import { fromMarkdown } from 'mdast-util-from-markdown'

// The caps, in lines, and the age of a page nobody links to before it is proposed for
// .archive/. The one place to change them.
export const FRONT_PAGE_MAX = 60
export const SECTION_README_MAX = 150
export const AGENTS_MAX = 40
export const STALE_DAYS = 365

// the files at the top of a root or layer that are not pages
const RESERVED = new Set(['README.md', 'AGENTS.md', 'CLAUDE.md', 'log.md'])
// `<host>/<owner>/<repo>:<path>`, each part as `ken path` takes it, in prose or a code span
const REFERENCE = /(?<![\w./:-])([\w-][\w.-]*\/[\w.-]+\/[\w.-]+):([^\s'"<>#,;*]+)/gi
const IS_REFERENCE = /^[\w-][\w.-]*\/[\w.-]+\/[\w.-]+:/

type Page = { path: string; listedBy: string[] }

const ken = (args: string[]) => spawnSync('ken', args, { encoding: 'utf8' })

/** A word for sh, whatever it holds. */
const quote = (word: string) => `'${word.replaceAll("'", `'\\''`)}'`

/**
 * The task folder, absolute, and the layer names of the root or layer `top`, from its `.ken` as
 * docs/files.md reads it: a repeated key is its last line, a value is trimmed. The layer's key is
 * the kernel's business. One it cannot read stops the lint, saying what is unknown.
 */
function readKen(top: string, unknown: string): { folder: string; layers: Set<string> } {
	const file = join(top, '.ken')
	let text: string
	try {
		text = readFileSync(file, 'utf8')
	} catch (e) {
		throw new Error(
			`${file} could not be read (${(e as Error).message}), ${unknown}. Every root holds a .ken, a layer's clone too: make it with \`ken init ${quote(top)}\`, then run \`ken lint\` again.`
		)
	}
	let folder = 'tasks'
	const layers = new Set<string>()
	for (const [i, line] of text.split('\n').entries()) {
		const at = `${file} line ${i + 1}, ${JSON.stringify(line)},`
		if (line.startsWith('task.folder=')) {
			folder = line.slice('task.folder='.length).trim()
			if (!folder) {
				throw new Error(
					`${at} sets task.folder to nothing, ${unknown}. It is a folder, relative to the root or absolute, like task.folder=tasks: fix the line, or delete it for the default, tasks.`
				)
			}
		} else if (line.startsWith('layer.')) {
			const eq = line.indexOf('=')
			const name = line.slice('layer.'.length, eq)
			// the name is a folder at the top, so one that climbs out of it is refused
			if (eq < 0 || !/^[A-Za-z0-9_.-]+$/.test(name) || /^\.\.?$/.test(name)) {
				throw new Error(
					`${at} is not a layer line, ${unknown}. It expects layer.<name>=<host>/<owner>/<repo>, lowercase, the name a folder at ${top}, such as layer.sales-atlas=github.com/acme/sales-atlas: fix or delete that line, then run \`ken lint\` again.`
				)
			}
			layers.add(name)
		}
	}
	return { folder: resolve(top, folder), layers }
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
	// The root and every layer reachable from it, each layer at its link, `<top>/<name>`, and the
	// task folders, which hold tasks, not pages: each one's from its own .ken, compared by real
	// path, so a link to a folder above one does not reach it either. An offline layer, its link
	// dangling, has nothing to read; a layer reached twice is read once.
	const tops = [root]
	const taskFolders = new Set<string>()
	const seen = new Set([realpathSync(root)]) // folders walked, or to be walked as a top
	for (const top of tops) {
		const own = readKen(
			top,
			top === root
				? 'so the task folder and the layers are unknown'
				: `at the layer ${relative(root, top)}, so its task folder and its layers are unknown`
		)
		taskFolders.add(existsSync(own.folder) ? realpathSync(own.folder) : own.folder)
		for (const name of own.layers) {
			const layer = join(top, name)
			if (!statSync(layer, { throwIfNoEntry: false })?.isDirectory()) continue
			if (seen.has(realpathSync(layer))) continue
			seen.add(realpathSync(layer))
			tops.push(layer)
		}
	}

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

	// The walk, as `find -L`: links followed, each folder read once, a layer as a top only. A page
	// is keyed by its real path, so a link that reaches it by another path still finds it.
	const pages = new Map<string, Page>()
	const readmes: string[] = []
	const topOf = new Map<string, string>() // file -> the root or layer it is in
	const walk = (dir: string, top: string) => {
		if (taskFolders.has(realpathSync(dir)) || seen.has(realpathSync(dir))) return
		seen.add(realpathSync(dir))
		for (const name of readdirSync(dir).sort()) {
			const path = join(dir, name)
			const stat = statSync(path, { throwIfNoEntry: false })
			if (name.startsWith('.') || !stat) continue
			if (stat.isDirectory()) walk(path, top)
			else if (name === 'README.md') readmes.push(path)
			else if (name.endsWith('.md')) pages.set(realpathSync(path), { path, listedBy: [] })
			topOf.set(path, top)
		}
	}
	for (const top of tops) {
		for (const name of readdirSync(top).sort()) {
			const path = join(top, name)
			if (name.startsWith('.')) continue
			const stat = statSync(path, { throwIfNoEntry: false })
			if (stat?.isDirectory()) walk(path, top)
			// a page at the top is in no section: reported below
			else if (stat && name.endsWith('.md') && !RESERVED.has(name)) {
				pages.set(realpathSync(path), { path, listedBy: [] })
				topOf.set(path, top)
			}
		}
		topOf.set(join(top, 'README.md'), top)
		cap(
			join(top, 'README.md'),
			FRONT_PAGE_MAX,
			'The front page is read first for every question: keep one line per section and layer and the few evergreen pages, and move the rest into pages.'
		)
	}
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
	const front = tops.map((t) => join(t, 'README.md')).filter((f) => existsSync(f))
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
			const top = topOf.get(file) ?? root
			const to = path.startsWith('/') ? join(top, path) : resolve(dirname(file), path)
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
		const top = topOf.get(page) ?? root
		if (dirname(page) === top) {
			report(
				'error',
				page,
				`a page at the top of ${top === root ? 'the root' : 'a layer'}, where only the front page and the reserved files live, so it is in no section. Move it into the section it belongs to with \`git mv\`, and add its line to that section's README.md.`
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
		const cd = `"$(ken path root)"${top === root ? '' : `/${quote(relative(root, top))}`}`
		const rel = relative(top, page)
		report(
			'note',
			page,
			`nobody links to it and nobody has changed it since ${new Date(changed).toISOString().slice(0, 10)}. If it is settled, propose archiving it: \`cd ${cd} && mkdir -p -- ${quote(join('.archive', dirname(rel)))} && git mv -- ${quote(rel)} ${quote(join('.archive', rel))}\`, then drop its line from its README.md.`
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
