import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import {
	type Document,
	isAlias,
	isCollection,
	isMap,
	isNode,
	isScalar,
	LineCounter,
	type Node,
	parseDocument,
	Scalar,
	visit,
	type YAMLMap
} from 'yaml'
import type { Command } from './command.ts'
import { readKenYaml } from './config.ts'
import { parseKey, redact } from './key.ts'
import { codePath } from './path.ts'
import { findRoot } from './root.ts'

/** An index entry: `desc`, when there, a non-empty string; every other field as written. */
export type Entry = Record<string, unknown>

/** A workspace's index, `<dir>/.repos/index.yaml`: the root's, or a layer's in its clone. */
export const indexFile = (dir: string): string => join(dir, '.repos', 'index.yaml')

type Parsed = { doc: Document; entries: Record<string, Entry> }

/**
 * Read and validate the index at `file`, nested `<host>/<owner>: { desc?, repos: { <repo>: entry } }`
 * (PRD "The index"), into entries keyed by `<host>/<owner>/<repo>`. A missing file is empty.
 */
export const readIndex = (file: string): Record<string, Entry> => load(file).entries

function load(file: string): Parsed {
	const text = existsSync(file) ? readFileSync(file, 'utf8') : ''
	const lines = new LineCounter()
	const doc = parseDocument(text, { lineCounter: lines })
	const [error] = doc.errors
	if (error) {
		throw new Error(
			`${file} is not valid YAML, so ken cannot read the index: ${redact(error.message.trimEnd())}\n` +
				'Fix that line, then rerun.'
		)
	}
	const at = (node: unknown) => {
		const start = (node as Node | undefined)?.range?.[0]
		return start === undefined ? file : `${file}:${lines.linePos(start).line}`
	}
	return {
		doc,
		entries: validate(doc, (node, what) => `${at(node)}: ${what}. Fix that line, then rerun.`)
	}
}

/** The entries of `doc`; throws `fail(node, what)` at the first thing the index cannot hold. */
function validate(
	doc: Document,
	fail: (node: unknown, what: string) => string
): Record<string, Entry> {
	const refuse = (node: unknown, what: string): never => {
		throw new Error(fail(node, `${what}, so ken cannot read the index`))
	}
	// set and unset edit one entry at a time, which would cut a shared value off from its uses
	visit(doc, (_, node) => {
		if (isAlias(node) || (isNode(node) && node.anchor)) {
			refuse(
				node,
				'a YAML anchor or alias (&name, *name) is not supported; write the value out in each place'
			)
		}
	})
	const mapOf = (node: unknown, what: string): YAMLMap | undefined => {
		if (node == null || (isScalar(node) && node.value == null)) return undefined
		if (!isMap(node)) return refuse(node, `${what} must be a mapping`)
		return node
	}
	const checkDesc = (map: YAMLMap | undefined, what: string) => {
		const desc = map?.get('desc', true)
		if (
			desc !== undefined &&
			!(isScalar(desc) && typeof desc.value === 'string' && desc.value.trim())
		) {
			refuse(desc ?? map, `the desc of ${what} must be a non-empty string`)
		}
	}
	// ken looks keys up by string, so a key YAML reads as a number or boolean would never be found
	const textOf = (key: unknown): string => {
		const value = isScalar(key) ? key.value : key
		if (typeof value !== 'string') {
			refuse(key, `the key ${String(value)} is not a string (quote it: "${String(value)}")`)
		}
		return value as string
	}
	const entries: Record<string, Entry> = {}
	for (const owner of mapOf(doc.contents, 'the top level, owners like github.com/acme,')?.items ??
		[]) {
		const name = textOf(owner.key)
		if (!isKey(`${name}/repo`)) {
			refuse(
				owner.key,
				`${JSON.stringify(name)} is not a lowercase <host>/<owner> like github.com/acme`
			)
		}
		const ownerMap = mapOf(owner.value, name)
		checkDesc(ownerMap, name)
		for (const repo of mapOf(ownerMap?.get('repos', true), `${name} repos`)?.items ?? []) {
			const key = `${name}/${textOf(repo.key)}`
			if (!isKey(key)) refuse(repo.key, `${JSON.stringify(key)} is not a lowercase repo key`)
			const entry = mapOf(repo.value, key)
			for (const field of entry?.items ?? []) textOf(field.key)
			checkDesc(entry, key)
			entries[key] = (entry?.toJSON() as Entry | undefined) ?? {}
		}
	}
	return entries
}

/** A map key as text: a parsed key is a Scalar, one ken adds is the string itself. */
const nameOf = (key: unknown): string => String(isScalar(key) ? key.value : key)

