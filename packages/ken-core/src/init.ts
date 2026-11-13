// `ken init [<dir>]`: make a folder a root with only the files ken owns, never overwriting.
import {
	appendFileSync,
	lstatSync,
	mkdirSync,
	readFileSync,
	realpathSync,
	writeFileSync
} from 'node:fs'
import { dirname, join } from 'node:path'
import { die, KenError, q } from './die.ts'
import { checkFormat, FORMAT, isFile, locateRoot, nearest, realPath } from './root.ts'

export const init = (args: string[]) => {
	if (args.length > 1)
		die(
			`ken init takes one folder, got ${args.length} arguments. Quote a path with spaces;`,
			'run e.g. `ken init ~/ken`.'
		)
	const arg = args[0] ?? '.'
	if (arg.startsWith('-'))
		die(
			`ken init does not take ${q(arg)}: it takes one folder, default the current one.`,
			'Run `ken init --help`.'
		)
	const dir = realPath(arg)
	const up = dirname(dir) === dir ? undefined : nearest(dirname(dir))
	const beside = up && q(join(dirname(up), 'other'))
	if (up && dir.startsWith(`${up}/.repos/`))
		die(
			`${dir} is inside ${up}/.repos, where the root ${up} keeps its checkouts, and roots do not`,
			`nest. A root to read is cloned there by \`ken get <key>\` with its own .ken; a new root`,
			`goes outside ${up}, e.g. \`ken init ${beside}\`.`
		)
	if (up)
		die(
			`${dir} is inside the root ${up}, and roots do not nest: ken run there would act on the`,
			`new root, hidden in ${up}'s knowledge base. Make it a section of ${up}, a folder with a`,
			`README.md and no .ken; or make a root beside ${up}, e.g. \`ken init ${beside}\`.`
		)
	const ken = join(dir, '.ken')
	const there = lstatSync(ken, { throwIfNoEntry: false })
	if (there && !isFile(ken))
		die(
			`${ken} is there but is not a file, and only a .ken file makes a folder a root, so ken`,
			`would never find ${dir} as one. Move it aside, then run \`ken init ${q(dir)}\` again.`
		)
	// a root from before the rewrite, or for a newer ken, is left alone, saying why
	if (there) checkFormat(dir)

	const must = <T>(what: string, act: () => T): T => {
		try {
			return act()
		} catch (e) {
			if (e instanceof KenError) throw e
			return die(
				`could not ${what}: ${(e as Error).message}. So ${dir} is not a root yet.`,
				`Fix that, then run \`ken init ${q(dir)}\` again.`
			)
		}
	}
	must(`make ${dir}`, () => mkdirSync(dir, { recursive: true }))
	const root = realpathSync.native(dir)
	const made: string[] = []
	const create = (name: string, text: string) =>
		must(`write ${join(root, name)}`, () => {
			try {
				writeFileSync(join(root, name), text, { flag: 'wx' })
				made.push(name)
			} catch (e) {
				if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e
			}
		})
	create(
		'.ken',
		'# ken settings: <key>=<value> lines, the first segment of a key naming its tool.\n' +
			'# The format is docs/files.md in github.com/xiaoxinghu/ken.\n' +
			`ken.format=${FORMAT}\n`
	)
	create(
		'.repos.index',
		"# .repos.index: what each repo is. Whether it exists is the remote's business.\n"
	)
	const ignore = join(root, '.gitignore')
	const text = isFile(ignore) ? must(`read ${ignore}`, () => readFileSync(ignore, 'utf8')) : ''
	const have = new Set(text.split('\n').map((line) => line.trimEnd()))
	const lacking = ['.env', '.repos/'].filter((line) => !have.has(line))
	if (lacking.length) {
		// a last line without its newline gets one, so each rule is a line of its own
		const add = `${text && !text.endsWith('\n') ? '\n' : ''}${lacking.join('\n')}\n`
		must(`add to ${ignore}`, () => appendFileSync(ignore, add))
		made.push('.gitignore')
	}

	let out = made.length
		? `${root} is a root. Made or added to:\n${made.map((name) => `  ${name}\n`).join('')}` +
			`Track them with \`git -C ${q(root)} add ${made.join(' ')}\`, after \`git -C ${q(root)} init\`` +
			' if it is not a repository.\n'
		: `${root} is a root already, with every file ken owns: nothing was created.\n`
	let here: string | undefined
	try {
		here = locateRoot()
	} catch {}
	if (here !== root)
		out += process.env.KEN_ROOT
			? `KEN_ROOT is ${process.env.KEN_ROOT}, so ken acts on that, not ${root}. To work in it,` +
				` unset KEN_ROOT and run \`cd ${q(root)}\`.\n`
			: `ken run from here finds ${here ?? 'no root'}, not ${root}. To work in it, run \`cd ${q(root)}\`.\n`
	return out
}
