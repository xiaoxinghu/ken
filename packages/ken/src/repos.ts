import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { stringify } from 'yaml'
import { type Command, indent, shellWord } from './command.ts'
import { type Layer, readKenYaml } from './config.ts'
import { git } from './git.ts'
import { type Entry, indexFile, readIndex } from './index.ts'
import { parseKey, redact } from './key.ts'
import { codePath } from './path.ts'
import { findRoot } from './root.ts'

type Worktree = { path: string; branch: string | null }

/** One key of the merged index times the disk. */
export type Row = {
	key: string
	desc: string | null
	/** The workspace whose entry won, `root` or a layer's name; null when no index lists the key. */
	listedBy: string | null
	cloned: boolean
	/** The clone's branch; null when not cloned, or detached. */
	branch: string | null
	worktrees: Worktree[]
	/** What is out of place, each with the command that fixes it. */
	strays: string[]
}

type Index = { by: string; file: string; entries: Record<string, Entry> }
type Listed = { by: string; file: string; entry: Entry }

/** The root's index, then each cloned layer's in .ken.yaml order; a layer not cloned is noted on stderr. */
function indexes(root: string, layers: Layer[]): Index[] {
	const dirs = [{ by: 'root', dir: root }]
	for (const { name, key } of layers) {
		const dir = codePath(root, key)
		if (existsSync(dir)) dirs.push({ by: name, dir })
		else {
			process.stderr.write(
				`ken: the layer ${name} is not cloned at ${dir}, so the repos its index lists are left out. ` +
					`Run \`ken get ${key}\`.\n`
			)
		}
	}
	return dirs.map(({ by, dir }) => ({
		by,
		file: indexFile(dir),
		entries: readIndex(indexFile(dir))
	}))
}

/** Each key's entry from the first index that lists it: a whole entry wins by that order. */
function merge(all: Index[]): Record<string, Listed> {
	const merged: Record<string, Listed> = {}
	for (const { by, file, entries } of all) {
		for (const [key, entry] of Object.entries(entries)) merged[key] ??= { by, file, entry }
	}
	return merged
}

/** A clone is a folder whose `.git` is a folder; a worktree's `.git` is a file. */
const isClone = (dir: string): boolean =>
	statSync(join(dir, '.git'), { throwIfNoEntry: false })?.isDirectory() ?? false

const folders = (dir: string): string[] =>
	existsSync(dir)
		? readdirSync(dir, { withFileTypes: true })
				.filter((d) => d.isDirectory())
				.map((d) => d.name)
		: []

/** The keys cloned under `.repos/`: the clones among the folders at depth three. */
function clones(root: string): string[] {
	const repos = join(root, '.repos')
	return folders(repos).flatMap((host) =>
		folders(join(repos, host)).flatMap((owner) =>
			folders(join(repos, host, owner))
				.filter((folder) => isClone(join(repos, host, owner, folder)))
				.map((folder) => `${host}/${owner}/${folder}`)
		)
	)
}

/** `git worktree list` of a clone, the clone first; a worktree whose folder is gone is left out. */
const checkouts = (clone: string): Worktree[] =>
	git(clone, 'worktree', 'list', '--porcelain')
		.split('\n\n')
		.filter((record) => !/^prunable/m.test(record))
		.map((record) => {
			const path = /^worktree (.*)$/m.exec(record)?.[1] ?? ''
			return {
				path: existsSync(path) ? realpathSync.native(path) : path,
				branch: /^branch refs\/heads\/(.*)$/m.exec(record)?.[1] ?? null
			}
		})

