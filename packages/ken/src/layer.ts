import {
	existsSync,
	lstatSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	readlinkSync,
	statSync,
	symlinkSync,
	unlinkSync,
	writeFileSync
} from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { type Command, shellWord } from './command.ts'
import { addLayerEntry, readKenYaml, removeLayerEntry } from './config.ts'
import { get } from './get.ts'
import { parseKey, redact } from './key.ts'
import { codePath } from './path.ts'
import { findRoot } from './root.ts'

/** The names at the root that are not sections (PRD "Reserved names"). */
const RESERVED = [
	'.repos',
	'.bin',
	'.ken.yaml',
	'.agents',
	'.claude',
	'.codex',
	'.pi',
	'.envrc',
	'AGENTS.md',
	'CLAUDE.md',
	'log.md',
	'README.md'
]
const NAME = /^[A-Za-z0-9._-]+$/

/** The target of `link`, taken as written, when it is a symlink. */
const linkTarget = (link: string): string | undefined =>
	lstatSync(link, { throwIfNoEntry: false })?.isSymbolicLink()
		? resolve(dirname(link), readlinkSync(link))
		: undefined

/** Whether `link` is a symlink to a file inside `dir`. */
const linksInto = (link: string, dir: string): boolean =>
	linkTarget(link)?.startsWith(dir + sep) ?? false

/** Each `.repos/<host>/<owner>/AGENTS.md` under `dir`, relative to `dir`, through no folder link. */
function ownerFiles(dir: string): string[] {
	const folders = (path: string) =>
		existsSync(path)
			? readdirSync(path, { withFileTypes: true }).filter((e) => e.isDirectory())
			: []
	return folders(join(dir, '.repos')).flatMap((host) =>
		folders(join(dir, '.repos', host.name))
			.map((owner) => join('.repos', host.name, owner.name, 'AGENTS.md'))
			.filter((file) => lstatSync(join(dir, file), { throwIfNoEntry: false }) !== undefined)
	)
}

/** The first line of prose of the README in `dir`: not blank, not a heading. */
function firstProse(dir: string): string | undefined {
	const file = join(dir, 'README.md')
	if (!statSync(file, { throwIfNoEntry: false })?.isFile()) return undefined
	return readFileSync(file, 'utf8')
		.split('\n')
		.map((l) => l.trim())
		.find((l) => l && !l.startsWith('#'))
}

const entryPrefix = (name: string) => `- [${name}](${name}/README.md)`

