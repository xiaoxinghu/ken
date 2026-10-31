import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { type Command, shellWord } from './command.ts'
import { readKenYaml } from './config.ts'
import { get } from './get.ts'
import { gitWith } from './git.ts'
import { codePath } from './path.ts'
import { configPath, configuredRoot } from './root.ts'

/** The root `.gitignore` rules: the clones and worktrees at depth three, and secrets. */
const IGNORE = ['.repos/*/*/*/', '.env']

const frontPage = (name: string) => `# ${name}

A ken root: a knowledge base over the repos under \`.repos/\`, one section per folder.

## Sections

## Layers
`

const agents = (name: string) => `# ${name}

A ken root: a knowledge base with every git checkout inside it. Start at the front page,
README.md, which lists the sections and layers; each folder's README.md indexes its pages.

## Layout

- Folders at the top are sections of knowledge; a layer is a section linked to the clone
  of a shared repo.
- \`.repos/<host>/<owner>/<repo>/\` is a clone on its default branch, and
  \`.repos/<host>/<owner>/<repo>.<branch>/\` a worktree beside it, \`/\` in the branch as \`-\`.
- \`.repos/index.yaml\` describes every repo, cloned or not. \`.ken.yaml\` holds settings.
- \`.bin/\` holds \`ken-<name>\` scripts, run as \`ken <name>\`.

## Commands

- \`ken path code <key> [<branch>]\`: the clone or worktree of a repo key such as
  github.com/acme/join-web. \`ken path <file>\`: the README.md chain down to a file.
- \`ken which\`: the repo key and branch of the current folder.
- \`ken get <key> [-b <branch>]\`: clone the repo, or make the branch's worktree, and print
  its path. The one way code gets into \`.repos/\`.
- \`ken repos [<key>]\`: every repo the index lists, and what is cloned.

Everything else is git, run against the path \`ken path\` prints. \`ken help\` for the rest.
`

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
		// right after the program, since ssh takes the first value given for an option
		...(ssh && {
			GIT_SSH_COMMAND: ssh.replace(
				/^\s*("[^"]*"|'[^']*'|\S+)/,
				'$1 -o BatchMode=yes -o ConnectTimeout=15'
			)
		})
	}
}

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
	for (let a = dirname(target); a !== dirname(a); a = dirname(a)) {
		if (existsSync(join(a, '.ken.yaml'))) {
			throw new Error(
				`${target} is inside the ken root ${a} (it holds .ken.yaml), and a root inside a root ` +
					`would split one knowledge base and its checkouts in two. Use ${a} as it is, ` +
					'or run `ken init <dir>` on a folder outside it.'
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
	if (!existsSync(configured.path) || realpathSync.native(configured.path) !== target) {
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