function row(root: string, key: string, listed: Listed | undefined, cloned: boolean): Row {
	const desc = typeof listed?.entry.desc === 'string' ? listed.entry.desc : null
	const strays: string[] = []
	if (!listed && cloned) {
		strays.push(
			'cloned, but no index lists it, so an agent cannot choose it by its desc: ' +
				`run \`ken index set ${key} desc="..."\``
		)
	}
	if (listed && desc === null) {
		const layer = listed.by === 'root' ? '' : ` --layer ${listed.by}`
		strays.push(
			`its entry in ${listed.file} has no desc, so an agent cannot choose it before cloning: ` +
				`run \`ken index set ${key} desc="..."${layer}\``
		)
	}
	const base = { key, desc, listedBy: listed?.by ?? null, cloned }
	if (!cloned) return { ...base, branch: null, worktrees: [], strays }
	const clone = codePath(root, key)
	const [own, ...worktrees] = checkouts(clone)
	const branch = own?.branch ?? null
	const inClone = `git -C ${shellWord(clone)}`
	// the default branch is the remote's; a clone with no remote HEAD has none to hold
	const defaultBranch = git(
		clone,
		'for-each-ref',
		'--format=%(symref:lstrip=3)',
		'refs/remotes/origin/HEAD'
	)
	if (defaultBranch && branch !== defaultBranch) {
		const add = branch
			? `, then \`${inClone} worktree add ${shellWord(codePath(root, key, branch))} ${shellWord(branch)}\``
			: ''
		strays.push(
			`the clone is on ${branch ?? 'a detached HEAD'}, not its default branch ${defaultBranch}; a clone holds ` +
				'the default branch and every other branch is a worktree beside it: ' +
				`run \`${inClone} switch ${shellWord(defaultBranch)}\`${add}`
		)
	}
	for (const { path, branch: b } of worktrees) {
		// a detached worktree, such as one mid-rebase, has no branch to name its folder
		if (b === null) continue
		const want = codePath(root, key, b)
		if (path === want) continue
		const why =
			dirname(path) === dirname(clone)
				? `its folder does not match its branch ${b}, so \`ken path code ${key} ${b}\` points elsewhere`
				: `it holds ${b} outside the layout, where \`ken path code\` cannot find it and a session in it ` +
					"loads none of the root's context"
		strays.push(
			`the worktree ${path}: ${why}: run \`${inClone} worktree move ${shellWord(path)} ${shellWord(want)}\``
		)
	}
	return { ...base, branch, worktrees, strays }
}

/**
 * The text files under the root that contain `key`: hidden entries skipped, so nothing in
 * `.repos/`, and the layer links at the top followed, so a layer's pages are found through them.
 */
function mentions(root: string, key: string, layers: Layer[]): string[] {
	const found: string[] = []
	const walk = (dir: string, top: boolean) => {
		for (const e of readdirSync(dir, { withFileTypes: true })) {
			if (e.name.startsWith('.')) continue
			const path = join(dir, e.name)
			const layer =
				top &&
				e.isSymbolicLink() &&
				layers.some((l) => l.name === e.name) &&
				statSync(path, { throwIfNoEntry: false })?.isDirectory()
			if (e.isDirectory() || layer) walk(path, false)
			else if (e.isFile()) {
				const bytes = readFileSync(path)
				if (!bytes.includes(0) && bytes.includes(key)) found.push(path)
			}
		}
	}
	walk(root, true)
	return found.sort()
}

function show(r: Row): string {
	const listed = r.listedBy ? `listed by ${r.listedBy}` : 'in no index'
	const cloned = r.cloned ? `cloned on ${r.branch ?? 'a detached HEAD'}` : 'not cloned'
	return [
		`${r.key}  ${listed}, ${cloned}`,
		...(r.desc ? [`  ${r.desc}`] : []),
		...r.worktrees.map((w) => `  worktree ${w.branch ?? '(detached)'}  ${w.path}`),
		...r.strays.map((s) => `  stray: ${s}`)
	].join('\n')
}

