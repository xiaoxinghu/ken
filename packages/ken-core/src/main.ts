// The entry of ken: the core commands, their help, and how a refusal ends (docs/prd.md, "The
// core"). The `ken` package calls `main` with its arguments.
import { readFileSync } from 'node:fs'
import { die, KenError, q } from './die.ts'
import { type Bundled, dispatch, extensions } from './dispatch.ts'
import { init } from './init.ts'
import { FORMAT, findRoot, locateRoot } from './root.ts'

const VERSION: string = JSON.parse(
	readFileSync(new URL('../package.json', import.meta.url), 'utf8')
).version

type Command = {
	usage: string
	summary: string
	details?: string
	examples: string
	run: (args: string[], options: Required<Options>) => string
}

/** What the package that runs ken adds to the core: its bundled commands, and its name and
 * version, which `ken version` prints. */
export type Options = { bundled?: Bundled; version?: string }

const none = (name: string, args: string[]) => {
	if (args.length)
		die(`ken ${name} takes no arguments, got ${args.map(q).join(' ')}. Run \`ken ${name}\`.`)
}

const COMMANDS: Record<string, Command> = {
	init: {
		usage: 'init [<dir>]',
		summary:
			'Make <dir>, default the current folder, a root: only the files ken owns, never overwriting.',
		details: `  .ken            settings, key=value lines, ken.format=${FORMAT}; holding one makes a root
  .repos.index    the index: what each repo is, one stanza per repo, cloned or not
  .gitignore      .env and .repos/, each added to one that lacks it
No page, no AGENTS.md, no .bin/: those are create-ken's and yours. No git init. A <dir>
inside a root is refused: roots do not nest. A .ken from before the rewrite, with no
ken.format, is left alone, and init names the migration.`,
		examples: `ken init ~/ken
cd ~/ken && ken init   # a rerun, or a clone of a root: nothing is created`,
		run: init
	},
	path: {
		usage: 'path root',
		summary: 'Print the root ken acts on, a real path.',
		details: `The root is KEN_ROOT when set, else the nearest folder holding .ken at or above the
current one. Outside one, ken stops, saying so.`,
		examples: `ken path root
cd "$(ken path root)"
KEN_ROOT=~/work ken path root`,
		run: (args) => {
			if (args.length !== 1 || args[0] !== 'root')
				die(
					`ken path takes root, got ${args.length ? args.map(q).join(' ') : 'nothing'}.`,
					'Run `ken path root`.'
				)
			return `${findRoot()}\n`
		}
	},
	help: {
		usage: 'help [<command>]',
		summary: 'Print every command with examples, or one in full as `ken <command> --help` does.',
		examples: `ken help
ken help init`,
		run: (args, options) => {
			if (args.length > 1) die('ken help takes one command. Run e.g. `ken help init`.')
			if (!args[0]) return help(options.bundled)
			const command = commandOf(args[0])
			if (!command)
				die(
					`${q(args[0])} is not a ken command, so ken help has no page for it.`,
					'Run `ken help` for every command.'
				)
			return page(command)
		}
	},
	version: {
		usage: 'version',
		summary: 'Print the version of this ken and the newest root format it reads.',
		examples: 'ken version',
		run: (args, options) => {
			none('version', args)
			return `${options.version}, reads ken.format ${FORMAT} and older\n`
		}
	}
}

/** The core command `name`, never a property every object inherits, such as constructor. */
const commandOf = (name: string) => (Object.hasOwn(COMMANDS, name) ? COMMANDS[name] : undefined)

const indent = (prefix: string, text: string) => text.replace(/^/gm, prefix)

const page = (command: Command) =>
	`ken ${command.usage}\n\n${command.summary}\n` +
	(command.details ? `\n${command.details}\n` : '') +
	`\nExamples:\n${indent('  ', command.examples)}\n`

const help = (bundled: Bundled) => {
	let root: string | undefined
	try {
		root = locateRoot()
	} catch {}
	const here = root
		? `Here the root is ${root}.`
		: 'Here there is no root: cd into one, set KEN_ROOT, or run `ken init <dir>`.'

	return `ken: the CLI of a ken root, a folder that is a knowledge base, every git checkout it
uses inside it in .repos/.

Usage: ken <command> [<args>]

Commands:
${Object.values(COMMANDS)
	.map((c) => `  ${c.usage}\n${indent('      ', `${c.summary}\n${c.examples}`)}\n`)
	.join('')}
${extensions(root, bundled, Object.keys(COMMANDS))}
The root is KEN_ROOT when set, else the nearest folder holding .ken at or above the current
one; outside one, every core command but init, help and version stops, saying so, and an
extension runs with KEN_ROOT unset and without the root's .bin/.
${here}
Run \`ken <command> --help\` for one command in full.
`
}

/** What a refusal says: its own message, or for a file ken could not reach, such as a folder
 * it may not enter, which path and how to look; any other error is a bug, thrown on. */
const refusal = (e: unknown) => {
	if (e instanceof KenError) return e.message
	const { code, path, syscall } = e as NodeJS.ErrnoException
	if (!code || !path) throw e
	return (
		`could not ${syscall ?? 'reach'} ${path}: ${code}, so ken cannot go on. Check who may read and` +
		` enter it and the folders above it, e.g. \`ls -ld ${q(path)}\`, then rerun.`
	)
}

/** Run ken with `args`, the command line after `ken`; print what it says and return the exit
 * status: a core command's, 1 when it refuses, its message on stderr, or the extension's. */
export const main = (
	args: string[],
	{ bundled = {}, version = `@unclex/ken-core ${VERSION}` }: Options = {}
) => {
	const core = Object.keys(COMMANDS)
	try {
		const [name = 'help', ...rest] = args
		const command = commandOf(name === '-h' || name === '--help' ? 'help' : name)
		if (!command) return dispatch(name, rest, bundled, core)
		// `ken help <name>`, <name> no core command, is the extension's own --help
		const [of = ''] = rest
		if (command === COMMANDS.help && rest.length === 1 && /^[^-]/.test(of) && !commandOf(of))
			return dispatch(of, ['--help'], bundled, core)
		const out = rest.some((a) => a === '-h' || a === '--help')
			? page(command)
			: command.run(rest, { bundled, version })
		process.stdout.write(out)
		return 0
	} catch (e) {
		process.stderr.write(`ken: ${refusal(e)}\n`)
		return 1
	}
}
