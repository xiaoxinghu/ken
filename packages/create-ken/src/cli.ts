#!/usr/bin/env node
// create-ken [<dir>]: a ken root for an agent harness (docs/templates.md). `ken init`, then the
// template's files, adding only what is missing, so a rerun is a root's update path.
import { spawnSync } from 'node:child_process'
import {
	appendFileSync,
	constants,
	copyFileSync,
	lstatSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	readlinkSync,
	realpathSync,
	symlinkSync
} from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const TEMPLATE = fileURLToPath(new URL('../template', import.meta.url))
const KEN = fileURLToPath(import.meta.resolve('@unclex/ken/src/cli.ts'))
const INSTALL = 'npm install -g @unclex/ken'
// npm leaves a file named .gitignore out of a package, so the template keeps it as gitignore
const IGNORE = 'gitignore'
// an npm package carries no link: these are made here, name to target
const LINKS = { 'CLAUDE.md': 'AGENTS.md', '.codex/hooks.json': '../.agents/hooks.json' }

/** `s` as one shell word, so a command in a message can be pasted. */
const q = (s: string) =>
	/^[A-Za-z0-9_./@%+=:,-]+$/.test(s) ? s : `'${s.replaceAll("'", "'\\''")}'`
const stop = (message: string): never => {
	process.stderr.write(`create-ken: ${message}\n`)
	process.exit(1)
}
const lstat = (path: string) => lstatSync(path, { throwIfNoEntry: false })
const lines = (text: string) => text.split('\n').filter((line) => line.trim())

const args = process.argv.slice(2)
if (args.some((a) => a === '-h' || a === '--help')) {
	process.stdout.write(`Usage: create-ken [<dir>], run as \`npm create ken <dir>\`: make <dir>, default the current
folder, a ken root for an agent harness. Runs \`ken init <dir>\`, then copies the template,
AGENTS.md, README.md, the session-start hooks and the env files, never overwriting. A rerun
adds the files a newer template has and names each file that differs from it.
  npm create ken ~/ken
  cd ~/ken && npm create ken   # a rerun: only what is missing
`)
	process.exit(0)
}
if (args.length > 1)
	stop(
		`takes one folder, got ${args.length} arguments. Quote a path with spaces, e.g. \`npm create ken ~/ken\`.`
	)
if (args[0]?.startsWith('-'))
	stop(
		`does not take ${q(args[0])}: it takes one folder, default the current one. Run \`create-ken --help\`.`
	)

try {
	// ken init first: a folder it refuses, such as one inside another root, gets no file
	const init = spawnSync(process.execPath, [KEN, 'init', resolve(args[0] ?? '.')], {
		encoding: 'utf8'
	})
	process.stdout.write(init.stdout)
	process.stderr.write(init.stderr)
	if (init.status !== 0) process.exit(init.status ?? 1)
	const root = realpathSync.native(resolve(args[0] ?? '.'))

	const made: string[] = []
	const same: string[] = []
	const differs: string[] = []
	for (const rel of (readdirSync(TEMPLATE, { recursive: true }) as string[]).sort()) {
		const from = join(TEMPLATE, rel)
		if (!lstatSync(from).isFile()) continue
		if (rel === IGNORE) {
			// ken init owns .gitignore too: the template's lines it lacks are added, as init adds its own
			const path = join(root, '.gitignore')
			const text = readFileSync(path, 'utf8')
			const have = new Set(lines(text).map((line) => line.trimEnd()))
			const lacking = lines(readFileSync(from, 'utf8')).filter((line) => !have.has(line))
			if (!lacking.length) same.push('.gitignore')
			else {
				appendFileSync(path, `${text && !text.endsWith('\n') ? '\n' : ''}${lacking.join('\n')}\n`)
				made.push(`.gitignore, added ${lacking.join(' ')}`)
			}
			continue
		}
		const to = join(root, rel)
		const there = lstat(to)
		if (!there) {
			mkdirSync(dirname(to), { recursive: true })
			copyFileSync(from, to, constants.COPYFILE_EXCL)
			made.push(rel)
		} else if (there.isFile() && readFileSync(to).equals(readFileSync(from))) same.push(rel)
		else differs.push(`${rel}: \`diff ${q(from)} ${q(to)}\``)
	}
	for (const [name, target] of Object.entries(LINKS)) {
		const path = join(root, name)
		const there = lstat(path)
		if (!there) {
			mkdirSync(dirname(path), { recursive: true })
			symlinkSync(target, path)
			made.push(`${name} -> ${target}`)
		} else if (there.isSymbolicLink() && readlinkSync(path) === target) same.push(name)
		else differs.push(`${name}: not the link ${name} -> ${target}, which the template has`)
	}
	const ken = join(root, '.ken')
	const settings = readFileSync(ken, 'utf8')
	if (/^template\.name=/m.test(settings)) same.push('.ken')
	else {
		appendFileSync(ken, `${settings.endsWith('\n') ? '' : '\n'}template.name=agents\n`)
		made.push('.ken, added template.name=agents')
	}

	const list = (items: string[]) => items.map((item) => `  ${item}\n`).join('')
	let out = made.length
		? `From the template, made or added to in ${root}:\n${list(made)}`
		: `${root} has every file of the template: nothing was made.\n`
	if (same.length) out += `Left alone, already as the template has them: ${same.join(' ')}\n`
	if (differs.length)
		out +=
			"Left alone, different from the template: yours to keep, or to compare with the template's and bring over what it adds:\n" +
			list(differs)
	const ok = (cmd: string, ...cmdArgs: string[]) => spawnSync(cmd, cmdArgs).status === 0
	const next: string[] = []
	// npm create puts its temporary install's node_modules/.bin on PATH, and the ken there, this
	// package's dependency, is gone after the run: only a ken outside one is installed
	const path = (process.env.PATH ?? '')
		.split(':')
		.filter((dir) => !dir.includes('/node_modules/.bin'))
		.join(':')
	if (spawnSync('sh', ['-c', 'command -v ken'], { env: { ...process.env, PATH: path } }).status)
		next.push(`${INSTALL}   # ken is not on PATH, and the hooks and AGENTS.md call it`)
	const git = ok('git', '-C', root, 'rev-parse', '--is-inside-work-tree')
	if (!git) next.push(`git -C ${q(root)} init`)
	if (!git || made.length)
		next.push(`git -C ${q(root)} add . && git -C ${q(root)} commit -m 'A ken root'`)
	if (made.length)
		next.push(
			`start an agent session in ${q(root)}: its hook runs \`ken status\`. Codex and pi ask to trust the folder first, and Codex again for the hooks.`
		)
	if (next.length) out += `Next:\n${list(next)}`
	process.stdout.write(out)
} catch (e) {
	const { code, path, syscall } = e as NodeJS.ErrnoException
	if (!code || !path) throw e
	stop(
		`could not ${syscall ?? 'reach'} ${path}: ${code}. Fix that, e.g. move aside what is in the way, then run create-ken again: it adds only what is missing.`
	)
}