/** The lines of the `## Layers` section: its heading and the index of the next heading, or -1. */
function layersSection(lines: string[]): { heading: number; end: number } {
	const heading = lines.findIndex((l) => l.trim() === '## Layers')
	const next = lines.findIndex((l, i) => heading >= 0 && i > heading && /^#{1,2} /.test(l))
	return { heading, end: next < 0 ? lines.length : next }
}

/** The line of the layer `name` under `## Layers`, or -1. */
function entryLine(lines: string[], name: string): number {
	const { heading, end } = layersSection(lines)
	const at = lines.findIndex((l, i) => i > heading && i < end && l.startsWith(entryPrefix(name)))
	return heading < 0 ? -1 : at
}

/** Add `line` at the end of `## Layers` in the front page, made at the end when missing. */
function addFrontPageLine(file: string, name: string, line: string): boolean {
	const lines = existsSync(file) ? readFileSync(file, 'utf8').split('\n') : ['']
	if (entryLine(lines, name) >= 0) return false
	if (layersSection(lines).heading < 0) {
		while (lines.length && lines.at(-1) === '') lines.pop()
		lines.push(...(lines.length ? [''] : []), '## Layers', '')
	}
	const { heading, end } = layersSection(lines)
	let last = end - 1
	while (last > heading && !lines[last]?.trim()) last--
	const before = last === heading ? [''] : []
	const after = lines[last + 1]?.trim() ? [''] : []
	lines.splice(last + 1, 0, ...before, line, ...after)
	writeFileSync(file, `${lines.join('\n').replace(/\n*$/, '')}\n`)
	return true
}

/** Remove the layer's line under `## Layers`, and the blank line it no longer needs. */
function removeFrontPageLine(file: string, name: string): boolean {
	if (!existsSync(file)) return false
	const lines = readFileSync(file, 'utf8').split('\n')
	const at = entryLine(lines, name)
	if (at < 0) return false
	lines.splice(at, 1)
	if (at > 0 && lines[at - 1] === '' && (lines[at] ?? '') === '') lines.splice(at - 1, 1)
	writeFileSync(file, lines.join('\n'))
	return true
}

/**
 * Install the repo `input` names as a layer called `name`, default the repo name: clone it, link
 * it at the root, link its owner-level AGENTS.md where the root has none, add its front-page line,
 * then record it in `.ken.yaml`. Every step checks before acting, so a rerun after a failure
 * finishes the job; the `.ken.yaml` entry comes last, so a layer in it is a layer complete.
 */
export function addLayer(root: string, input: string, as?: string): string {
	const { key } = parseKey(input)
	const name = as ?? key.slice(key.lastIndexOf('/') + 1)
	const clone = codePath(root, key)
	const link = join(root, name)
	const { layers } = readKenYaml(root)
	const other = `Pick another name with \`ken layer add ${key} --as <name>\`.`
	if (!NAME.test(name) || name === '.' || name === '..') {
		throw new Error(
			`${JSON.stringify(redact(name))} is not a folder name for the root, so it cannot name the layer: ` +
				`use letters, digits, ., _ and -. ${other}`
		)
	}
	if (RESERVED.some((r) => r.toLowerCase() === name.toLowerCase())) {
		throw new Error(
			`${name} is reserved at the root (${RESERVED.join(', ')}), so the layer cannot be linked there. ${other}`
		)
	}
	const same = layers.find((l) => l.key === key)
	if (same) {
		throw new Error(
			`${key} is already the layer ${same.name} in ${join(root, '.ken.yaml')}, so there is nothing to add. ` +
				`Update it with \`git -C "$(ken path layer ${same.name})" pull\`; to add it again, ` +
				`run \`ken layer remove ${same.name}\` first.`
		)
	}
	const taken = layers.find((l) => l.name === name)
	if (taken) {
		throw new Error(
			`${name} is already the layer of ${taken.key} in ${join(root, '.ken.yaml')}, and two layers cannot share a name. ${other}`
		)
	}
	// our own link, left by an add that failed halfway, is no clash
	const stat = lstatSync(link, { throwIfNoEntry: false })
	if (stat && linkTarget(link) !== clone) {
		const what = stat.isSymbolicLink() ? 'a link' : stat.isDirectory() ? 'a section' : 'a file'
		throw new Error(
			`${link} is already ${what}, so the layer cannot be linked there; ken leaves it untouched. ${other}`
		)
	}

	const done: string[] = []
	const cloned = existsSync(clone)
	// a new index entry gets the line the front page shows, so the layer's repo is no stray
	get(root, input, process.env, firstProse)
	done.push(cloned ? `used the clone at .repos/${key}` : `cloned .repos/${key}`)
	const changed: string[] = []
	if (!stat) {
		symlinkSync(join('.repos', key), link)
		done.push(`linked ${name} -> .repos/${key}`)
	}
	changed.push(name)
	for (const file of ownerFiles(clone)) {
		const own = join(root, file)
		// get checked .repos; a link at the host or owner would put this one outside the root
		const outside = [dirname(dirname(file)), dirname(file)].find((f) =>
			lstatSync(join(root, f), { throwIfNoEntry: false })?.isSymbolicLink()
		)
		if (outside) {
			done.push(
				`left ${file}: ${outside} is a symlink, so a link in it would be outside the root. Replace ` +
					`it with a folder, then run \`ken layer remove ${name} && ken layer add ${key} --as ${name}\``
			)
		} else if (linksInto(own, clone)) changed.push(file)
		else if (lstatSync(own, { throwIfNoEntry: false })) {
			done.push(`left ${file}: the root has its own, which wins over the layer's`)
		} else {
			mkdirSync(dirname(own), { recursive: true })
			symlinkSync(relative(dirname(own), join(clone, file)), own)
			done.push(`linked ${file} -> the layer's`)
			changed.push(file)
		}
	}
	const prose = firstProse(clone)
	const line = `${entryPrefix(name)}${prose ? `: ${prose}` : ''}`
	if (addFrontPageLine(join(root, 'README.md'), name, line)) {
		done.push(`added "${line}" under ## Layers in README.md`)
	}
	addLayerEntry(root, { name, key })
	done.push(`recorded { name: ${name}, key: ${key} } under layers: in .ken.yaml`)
	return [
		`Added the layer ${name}, ${key}, to ${root}:`,
		...done.map((d) => `  ${d}`),
		'',
		'Next: commit it to the root, ' +
			`\`git -C ${shellWord(root)} add -- ${[...changed, '.ken.yaml', 'README.md', '.repos/index.yaml'].map(shellWord).join(' ')}\`, ` +
			`then list the repos it brings with \`ken repos --layer ${name}\`.`
	].join('\n')
}

/**
 * Undo `addLayer`: the front-page line, the owner links into the layer's clone, the root link,
 * then the `.ken.yaml` entry, last so a rerun after a failure still knows the key. The clone stays.
 */
export function removeLayer(root: string, name: string): string {
	const { layers } = readKenYaml(root)
	const layer = layers.find((l) => l.name === name)
	if (!layer) {
		return (
			`${name} is not a layer in ${join(root, '.ken.yaml')}, so there is nothing to remove. ` +
			(layers.length
				? `The layers are ${layers.map((l) => l.name).join(', ')}.`
				: 'It lists no layers.')
		)
	}
	const { key } = layer
	const clone = codePath(root, key)
	const done: string[] = []
	const changed: string[] = []
	if (removeFrontPageLine(join(root, 'README.md'), name)) {
		done.push('removed its line under ## Layers in README.md')
	}
	for (const file of ownerFiles(root)) {
		if (!linksInto(join(root, file), clone)) continue
		unlinkSync(join(root, file))
		done.push(`removed the link ${file}`)
		changed.push(file)
	}
	const link = join(root, name)
	if (linkTarget(link) === clone) {
		unlinkSync(link)
		done.push(`removed the link ${name}`)
		changed.push(name)
	} else if (lstatSync(link, { throwIfNoEntry: false })) {
		done.push(`left ${name}: it is not the link to .repos/${key}`)
	}
	removeLayerEntry(root, name)
	done.push('removed its entry under layers: in .ken.yaml')
	// what is gone now, whether this run or an earlier one that failed halfway removed it
	const gone = [...new Set([...changed, name, ...ownerFiles(clone)])].filter(
		(p) => !lstatSync(join(root, p), { throwIfNoEntry: false })
	)
	const git = `git -C ${shellWord(root)}`
	const untrack = gone.length
		? `${git} rm -q --cached --ignore-unmatch -- ${gone.map(shellWord).join(' ')} && `
		: ''
	return [
		`Removed the layer ${name}, ${key}, from ${root}:`,
		...done.map((d) => `  ${d}`),
		'',
		`The clone stays at ${clone}; delete it with \`rm -rf "$(ken path code ${key})"\` when no longer needed.`,
		`Next: commit the removal, \`${untrack}${git} add -- .ken.yaml README.md\`.`
	].join('\n')
}

export const layer: Command = {
	usage: 'layer add <url|key> [--as <name>] | layer remove <name>',
	summary: 'Install a shared, root-shaped repo as a section of the root, or take it out again.',
	details: [
		'  add <url|key> [--as <name>]   clone it to .repos/<key> as `ken get` does; link it at the',
		'                                root as <name>, default the repo name; link each of its',
		'                                .repos/<host>/<owner>/AGENTS.md where the root has none; add',
		'                                its line under ## Layers in README.md; record it under',
		'                                layers: in .ken.yaml. Refuses a reserved name, a name',
		'                                already at the root or in .ken.yaml, and a key already a',
		'                                layer, before anything is written.',
		'  remove <name>                 undo add: the front-page line, the owner links into its',
		'                                clone, the root link, the .ken.yaml entry. The clone stays.',
		'',
		'Each step checks before acting, so either is safe to rerun after a failure halfway.'
	].join('\n'),
	examples: [
		'ken layer add github.com/acme/sales-atlas',
		'ken layer add git@github.com:acme/atlas.git --as sales-atlas',
		'git -C "$(ken path layer sales-atlas)" pull   # update a layer',
		'rm -rf "$(ken path layer sales-atlas)" && ken layer remove sales-atlas   # and its clone'
	],
	run([action, ...args]) {
		const i = args.indexOf('--as')
		const as = i < 0 ? undefined : args[i + 1]
		const rest = i < 0 ? args : args.toSpliced(i, 2)
		const [what] = rest
		if (action === 'add' && rest.length === 1 && what && (i < 0 || as)) {
			return addLayer(findRoot(), what, as)
		}
		if (action === 'remove' && i < 0 && rest.length === 1 && what) {
			return removeLayer(findRoot(), what)
		}
		throw new Error(
			`ken layer takes add <url|key> [--as <name>] or remove <name>, got ${JSON.stringify(redact([action, ...args].join(' ')))}. ` +
				'Run e.g. `ken layer add github.com/acme/sales-atlas`, or `ken layer --help`.'
		)
	}
}
