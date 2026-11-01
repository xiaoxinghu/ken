import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, relative, resolve, sep } from 'node:path'
import { type Command, shellWord } from './command.ts'
import { readKenYaml } from './config.ts'
import { get } from './get.ts'
import { gitWith } from './git.ts'
import { codePath } from './path.ts'
import { configPath, configuredRoot } from './root.ts'
import { locate } from './which.ts'

/** The root `.gitignore` rules: the clones and worktrees at depth three, and secrets. */
const IGNORE = ['.repos/*/*/*/', '.env']

const frontPage = (name: string) => `# ${name}

A knowledge base kept by you and your agents. Replace this line with what it is for.

## Sections

## Layers
`

const agents = (name: string) => `# ${name}

A ken root: a knowledge base, one git repo, with any repos it needs checked out inside it.
Pushed, another root can add it as a layer; read there, \`ken\` works on that root, not this.
Start at the front page, README.md: what this is for, its sections, its layers.

## Knowledge

- A section is a folder at the top with a README.md listing its pages, one line each. Make
  one when a topic needs it, and add its line under \`## Sections\` in README.md.
- A page is a Markdown file in one section, linked from its README.md by relative path.
- A layer is a section shared by a team: a link to the clone of its repo, made by
  \`ken layer add <key>\`. Change it in that repo, never here.
- Names starting with \`.\`, and AGENTS.md, CLAUDE.md, log.md and README.md, are not sections.
- Commit what you change: the root is synced by git and nothing else.

## Code

- \`.repos/<host>/<owner>/<repo>/\` is a clone on its default branch, and
  \`.repos/<host>/<owner>/<repo>.<branch>/\` a worktree beside it, \`/\` in the branch as \`-\`.
- \`.repos/index.yaml\` describes every repo, cloned or not. \`.ken.yaml\` holds settings.
- \`.bin/\` holds \`ken-<name>\` scripts, run as \`ken <name>\`.
- Name code as \`<key>:<path>#<symbol>\`, never by a line number or an absolute path.

## Commands

- \`ken path code <key> [<branch>]\`: the clone or worktree of a repo key such as
  github.com/acme/join-web. \`ken path <file>\`: the README.md chain down to a file.
- \`ken which\`: the repo key and branch of the current folder.
- \`ken get <key> [-b <branch>]\`: clone the repo, or make the branch's worktree, and print
  its path. The one way code gets into \`.repos/\`.
- \`ken repos [<key>]\`: every repo the index lists, and what is cloned.

Everything else is git, run against the path \`ken path\` prints. \`ken help\` for the rest.
`

/** The key of the clone `target` is, or will be, in `root`'s layout; undefined for anything else. */
function cloneAt(target: string, root: string): string | undefined {
	const parts = relative(root, target).split(sep)
	if (parts.length !== 4 || parts[0] !== '.repos') return undefined
	try {
		// a worktree beside a clone is a branch of that repo, not a place for another root
		const place = locate(target, root)
		return place.kind === 'clone' ? place.key : undefined
	} catch {
		return undefined
	}
}

/** The real path of `path`, which may not exist yet: its nearest existing ancestor, resolved. */
function realPath(path: string): string {
	const missing: string[] = []
	let p = resolve(path)
	while (!existsSync(p)) {
		missing.unshift(basename(p))
		p = dirname(p)
	}
	return join(realpathSync.native(p), ...missing)
}

/**
 * The environment for the clones `init` makes unasked, one per layer: git may neither prompt nor
 * wait forever. A user's own ssh command is kept, the options added to it.
 */
