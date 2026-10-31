import { existsSync, lstatSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
	type Document,
	isAlias,
	isMap as isMapNode,
	isNode,
	isSeq,
	parseDocument,
	stringify,
	visit
} from 'yaml'
import type { Command } from './command.ts'
import { parseKey, redact } from './key.ts'
import { codePath } from './path.ts'
import { locateRoot } from './root.ts'

export type Layer = { name: string; key: string }

/** The root's `.ken.yaml`: what `ken` reads, with the defaults filled in. */
export type KenYaml = {
	/** Org name to `<host>/<owner>`. */
	orgs: Record<string, string>
	clone: { blobless: boolean }
	/** Where `clone.blobless` came from. */
	bloblessFrom: '.ken.yaml' | 'default'
	/** In order: the first wins where layers overlap. */
	layers: Layer[]
	/** Every top-level key `ken` does not know, verbatim: other tools' sections (decision 11). */
	sections: Record<string, unknown>
}

const OWNER = /^[a-z0-9._-]+\/[a-z0-9._-]+$/
const NAME = /^[A-Za-z0-9._-]+$/

const isMap = (v: unknown): v is Record<string, unknown> =>
	typeof v === 'object' && v !== null && !Array.isArray(v)

/** Read `<root>/.ken.yaml`; a missing file is all defaults. The one reader the rest of `ken` uses. */
export function readKenYaml(root: string): KenYaml {
	const file = join(root, '.ken.yaml')
	function fail(key: string, expected: string, got: unknown): never {
		throw new Error(
			`${file}: ${key} must be ${expected}, got ${redact(JSON.stringify(got) ?? 'nothing')}, so ken cannot read its settings. ` +
				`Fix ${key} in ${file}, then run \`ken config\` to check.`
		)
	}
	const document = existsSync(file) ? parseDocument(readFileSync(file, 'utf8')) : undefined
	let parsed: unknown
	try {
		const [error] = document?.errors ?? []
		if (error) throw error
		// an alias to no anchor is no parse error, but fails here
		parsed = document?.toJS() ?? null
	} catch (e) {
		throw new Error(
			`${file} is not valid YAML, so ken cannot read its settings: ${redact((e as Error).message.trimEnd())}\n` +
				`Fix it, then run \`ken config\` to check.`
		)
	}
	const doc = parsed ?? {}
	if (!isMap(doc)) fail('the top level', 'a mapping of sections', parsed)
	const { orgs = {}, clone = {}, layers = [], ...sections } = doc as Record<string, unknown>
	if ('root' in sections) {
		fail(
			'root',
			'absent: the root is per machine, KEN_ROOT or "root" in config.json',
			sections.root
		)
	}

	const orgMap = orgs ?? {}
	if (!isMap(orgMap)) fail('orgs', 'a mapping of name to <host>/<owner>', orgs)
	for (const [name, owner] of Object.entries(orgMap)) {
		if (typeof owner !== 'string' || !OWNER.test(owner)) {
			fail(`orgs.${name}`, 'a lowercase <host>/<owner> like github.com/acme', owner)
		}
	}

	const cloneMap = clone ?? {}
	if (!isMap(cloneMap)) fail('clone', 'a mapping like { blobless: true }', clone)
	for (const key of Object.keys(cloneMap)) {
		if (key !== 'blobless') fail(`clone.${key}`, 'absent: clone takes only blobless', cloneMap[key])
	}
	const { blobless } = cloneMap
	if (blobless !== undefined && typeof blobless !== 'boolean') {
		fail('clone.blobless', 'true or false', blobless)
	}

	const list = layers ?? []
	if (!Array.isArray(list)) fail('layers', 'a list of { name, key }', layers)
	// ken layer add and remove edit the list in place, which an alias would make a copy or a share
	const layersNode = document?.get('layers', true)
	if (isNode(layersNode)) {
		visit(layersNode, (_, node) => {
			if (isAlias(node) || (isNode(node) && node.anchor)) {
				fail('layers', 'written out, with no YAML anchor or alias (&name, *name)', layers)
			}
		})
	}
	const parsedLayers = (list as unknown[]).map((layer, i): Layer => {
		const at = `layers[${i}]`
		if (!isMap(layer)) return fail(at, 'a mapping { name, key }', layer)
		const { name, key, ...rest } = layer
		const extra = Object.keys(rest)[0]
		if (extra !== undefined)
			fail(`${at}.${extra}`, 'absent: a layer has only name and key', rest[extra])
		if (typeof name !== 'string' || !NAME.test(name) || name === '.' || name === '..') {
			fail(`${at}.name`, 'a folder name at the root like sales-atlas', name)
		}
		if (typeof key !== 'string' || !isKey(key)) {
			fail(`${at}.key`, 'a lowercase repo key like github.com/acme/sales-atlas', key)
		}
		return { name: name as string, key: key as string }
	})

	return {
		orgs: orgMap as Record<string, string>,
		clone: { blobless: blobless ?? true },
		bloblessFrom: blobless === undefined ? 'default' : '.ken.yaml',
		layers: parsedLayers,
		sections
	}
}

