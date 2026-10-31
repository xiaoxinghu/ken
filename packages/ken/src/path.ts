import { existsSync, realpathSync, statSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { branchFolder } from './branch.ts'
import type { Command } from './command.ts'
import { readKenYaml } from './config.ts'
import { parseKey, redact } from './key.ts'
import { findRoot } from './root.ts'

/** A repo's clone, `.repos/<key>`, or the worktree of one of its branches beside it. */
export function codePath(root: string, key: string, branch?: string): string {
	const clone = join(root, '.repos', key)
	return branch === undefined ? clone : `${clone}.${branchFolder(branch)}`
}

const FORMS =
	'root, repos, bin, layer <name>, code <key> [<branch>], <key>:<path>[#<symbol>], or a file'
// `<host>/<owner>/<repo>:`; a path starting with `.` or `/` is a file
const REFERENCE = /^([^./:\s][^/:\s]*\/[^/:\s]+\/[^/:\s]+):([^#]*)/

const escapes = (rel: string) => rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)

/** The clone of the layer called `name` in `.ken.yaml`. */
function layerPath(root: string, name: string): string {
	const { layers } = readKenYaml(root)
	const layer = layers.find((l) => l.name === name)
	if (layer) return codePath(root, layer.key)
	throw new Error(
		`${JSON.stringify(name)} is not a layer of ${root}: ` +
			(layers.length
				? `the layers in .ken.yaml are ${layers.map((l) => l.name).join(', ')}. Run e.g. \`ken path layer ${layers[0]?.name}\`.`
				: '.ken.yaml lists none. Add one with `ken layer add <key> --as <name>`.')
	)
}

/** `<clone>/<path>` of a code reference; when not cloned, the repo's URL, and stderr says so. */
function referencePath(root: string, ref: string, key: string, path: string): string {
	const clone = codePath(root, key)
	const file = join(clone, path)
	if (escapes(relative(clone, file))) {
		throw new Error(
			`${JSON.stringify(ref)} points outside its repo: the path after the colon is relative to the ` +
				`repo's root and cannot climb out of it. Write it as ${key}:<path>[#<symbol>].`
		)
	}
	if (existsSync(clone)) return file
	process.stderr.write(
		`ken: ${key} is not cloned here, so ${path || 'its root'} has no local path; printed the repo's URL instead. ` +
			`Run \`ken get ${key}\` to clone it, then \`ken path ${ref}\` again.\n`
	)
	return `https://${key}.git`
}

/**
 * The README chain of `what`: the `README.md` of each folder from the root down to the file's
 * own, those that exist, then the file; a folder ends with its own README. Taken logically, not
 * through realpath, so a page in a layer's section goes through the layer's link (decision 8).
 */
function readmeChain(root: string, what: string): string {
	// the shell's logical cwd, when it is where we are, so a relative path keeps its links
	const pwd = process.env.PWD
	const cwd =
		pwd && existsSync(pwd) && realpathSync.native(pwd) === realpathSync.native(process.cwd())
			? pwd
			: process.cwd()
	const abs = resolve(cwd, what)
	const stat = statSync(abs, { throwIfNoEntry: false })
	if (!stat) {
		throw new Error(
			`ken path does not resolve ${JSON.stringify(redact(what))}: it is not a word, a code reference ` +
				`or an existing file or folder. It takes ${FORMS}. Run \`ken path --help\` for what each prints.`
		)
	}
	// the deepest folder on the way that is the root by real path: decision 15 spelled any way
	let top = abs
	while (!existsSync(top) || realpathSync.native(top) !== root) {
		if (top === dirname(top)) {
			throw new Error(
				`${abs} is not under the ken root ${root}, so it has no README chain: the chain runs from ` +
					`${join(root, 'README.md')} down. Pass a file under ${root}, or set KEN_ROOT to the root it is in.`
			)
		}
		top = dirname(top)
	}
	const parts = relative(top, abs).split(sep).filter(Boolean)
	const folders = stat.isDirectory() ? parts : parts.slice(0, -1)
	const chain = [root, ...folders.map((_, i) => join(root, ...folders.slice(0, i + 1)))]
		.map((dir) => join(dir, 'README.md'))
		.filter((readme) => existsSync(readme))
	return [...chain, ...(stat.isDirectory() ? [] : [join(root, ...parts)])].join('\n')
}

export const path: Command = {
	usage: 'path <what>',
	summary: 'Print a path in the root, whether or not it exists. Nobody pastes absolute paths.',
	details: [
		'  root                    the root, as a real path',
		'  repos                   <root>/.repos, where every checkout lives',
		"  bin                     <root>/.bin, the root's ken-* scripts",
		"  layer <name>            the layer's clone, <root>/.repos/<key>, by its name in .ken.yaml",
		'  code <key> [<branch>]   the clone, <root>/.repos/<key>, or the worktree of <branch> beside',
		'                          it, <root>/.repos/<key>.<branch> with / as -. <key> is',
		'                          <host>/<owner>/<repo> or a git URL.',
		'  <key>:<path>[#<symbol>] a code reference: <clone>/<path> when the repo is cloned; the symbol',
		'                          is yours to find in the file. Not cloned: https://<key>.git, and',
		'                          stderr says to run `ken get <key>`; exit 0.',
		'  <file>                  its README chain: the README.md of each folder from the root down to',
		'                          its own, those that exist, then the file, one per line; through a',
		"                          layer's link as written. A folder ends with its own README.md.",
		'',
		'The words come first, then a <host>/<owner>/<repo>: prefix is a reference, anything else a',
		'file: a file named like a word is ./root.'
	].join('\n'),
	examples: [
		'ken path root',
		'ken path layer sales-atlas',
		'ken path code github.com/acme/join-web',
		'ken path code github.com/acme/join-web feat/login   # .../join-web.feat-login',
		'cd "$(ken path code git@github.com:acme/join-web.git PROJ-123)"',
		'ken path github.com/acme/join-web:src/join.ts#submit',
		'ken path sales-atlas/systems/join.md   # the READMEs above it, root first, then the page'
	],
	run([what, ...args]) {
		switch (what) {
			case 'root':
			case 'repos':
			case 'bin': {
				if (args.length) {
					throw new Error(`ken path ${what} takes no arguments. Run \`ken path ${what}\`.`)
				}
				const root = findRoot()
				return what === 'root' ? root : join(root, `.${what}`)
			}
			case 'layer': {
				const [name] = args
				if (!name || args.length > 1) {
					throw new Error(
						`ken path layer takes one <name>, got ${args.length} arguments. Run e.g. \`ken path layer sales-atlas\`; \`ken config\` lists the layers.`
					)
				}
				return layerPath(findRoot(), name)
			}
			case 'code': {
				const [input, branch] = args
				if (!input || args.length > 2) {
					throw new Error(
						`ken path code takes <key> [<branch>], got ${args.length} arguments. ` +
							'Run e.g. `ken path code github.com/acme/join-web feat/login`.'
					)
				}
				const { key } = parseKey(input)
				if (branch !== undefined) branchFolder(branch)
				return codePath(findRoot(), key, branch)
			}
			case undefined:
				throw new Error(
					`ken path needs what to print: it takes ${FORMS}. Run \`ken path --help\` for what each prints.`
				)
			default: {
				if (args.length) {
					throw new Error(
						`ken path takes one <what>, got ${JSON.stringify(redact([what, ...args].join(' ')))}. ` +
							'Quote a path with spaces. Run `ken path --help` for the forms.'
					)
				}
				const ref = REFERENCE.exec(what)
				if (ref) return referencePath(findRoot(), what, parseKey(ref[1] ?? '').key, ref[2] ?? '')
				return readmeChain(findRoot(), what)
			}
		}
	}
}