export function unattended(root: string, env = process.env): NodeJS.ProcessEnv {
	// git's own order: GIT_SSH_COMMAND, core.sshCommand, then GIT_SSH, a program that may take no -o
	const ssh =
		env.GIT_SSH_COMMAND ||
		gitWith(env, root, 'config', '--default=', 'core.sshCommand') ||
		(env.GIT_SSH ? undefined : 'ssh')
	return {
		...env,
		GIT_TERMINAL_PROMPT: '0',
		// empty, so git asks no GIT_ASKPASS, core.askPass or SSH_ASKPASS program either
		GIT_ASKPASS: '',
		GIT_HTTP_LOW_SPEED_LIMIT: '1000',
		GIT_HTTP_LOW_SPEED_TIME: '30',
		...(ssh && { GIT_SSH_COMMAND: withSshOptions(ssh) })
	}
}

const SSH_OPTIONS =
	'-o BatchMode=yes -o ConnectTimeout=15 -o ServerAliveInterval=15 -o ServerAliveCountMax=2'
/** The word of a shell command that runs ssh: `ssh` or a path to it, quoted or not, never a `NAME=value`. */
const SSH_WORD = /(^|\s)("(?:[^"]*\/)?ssh"|'(?:[^']*\/)?ssh'|(?:[^\s"'=]*\/)?ssh)(?=\s|$)/

/**
 * `command` with the unattended ssh options right after its ssh word, since ssh takes the first
 * value given for an option, so a prefix such as `env NAME=value` is kept; with none, a wrapper,
 * they are appended.
 */
const withSshOptions = (command: string): string =>
	SSH_WORD.test(command)
		? command.replace(SSH_WORD, `$1$2 ${SSH_OPTIONS}`)
		: `${command} ${SSH_OPTIONS}`

/**
 * Get each layer `.ken.yaml` lists whose clone is missing, in order; say which. One that cannot be
 * cloned is offline on this machine, said on stderr: nothing is written, so a later run gets it.
 */
function getLayers(root: string): string[] {
	const got: string[] = []
	let env: NodeJS.ProcessEnv | undefined
	for (const { name, key } of readKenYaml(root).layers) {
		if (existsSync(codePath(root, key))) continue
		env ??= unattended(root)
		try {
			get(root, key, env)
			got.push(`  ${name}: cloned .repos/${key}, so its section and owner links resolve`)
		} catch (e) {
			// only a failed clone has a cause; anything else is wrong here, not unreachable
			if (!(e instanceof Error && e.cause instanceof Error)) throw e
			process.stderr.write(
				`ken: the layer ${name} (${key}) is offline on this machine: it could not be cloned. ${e.cause.message}\n` +
					`The rest of the root works without it: its section ${name} and owner links stay dangling, and its ` +
					`index and scripts are left out. Once it can be reached, run \`ken init ${shellWord(root)}\` again.\n`
			)
		}
	}
	return got.length ? ['', 'Got the layers .ken.yaml lists:', ...got] : []
}

