// The root ken acts on, found as git finds a repository, and the format it declares (PRD 4, 9).
import { readFileSync, realpathSync, statSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { die, q } from './die.ts'
import { parseSettings } from './files.ts'

/** The newest `ken.format` this ken reads. */
export const FORMAT = 1

/** Whether `path` is a file, through any links. */
export const isFile = (path: string) => statSync(path, { throwIfNoEntry: false })?.isFile() ?? false

/** The real path of `path`, which need not exist: its longest existing part made real, for the
 * case a case-insensitive disk stores, the rest as written (PRD 22). */
export const realPath = (path: string): string => {
	const abs = resolve(path)
	try {
		return realpathSync.native(abs)
	} catch {
		const up = dirname(abs)
		return up === abs ? abs : join(realPath(up), basename(abs))
	}
}

/** The nearest folder at or above `dir`, a real path, that holds a `.ken` file. */
export const nearest = (dir: string) => {
	for (let at = dir; ; at = dirname(at)) {
		if (isFile(join(at, '.ken'))) return at
		if (dirname(at) === at) return undefined
	}
}

/** The root, a real path: `KEN_ROOT` when set, else the nearest `.ken` above the current folder,
 * never from where ken is installed. Its format is not checked: see `findRoot`. */
export const locateRoot = () => {
	const env = process.env.KEN_ROOT
	if (env) {
		const dir = resolve(env)
		const stat = statSync(dir, { throwIfNoEntry: false })
		if (!stat?.isDirectory())
			die(
				`KEN_ROOT is ${dir}, which ${stat ? 'is not a folder' : 'does not exist'}, and ken acts on the`,
				'root KEN_ROOT names. Set KEN_ROOT to a root, or unset it to find the root from the',
				`current folder; \`ken init ${q(dir)}\` makes a root there.`
			)
		const root = realpathSync.native(dir)
		if (!isFile(join(root, '.ken')))
			die(
				`KEN_ROOT is ${root}, which holds no .ken file, and only a .ken makes a folder a root.`,
				`Set KEN_ROOT to a root, or unset it; \`ken init ${q(root)}\` makes ${root} one.`
			)
		return root
	}
	const here = realpathSync.native(process.cwd())
	return (
		nearest(here) ??
		die(
			`${here} is in no ken root: no folder at or above it holds .ken, and KEN_ROOT is unset,`,
			'so there is no root to act on. cd into a root, or set KEN_ROOT to one, e.g.',
			'`export KEN_ROOT=~/ken`; `ken init <dir>` makes one.'
		)
	)
}

/** The root, as `locateRoot` finds it, in a format this ken reads. */
export const findRoot = () => {
	const root = locateRoot()
	checkFormat(root)
	return root
}

/** Stop unless the `.ken` of `root` declares a format this ken reads. */
export const checkFormat = (root: string) => {
	const file = join(root, '.ken')
	let text = ''
	try {
		text = readFileSync(file, 'utf8')
	} catch (e) {
		die(
			`could not read ${file}: ${(e as Error).message}, so ken cannot tell the format of ${root}.`,
			`Make it readable, e.g. \`chmod u+r ${q(file)}\`, then rerun.`
		)
	}
	const format = parseSettings(text, file).get('ken.format')
	if (format === undefined)
		die(
			`${file} has no ken.format line, so ${root} is a root from before the rewrite of ken: its index`,
			'is the file .repos and its checkouts are outside it, which this ken does not read.',
			'Migrate it by hand, once, as "From before the rewrite" in docs/prd.md says:',
			'https://github.com/xiaoxinghu/ken/blob/main/docs/prd.md#from-before-the-rewrite.',
			'Until then, run the ken it was made with.'
		)
	else if (!/^[1-9][0-9]*$/.test(format)) {
		const line = text.split('\n').findLastIndex((l) => l.startsWith('ken.format=')) + 1
		die(
			`${file} line ${line}, ken.format=${format}, is not a format ken can read: it expects a`,
			`positive integer, ${FORMAT} for a root made by this ken. Fix that line, then rerun.`
		)
	} else if (Number(format) > FORMAT)
		die(
			`${file} says ken.format=${format}, and this ken reads formats up to ${FORMAT}, so it is too old`,
			`for ${root} and would misread it. Upgrade ken, e.g. \`npm install -g @unclex/ken@latest\`,`,
			'then rerun; `ken version` says which ken runs.'
		)
}

/** The root as `findRoot` finds it, or undefined when there is none to find: KEN_ROOT unset and
 * no `.ken` at or above the current folder. */
export const rootIfAny = () =>
	process.env.KEN_ROOT || nearest(realpathSync.native(process.cwd())) ? findRoot() : undefined