function isKey(text: string): boolean {
	try {
		return parseKey(text).key === text
	} catch {
		return false
	}
}

/** The map at `path`, made when missing or null; an empty one is written as a block from now on. */
function mapAt(doc: Document, path: string[]): YAMLMap {
	const node = path.length ? doc.getIn(path, true) : doc.contents
	if (isMap(node)) {
		if (!node.items.length) node.flow = false
		return node
	}
	const map = doc.createNode({}) as YAMLMap
	// a comment on an empty entry, `join-web: # by sales`, goes first in the map that replaces it
	if (isNode(node))
		map.commentBefore = [node.commentBefore, node.comment].filter(Boolean).join('\n')
	if (path.length) doc.setIn(path, map)
	else doc.contents = map
	return map
}

/** Read `file`, change it, validate the result, write it beside and rename it over. */
function edit(file: string, change: (doc: Document) => void): void {
	const { doc } = load(file)
	change(doc)
	validate(doc, (_, what) => `${file} would not be a valid index: ${what}. Nothing was written.`)
	mkdirSync(dirname(file), { recursive: true })
	const tmp = `${file}.${process.pid}.tmp`
	try {
		writeFileSync(tmp, String(doc))
		renameSync(tmp, file)
	} catch (e) {
		rmSync(tmp, { force: true })
		throw e
	}
}

const pathOf = (key: string): string[] => {
	const i = key.lastIndexOf('/')
	return [key.slice(0, i), 'repos', key.slice(i + 1)]
}

/** Write `fields` into the entry of `key`, creating it and its owner when missing. */
export function setFields(file: string, key: string, fields: Record<string, unknown>): void {
	edit(file, (doc) => {
		const path = pathOf(key)
		// setIn cannot pass through a null owner or repos, so make each map on the way
		for (let n = 0; n < path.length; n++) mapAt(doc, path.slice(0, n))
		const entry = mapAt(doc, path)
		for (const [field, value] of Object.entries(fields)) {
			const old = entry.get(field, true)
			const node = doc.createNode(value)
			if (isNode(old))
				Object.assign(node, { comment: old.comment, commentBefore: old.commentBefore })
			entry.set(field, node)
		}
	})
}

/**
 * Remove `fields` from the entry of `key`, or with none the whole entry, then an owner left with
 * nothing in it. Refuses a key with no entry, or a field the entry lacks, naming what is there.
 */
export function unsetFields(file: string, key: string, fields: string[]): void {
	edit(file, (doc) => {
		const path = pathOf(key)
		if (!doc.hasIn(path)) {
			throw new Error(
				`${key} has no entry in ${file}, so there is nothing to unset. Run \`ken repos\` for the keys listed, and check the --layer.`
			)
		}
		const entry = doc.getIn(path, true)
		const has = isMap(entry) ? entry.items.map((p) => nameOf(p.key)) : []
		const missing = fields.filter((f) => !has.includes(f))
		if (missing.length) {
			throw new Error(
				`${key} has no ${missing.join(', ')} in ${file}; its fields are ${has.join(', ') || 'none'}. ` +
					`Run \`ken index unset ${key} <field>...\` with those, or \`ken index unset ${key}\` for the whole entry.`
			)
		}
		if (!fields.length) doc.deleteIn(path)
		for (const field of fields) doc.deleteIn([...path, field])
		const [owner = ''] = path
		const repos = doc.getIn([owner, 'repos'], true)
		if (isMap(repos) && !repos.items.length) doc.deleteIn([owner, 'repos'])
		const left = doc.getIn([owner], true)
		if (!isMap(left) || !left.items.length) doc.deleteIn([owner])
	})
}