function isKey(text: string): boolean {
	try {
		return parseKey(text).key === text
	} catch {
		return false
	}
}

/**
 * The one writer of `.ken.yaml`: read it, refusing what `readKenYaml` refuses, change the
 * document, write it beside and rename it over. Comments and every other key are kept.
 */
function editKenYaml(root: string, change: (doc: Document) => void): void {
	readKenYaml(root)
	const file = join(root, '.ken.yaml')
	const doc = parseDocument(existsSync(file) ? readFileSync(file, 'utf8') : '')
	change(doc)
	const tmp = `${file}.${process.pid}.tmp`
	try {
		writeFileSync(tmp, String(doc))
		renameSync(tmp, file)
	} catch (e) {
		rmSync(tmp, { force: true })
		throw e
	}
}

/** Append `layer` to `layers:`, made when missing or empty. */
export function addLayerEntry(root: string, layer: Layer): void {
	editKenYaml(root, (doc) => {
		const layers = doc.get('layers', true)
		if (isSeq(layers)) {
			layers.flow = false
			layers.add(doc.createNode(layer))
		} else doc.set('layers', doc.createNode([layer]))
	})
}

/** Remove the layer called `name` from `layers:`. */
export function removeLayerEntry(root: string, name: string): void {
	editKenYaml(root, (doc) => {
		const layers = doc.get('layers', true)
		if (!isSeq(layers)) return
		layers.items = layers.items.filter((l) => !(isMapNode(l) && l.get('name') === name))
		if (!layers.items.length) layers.flow = true
	})
}

type Setting<T> = { value: T; source: string }
type Effective = {
	root: Setting<string>
	clone: { blobless: Setting<boolean> }
	orgs: Record<string, string>
	layers: (Layer & { cloned: boolean; linked: boolean })[]
	[section: string]: unknown
}

/** What `ken config --json` prints: the settings, each with its source, then the other sections. */
function effective(): Effective {
	const { root, source } = locateRoot()
	const yaml = readKenYaml(root)
	return {
		root: { value: root, source },
		clone: { blobless: { value: yaml.clone.blobless, source: yaml.bloblessFrom } },
		orgs: yaml.orgs,
		layers: yaml.layers.map((l) => ({
			...l,
			cloned: existsSync(codePath(root, l.key)),
			linked: lstatSync(join(root, l.name), { throwIfNoEntry: false })?.isSymbolicLink() ?? false
		})),
		...yaml.sections
	}
}

function human({ root, clone, orgs, layers, ...sections }: Effective): string {
	const none = (list: unknown[]) => (list.length ? '' : ' none')
	const lines = [
		`root: ${root.value}  (${root.source})`,
		`clone.blobless: ${clone.blobless.value}  (${clone.blobless.source})`,
		`orgs:${none(Object.keys(orgs))}`,
		...Object.entries(orgs).map(([name, owner]) => `  ${name}: ${owner}`),
		`layers:${none(layers)}`,
		...layers.map(({ name, key, cloned, linked }) => {
			const missing = [
				...(cloned ? [] : [`no clone at .repos/${key}`]),
				...(linked ? [] : [`no link ${name} at the root`])
			]
			const hint = missing.length
				? `  (${missing.join(', ')}: run \`ken layer remove ${name} && ken layer add ${key} --as ${name}\`)`
				: ''
			return `  ${name}: ${key}${hint}`
		})
	]
	if (Object.keys(sections).length) {
		lines.push(
			'',
			'Other sections of .ken.yaml, kept for the tools that read them (`ken config --json | jq .<section>`):',
			stringify(sections).trimEnd()
		)
	}
	return lines.join('\n')
}

export const config: Command = {
	usage: 'config [--json]',
	summary:
		'Print the effective settings, where each came from, the layers, and every other section of .ken.yaml.',
	details: [
		'  root             KEN_ROOT (source environment), else "root" in ~/.config/ken/config.json,',
		'                   else ~/ken (source default)',
		'  clone.blobless   from .ken.yaml, else true (source default)',
		'  orgs, layers     from .ken.yaml; each layer says whether its clone and its link at the',
		'                   root exist',
		"  <section>        any other top-level key of .ken.yaml, verbatim: another tool's settings",
		'',
		'  --json           one object; a tool reads its own section from it'
	].join('\n'),
	examples: ['ken config', 'ken config --json | jq .task'],
	run(args) {
		const json = args[0] === '--json'
		if (args.length > (json ? 1 : 0)) {
			throw new Error(
				`ken config takes only --json, got ${JSON.stringify(args.join(' '))}. Run \`ken config\` or \`ken config --json\`.`
			)
		}
		return json ? JSON.stringify(effective(), null, 2) : human(effective())
	}
}
