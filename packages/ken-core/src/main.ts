// The entry of ken: the core commands, their help, and how a refusal ends (docs/prd.md, "The
// core"). The `ken` package calls `main` with its arguments.
import { readFileSync } from 'node:fs'
import { die, KenError, q } from './die.ts'
import { type Bundled, dispatch, extensions } from './dispatch.ts'
import { get } from './get.ts'
import { init } from './init.ts'
import { path, which } from './layout.ts'
import { indexSet } from './registry.ts'
import { repos } from './repos.ts'
import { FORMAT, locateRoot } from './root.ts'

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
		usage: 'path root | code <key> [<branch>] | <key>:<path>[#<symbol>]',
		summary: 'Print a path, whether or not it exists. Nobody pastes absolute paths.',
		details: `  root                     the root ken acts on, a real path: KEN_ROOT when set, else
                           the nearest folder holding .ken at or above the current one
  code <key> [<branch>]    the clone, <root>/.repos/<key>, or the worktree of <branch>
                           beside it, <key>.<branch> with / as -. <key> is
                           <host>/<owner>/<repo> or a git URL.
  <key>:<path>[#<symbol>]  a code reference: <clone>/<path> when the repo is cloned, the
                           symbol yours to find in the file. Not cloned: https://<key>.git,
                           and stderr says to run \`ken get <key>\`; exit 0.`,
		examples: `ken path root
ken path code github.com/acme/join-web
ken path code github.com/acme/join-web feat/login   # .../join-web.feat-login
cd "$(ken path code git@github.com:acme/join-web.git PROJ-123)"
ken path github.com/acme/join-web:src/join.ts#submit`,
		run: path
	},
	which: {
		usage: 'which [<path>]',
		summary:
			'The reverse of `ken path code`: the key of the checkout a path is in, and its branch.',
		details: `  <path>   default the current folder, compared as a real path against <root>/.repos.
           Prints \`<key> <clone|worktree> [<branch>]\`. A checkout is asked of git, a
           worktree keyed by its clone; a path not checked out yet is answered from its
           shape with no branch: <repo>.<x> beside a clone <repo> is its worktree. A
           detached HEAD prints no branch. Outside a checkout folder,
           <root>/.repos/<host>/<owner>/<folder>, it exits 1 saying so and what to run.`,
		examples: `ken which
ken which "$(ken path code github.com/acme/join-web feat/login)"   # github.com/acme/join-web worktree feat/login
ken which "$(ken path code github.com/acme/api)/src/x.ts"   # not cloned yet: github.com/acme/api clone`,
		run: which
	},
	get: {
		usage: 'get <url|key> [-b <branch> [--from <ref>]]',
		summary:
			'Make a repo ready in <root>/.repos and print its clone, or with -b a worktree, the only thing on stdout.',
		details: `  <url|key>        <host>/<owner>/<repo>, cloned from https://<key>.git, or a git URL.
  -b <branch>      the worktree of <branch> beside the clone, <root>/.repos/<key>.<branch>
                   with / as -: a new branch from the default branch (what the clone has
                   checked out) as it stands; an existing one checked out there, or where it
                   already is. The default branch prints the clone. Nothing is copied or run.
  --from <ref>     start a new branch from <ref>, a tag, commit or branch, instead.
Missing, the repo is cloned: blobless, unless .ken says clone.blobless=false; a failed clone
leaves no folder. A clone already there is used as it is, no fetch; anything else there, or
at the worktree's folder (in any case), is refused untouched. A fresh clone or worktree with
AGENTS.md and no CLAUDE.md gets CLAUDE.md -> AGENTS.md, excluded from git. Every time: the
clone gets worktree.useRelativePaths and \`git worktree repair\`, and when .repos.index does
not list the key, an entry. Refused when the root is in git and .repos/ is not in its
.gitignore, and for the root's own repo. Needs git 2.48 or newer.`,
		examples: `ken get github.com/acme/join-web
ken get git@github.com:acme/join-web.git
cd "$(ken get github.com/acme/join-web)"
cd "$(ken get github.com/acme/join-web -b feat/login)"   # .../join-web.feat-login
ken get github.com/acme/join-web -b fix/pay --from v1.2.0`,
		run: get
	},
	repos: {
		usage: 'repos [--porcelain]',
		summary: 'Every repo .repos.index lists, against the checkouts in <root>/.repos, offline.',
		details: `One row per key, sorted: <key>  listed|not listed, cloned on <branch>|not cloned; then its
desc, its worktrees, and each stray with the command that fixes it: no desc; a clone no entry
lists; a clone not on its default branch, origin/HEAD; a worktree whose folder does not match
its branch. A clone with no remote-tracking branch, nothing fetched or pushed, is local only.
  --porcelain   one line per key, tab-separated: key, desc, listed (true or false),
                cloned (true or false), branch; empty fields empty.`,
		examples: `ken repos
ken repos --porcelain | awk -F"\t" '$3 == "true" && $4 == "false" { print $1 }'   # listed, not cloned
rg -l github.com/acme/join-web "$(ken path root)"   # the pages that mention a repo`,
		run: repos
	},
	index: {
		usage: 'index set <key> <field>=<value>...',
		summary: 'Write fields into the index, .repos.index, creating the file and the entry.',
		details: `A field name is letters, digits, _ and -, not repo; a value is the rest of the argument as
written, one line, not empty, a list its items separated by spaces: tags="sales join". Only
that one stanza changes: every other line, comment and order is kept, and the file is written
beside and renamed over. To remove a field or an entry, edit the file: a stanza is the lines
from \`repo: <key>\` to the next blank line (docs/files.md).`,
		examples: `ken index set github.com/acme/join-web desc="Front end for the join funnel." kind=frontend
ken index set github.com/acme/join-web tags="sales join" depends_on=join-api
ken index set github.com/acme/join-web doc=systems/join.md   # the page that says more`,
		run: indexSet
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