/** Create in `dir` the skeleton ken owns, only what is missing, then get the missing layers; say what was made and what next. */
export function init(dir: string, env = process.env): string {
	const target = realPath(dir)
	// a layer is a root that lives in another's layout, at a repo's place: the one root allowed inside one
	let outer: { root: string; key: string } | undefined
	for (let a = dirname(target); a !== dirname(a); a = dirname(a)) {
		if (existsSync(join(a, '.ken.yaml'))) {
			const key = outer ? undefined : cloneAt(target, a)
			if (key) {
				outer = { root: a, key }
				continue
			}
			throw new Error(
				`${target} is inside the ken root ${a} (it holds .ken.yaml), and a root inside a root ` +
					`would split one knowledge base and its checkouts in two. Use ${a} as it is, ` +
					'or run `ken init <dir>` on a folder outside it, or on a repo of its own at ' +
					'`ken path code <key>`, to make a layer there.'
			)
		}
	}
	const created: string[] = []
	const create = (file: string, text: string) => {
		try {
			writeFileSync(join(target, file), text, { flag: 'wx' })
			created.push(file)
		} catch (e) {
			if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e
		}
	}
	for (const folder of ['.repos', '.bin']) {
		if (!existsSync(join(target, folder))) {
			mkdirSync(join(target, folder), { recursive: true })
			created.push(`${folder}/`)
		}
	}
	create(
		'.repos/index.yaml',
		"# .repos/index.yaml: what each repo is. Whether it exists is the remote's business.\n"
	)
	create(
		'.ken.yaml',
		'# This root\'s settings: orgs, clone, layers, and a section per tool. See "Configuration"\n' +
			'# in docs/prd.md of github.com/xiaoxinghu/ken.\n'
	)
	const gitignore = join(target, '.gitignore')
	const ignored = existsSync(gitignore) ? readFileSync(gitignore, 'utf8') : undefined
	// git strips a line's trailing spaces but not its leading ones: ` .env` ignores no `.env`
	const lines = new Set(ignored?.split('\n').map((l) => l.trimEnd()))
	const missing = IGNORE.filter((rule) => !lines.has(rule))
	if (ignored === undefined) create('.gitignore', `${IGNORE.join('\n')}\n`)
	else if (missing.length) {
		const sep = ignored === '' || ignored.endsWith('\n') ? '' : '\n'
		writeFileSync(gitignore, `${ignored}${sep}${missing.join('\n')}\n`)
		created.push(`${missing.join(' and ')} in .gitignore`)
	}
	create('README.md', frontPage(basename(target)))
	create('AGENTS.md', agents(basename(target)))

	const out = created.length
		? [`Created in ${target}:`, ...created.map((c) => `  ${c}`)]
		: [`Nothing to create: ${target} already has every file ken init makes, and none was changed.`]
	out.push(...getLayers(target))
	const configured = configuredRoot(env)
	if (outer) {
		out.push(
			'',
			`${target} is ${outer.key} in the layout of the root ${outer.root}, where a layer lives. ` +
				'Commit it, then add it to that root as a layer, ' +
				`\`KEN_ROOT=${shellWord(outer.root)} ken layer add ${outer.key}\`; it stays local until you push it.`
		)
	} else if (!existsSync(configured.path) || realpathSync.native(configured.path) !== target) {
		out.push(
			'',
			`${target} is not the configured root, ${configured.path} (from ${configured.from}), ` +
				'so ken commands will not find it. Point ken at it with',
			`  export KEN_ROOT='${target.replaceAll("'", "'\\''")}'`,
			`or put {"root": ${JSON.stringify(target)}} in ${configPath(env)}.`
		)
	}
	return out.join('\n')
}

export const initCommand: Command = {
	usage: 'init [<dir>]',
	summary:
		'Create the skeleton ken owns in <dir>, default the current folder, only what is missing, and install its layers.',
	details: [
		'  .repos/index.yaml, .ken.yaml, .bin/, a .gitignore holding .repos/*/*/*/ and .env (only',
		'  the lines it lacks), and a front page README.md and AGENTS.md. Never overwrites a file,',
		'  so a second run creates nothing. Refuses a <dir> inside another root (a folder holding',
		'  .ken.yaml). Does not git init.',
		'',
		'Then installs the layers: clones each layer .ken.yaml lists whose clone is missing, as',
		'`ken get` does, so its tracked root link and owner links resolve; a clone already there is',
		'left alone, no fetch. These clones never prompt or wait forever. A layer that cannot be',
		'cloned is offline on this machine: said on stderr with the reason, init still exits 0, and',
		'nothing is written, so running ken init again once it can be reached gets it.'
	].join('\n'),
	examples: [
		'ken init',
		'ken init ~/ken',
		'git init ~/work && ken init ~/work',
		'git clone <root url> ~/ken && ken init ~/ken   # the root and every layer it lists'
	],
	run(args) {
		if (args.length > 1) {
			throw new Error(
				`ken init takes at most one <dir>, got ${args.length} arguments. Run e.g. \`ken init ~/ken\`.`
			)
		}
		return init(args[0] ?? process.cwd())
	}
}
