#!/usr/bin/env node
// Copy a template, git init, run `ken init`. No rules live here: see docs/prd.md, "create-ken".
import { spawnSync } from 'node:child_process'
import {
	cpSync,
	existsSync,
	readdirSync,
	realpathSync,
	renameSync,
	statSync,
	symlinkSync
} from 'node:fs'
import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { createInterface } from 'node:readline/promises'
import { parseArgs } from 'node:util'
import { configPath, configuredRoot } from '@unclex/ken/src/root.ts'

const TEMPLATES = join(import.meta.dirname, '..', 'templates')
// minimal is the skeleton ken init makes and nothing more, so it has no folder to copy
const templates = ['minimal', ...['claude', 'layer'].filter((t) => existsSync(join(TEMPLATES, t)))]

const USAGE = `Usage: npm create ken [<dir>] [-- --template <name>]

Make a new ken root in <dir>, which must be new or empty: copy the template, git init,
ken init, then print the next commands. On a terminal it asks for what was not given;
otherwise <dir> is required and the template is minimal. Templates: ${templates.join(', ')}.

Examples:
  npm create ken ~/ken
  npm create ken ~/work -- --template minimal
  pnpm create ken ~/ken --template minimal`

/** `s` as one shell word, quoted only when it needs to be. */
const q = (s: string) => (/^[\w@%+=:,./-]+$/.test(s) ? s : `'${s.replaceAll("'", `'\\''`)}'`)

/** Run a command with its output on ours; throw, naming what to run next, when it fails. */
function run(command: string, args: string[], what: string, next: string, env = process.env) {
	const r = spawnSync(command, args, { stdio: 'inherit', env })
	if (r.error || r.status !== 0) {
		throw new Error(
			`${what} failed (${r.error?.message ?? `exit ${r.status ?? r.signal}`}), so the root is not ` +
				`finished. Fix what it said above, then run \`${next}\`: it fills in only what is missing.`
		)
	}
}

const parse = () =>
	parseArgs({
		options: { template: { type: 'string', short: 't' }, help: { type: 'boolean', short: 'h' } },
		allowPositionals: true
	})

async function main(): Promise<string> {
	let parsed: ReturnType<typeof parse>
	try {
		parsed = parse()
	} catch (e) {
		throw new Error(`${(e as Error).message}. Run \`npm create ken -- --help\` for the usage.`)
	}
	const { values, positionals } = parsed
	if (values.help) return USAGE
	if (positionals.length > 1) {
		throw new Error(
			`it takes one <dir>, got ${positionals.map(q).join(' ')}. Run e.g. \`npm create ken ~/ken\`.`
		)
	}
	let [dir] = positionals
	let template = values.template
	const configured = configuredRoot()
	const prompt = process.stdin.isTTY
		? createInterface({ input: process.stdin, output: process.stdout })
		: undefined
	if (dir === undefined) {
		if (!prompt) {
			throw new Error(
				'no <dir> given, and with no terminal to ask on it will not guess where to write. ' +
					`Run \`npm create ken ${q(configured.path)} -- --template ${template ?? 'minimal'}\`.`
			)
		}
		dir = (await prompt.question(`Directory for the new root (${configured.path}): `)).trim()
		dir ||= configured.path
	}
	if (template === undefined) {
		template = prompt
			? (await prompt.question(`Template, one of ${templates.join(', ')} (minimal): `)).trim()
			: ''
		template ||= 'minimal'
	}
	prompt?.close()

	const target = resolve(dir.replace(/^~(?=$|\/)/, process.env.HOME || homedir()))
	if (!templates.includes(template)) {
		throw new Error(
			`there is no template "${template}"; this create-ken has ${templates.join(', ')}. ` +
				`Run \`npm create ken ${q(target)} -- --template minimal\`.`
		)
	}
	const stat = statSync(target, { throwIfNoEntry: false })
	if (stat && (!stat.isDirectory() || readdirSync(target).length)) {
		throw new Error(
			`${target} ${stat.isDirectory() ? 'is not empty' : 'is not a folder'}, and a new root is made ` +
				'only in a new or empty folder, so nothing already there is overwritten or mixed in. ' +
				`Pick another <dir>, or make this folder a root as it stands with \`git init ${q(target)} && ken init ${q(target)}\`.`
		)
	}

	if (existsSync(join(TEMPLATES, template))) {
		cpSync(join(TEMPLATES, template), target, { recursive: true })
		// npm drops .gitignore from a published package: see templates/README.md
		if (existsSync(join(target, 'gitignore'))) {
			renameSync(join(target, 'gitignore'), join(target, '.gitignore'))
		}
	}

	const finish = `git init ${q(target)} && ken init ${q(target)}`
	run('git', ['init', '--quiet', target], `git init ${target}`, finish)
	// ken init through our own pinned @unclex/ken, so the rules have one source. KEN_ROOT keeps
	// it from saying the root is not the configured one: the next commands below say that.
	const require = createRequire(import.meta.url)
	const pkg = require.resolve('@unclex/ken/package.json')
	const ken = join(dirname(pkg), require(pkg).bin.ken)
	run(process.execPath, [ken, 'init', target], `ken init ${target}`, finish, {
		...process.env,
		KEN_ROOT: target
	})
	// Claude Code reads CLAUDE.md, not AGENTS.md; npm publishes no symlink, so it is made here
	if (!existsSync(join(target, 'CLAUDE.md'))) symlinkSync('AGENTS.md', join(target, 'CLAUDE.md'))

	const out = [
		'',
		`Made a ken root in ${target} from the ${template} template, with git init and ken init run.`
	]
	const commands = [
		`cd ${q(target)}`,
		`git add -A && git commit -m 'Start a ken root'`,
		'claude                # or any agent: tell it what this knowledge base is for',
		"ken layer add <key>   # to join a team's shared knowledge, e.g. github.com/acme/handbook"
	]
	if (
		!existsSync(configured.path) ||
		realpathSync.native(configured.path) !== realpathSync.native(target)
	) {
		out.push(
			'',
			`${target} is not the configured root, ${configured.path} (from ${configured.from}), so ken ` +
				`commands will not find it until you point ken at it: export KEN_ROOT as below, or put ` +
				`{"root": ${JSON.stringify(target)}} in ${configPath()}.`
		)
		commands.unshift(`export KEN_ROOT=${q(target)}`)
	}
	out.push('', 'Next:', ...commands.map((c) => `  ${c}`))
	return out.join('\n')
}

try {
	process.stdout.write(`${await main()}\n`)
} catch (e) {
	process.stderr.write(`create-ken: ${e instanceof Error ? e.message : String(e)}\n`)
	process.exit(1)
}