export const repos: Command = {
	usage: 'repos [<key>] [--layer <name>] [--json]',
	summary:
		'The merged index times the disk: every repo with its desc, who listed it, its clone and worktrees, and every stray.',
	details: [
		"  (none)          every key of the merged index, the root's .repos/index.yaml then each",
		"                  layer's in .ken.yaml order (a whole entry wins by that order), and every",
		'                  clone under .repos/: its desc, which workspace listed it, its branch, its',
		'                  worktrees, and each stray with the command that fixes it',
		'  <key>           that repo: the same, its whole entry, then the files under the root that',
		"                  mention the key (hidden entries skipped, layers' pages through their links)",
		"  --layer <name>  only the keys that workspace's index lists; root names the root's own",
		'  --json          one array of {key, desc, listedBy, cloned, branch, worktrees, strays};',
		'                  for a <key>, one object with entry and mentions too',
		'',
		'A stray is a clone no index lists, an entry with no desc, a clone not on its default branch',
		'(origin/HEAD), a worktree whose folder does not match its branch, or a worktree outside the',
		'layout. Offline: reads the indexes and asks git about each clone, nothing else.'
	].join('\n'),
	examples: [
		'ken repos',
		'ken repos --layer sales-atlas',
		'ken repos github.com/acme/join-web   # its entry, checkouts, and the pages that mention it',
		"ken repos --json | jq -r '.[] | select(.cloned | not) | .key'   # listed, not cloned yet"
	],
	run(args) {
		const json = args.includes('--json')
		const i = args.indexOf('--layer')
		const layerName = i < 0 ? undefined : args[i + 1]
		const rest = (i < 0 ? args : args.toSpliced(i, 2)).filter((a) => a !== '--json')
		const [input] = rest
		if (
			rest.length > 1 ||
			input?.startsWith('-') ||
			(i >= 0 && (!layerName || input !== undefined))
		) {
			throw new Error(
				`ken repos takes a <key>, or --layer <name>, and --json, got ${JSON.stringify(redact(args.join(' ')))}. ` +
					'Run e.g. `ken repos`, `ken repos --layer root`, `ken repos github.com/acme/join-web`, or `ken repos --help`.'
			)
		}
		const root = findRoot()
		const { layers } = readKenYaml(root)
		if (
			layerName !== undefined &&
			layerName !== 'root' &&
			!layers.some((l) => l.name === layerName)
		) {
			throw new Error(
				`${JSON.stringify(layerName)} is not a layer of this root, so it lists no repos. ` +
					`Pass root for the root's own, or one of the layers in ${join(root, '.ken.yaml')}: ` +
					`${layers.map((l) => l.name).join(', ') || 'none yet'}.`
			)
		}
		const all = indexes(root, layers)
		const merged = merge(all)
		if (input !== undefined) {
			const { key } = parseKey(input)
			const listed = merged[key]
			const r = row(root, key, listed, isClone(codePath(root, key)))
			const files = mentions(root, key, layers)
			if (json)
				return JSON.stringify({ ...r, entry: listed?.entry ?? null, mentions: files }, null, 2)
			return [
				show(r),
				...(listed
					? ['', `Entry, from ${listed.file}:`, indent(stringify(listed.entry).trimEnd(), '  ')]
					: []),
				'',
				...(files.length
					? ['Mentioned in:', ...files.map((f) => `  ${f}`)]
					: [`Mentioned in no file under ${root}.`])
			].join('\n')
		}
		const cloned = new Set(clones(root))
		const keep = all.find((x) => x.by === layerName)?.entries
		const rows = [...new Set([...Object.keys(merged), ...cloned])]
			.filter((key) => layerName === undefined || (keep && Object.hasOwn(keep, key)))
			.sort()
			.map((key) => row(root, key, merged[key], cloned.has(key)))
		if (json) return JSON.stringify(rows, null, 2)
		if (!rows.length) {
			return layerName === undefined
				? `No repos: no index lists one and nothing is cloned under ${join(root, '.repos')}. ` +
						'Run `ken get <key>` to clone and register one.'
				: `The ${layerName} index lists no repos. Run \`ken index set <key> desc="..."` +
						`${layerName === 'root' ? '' : ` --layer ${layerName}`}\` to add one.`
		}
		return rows.map(show).join('\n')
	}
}
