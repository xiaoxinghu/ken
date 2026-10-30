import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import type { Command } from './command.ts'
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

/** Create in `dir` the skeleton ken owns, only what is missing; say what was made and what next. */
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
	const lines = new Set(ignored?.split('\n').map((l) => l.trim()))
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
	const configured = configuredRoot(env)
	if (!existsSync(configured.path) || realpathSync.native(configured.path) !== target) {
		out.push(
			'',
			`${target} is not the configured root, ${configured.path} (from ${configured.from}), ` +
				'so ken commands will not find it. Point ken at it with',
			`  export KEN_ROOT=${JSON.stringify(target)}`,
			`or put {"root": ${JSON.stringify(target)}} in ${configPath(env)}.`
		)
	}
	return out.join('\n')
}

export const initCommand: Command = {
	usage: 'init [<dir>]',
	summary:
		'Create the skeleton ken owns in <dir>, default the current folder, only what is missing.',
	details: [
		'  .repos/index.yaml, .ken.yaml, .bin/, a .gitignore holding .repos/*/*/*/ and .env (only',
		'  the lines it lacks), and a front page README.md and AGENTS.md. Never overwrites a file,',
		'  so a second run creates nothing. Refuses a <dir> inside another root (a folder holding',
		'  .ken.yaml). Does not git init.'
	].join('\n'),
	examples: ['ken init', 'ken init ~/ken', 'git init ~/work && ken init ~/work'],
	run(args) {
		if (args.length > 1) {
			throw new Error(
				`ken init takes at most one <dir>, got ${args.length} arguments. Run e.g. \`ken init ~/ken\`.`
			)
		}
		return init(args[0] ?? process.cwd())
	}
}