/** A `<field>=<value>` value: a YAML flow value, else the text as written. */
function parseValue(field: string, text: string): Node {
	const doc = parseDocument(text)
	const node = doc.contents
	const flow = isScalar(node) || (isCollection(node) && node.flow)
	if (!doc.errors.length && !doc.warnings.length && flow && !node.comment && !doc.comment)
		return node
	if (/^\s*["'[{]/.test(text)) {
		throw new Error(
			`${field}=${redact(text)} starts like a YAML flow value but is not one, so ken cannot tell what to write. ` +
				`Close it, e.g. ${field}='[a, b]' or ${field}='"a text"', quoting it for the shell.`
		)
	}
	return new Scalar(text)
}

const FIELD = /^[A-Za-z0-9_][A-Za-z0-9_.-]*$/

export const index: Command = {
	usage: 'index set|unset <key> [<field>[=<value>]...] [--layer <name>]',
	summary: "Write fields into the index's entry for a repo, or remove them or the entry.",
	details: [
		'  set <key> <field>=<value>...   create the entry and its owner when missing, and set each',
		'                                 field. A value is a YAML flow value: [a, b] is a list, 3 a',
		'                                 number, anything else that is no flow value the text as',
		'                                 written. desc, when set, is a non-empty string.',
		'  unset <key> [<field>...]       remove the fields, or with none the whole entry; an owner',
		'                                 left with nothing goes too. desc alone cannot be unset.',
		'  --layer <name>                 the index of that layer, .repos/<layer key>/.repos/index.yaml,',
		"                                 instead of the root's .repos/index.yaml",
		'',
		'Comments, order and fields ken does not know are kept. The file is validated, written',
		'beside and renamed over, so a reader never sees half of it.'
	].join('\n'),
	examples: [
		'ken index set github.com/acme/join-web desc="Front end for the join funnel" \'tags=[sales, join]\'',
		'ken index set github.com/acme/join-api kind=api --layer sales-atlas',
		'ken index unset github.com/acme/join-web tags',
		'ken index unset github.com/acme/old-repo'
	],
	run(args) {
		const i = args.indexOf('--layer')
		const layerName = i < 0 ? undefined : args[i + 1]
		const [action, input, ...rest] = i < 0 ? args : args.toSpliced(i, 2)
		if ((action !== 'set' && action !== 'unset') || !input || (i >= 0 && !layerName)) {
			throw new Error(
				'ken index takes set <key> <field>=<value>... or unset <key> [<field>...], and --layer <name> after either. ' +
					'Run e.g. `ken index set github.com/acme/join-web desc="Front end"`, or `ken index --help`.'
			)
		}
		const { key } = parseKey(input)
		const root = findRoot()
		let dir = root
		if (layerName !== undefined) {
			const { layers } = readKenYaml(root)
			const layer = layers.find((l) => l.name === layerName)
			if (!layer) {
				throw new Error(
					`${JSON.stringify(layerName)} is not a layer of this root, so it has no index to write. ` +
						(layers.length
							? `The layers in ${join(root, '.ken.yaml')} are ${layers.map((l) => l.name).join(', ')}.`
							: `${join(root, '.ken.yaml')} lists no layers: add one with \`ken layer add <key>\`, or leave out --layer.`)
				)
			}
			dir = codePath(root, layer.key)
			if (!existsSync(dir)) {
				throw new Error(
					`the layer ${layer.name} is not cloned at ${dir}, so its index cannot be written. Run \`ken get ${layer.key}\` to clone it again.`
				)
			}
		}
		const file = indexFile(dir)
		const bad = rest.find(
			(a) =>
				!FIELD.test(action === 'set' ? (a.split('=')[0] ?? '') : a) ||
				(action === 'set' && !a.includes('='))
		)
		if (bad !== undefined || (action === 'set' && !rest.length)) {
			throw new Error(
				`${action === 'set' ? 'ken index set takes <field>=<value>' : 'ken index unset takes field names'}` +
					`${bad === undefined ? ' after the key' : `, got ${JSON.stringify(redact(bad))}`}: a field is letters, digits, _, . and -. ` +
					(action === 'set'
						? `Run e.g. \`ken index set ${key} desc="What the repo is"\`.`
						: `Run e.g. \`ken index unset ${key} tags\`, or \`ken index unset ${key}\` for the whole entry.`)
			)
		}
		if (action === 'unset') {
			if (rest.includes('desc')) {
				throw new Error(
					`desc is what lets an agent choose ${key} before cloning it, so it is changed, not removed. ` +
						`Run \`ken index set ${key} desc="..."\`, or \`ken index unset ${key}\` to remove the whole entry.`
				)
			}
			unsetFields(file, key, rest)
			return rest.length
				? `Removed ${rest.join(', ')} from ${key} in ${file}.`
				: `Removed ${key} from ${file}.`
		}
		const fields = Object.fromEntries(
			rest.map((a) => {
				const field = a.slice(0, a.indexOf('='))
				return [field, parseValue(field, a.slice(a.indexOf('=') + 1))]
			})
		)
		const desc = fields.desc
		if (
			desc !== undefined &&
			!(isScalar(desc) && typeof desc.value === 'string' && desc.value.trim())
		) {
			throw new Error(
				`desc must be a non-empty string, a line that lets an agent choose ${key} before cloning it. ` +
					`Run \`ken index set ${key} desc="What the repo is"\`; quote a text that YAML reads otherwise, e.g. desc='"2024"'.`
			)
		}
		setFields(file, key, fields)
		return `Set ${Object.keys(fields).join(', ')} of ${key} in ${file}.`
	}
}
