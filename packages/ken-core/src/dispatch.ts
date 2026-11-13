// Running `ken <name>` as the first ken-<name> found: the root's .bin/, the bundled commands,
// then PATH (docs/extensions.md, "Where ken finds it" and "What it gets").
import { spawnSync } from 'node:child_process'
import {
	accessSync,
	constants,
	mkdtempSync,
	readdirSync,
	realpathSync,
	rmSync,
	writeFileSync
} from 'node:fs'
import { constants as os, tmpdir } from 'node:os'
import { delimiter, join, resolve } from 'node:path'
import { die, q } from './die.ts'
import { isFile, rootIfAny } from './root.ts'

/** The bundled commands: name to the file the runtime that runs ken runs. */
export type Bundled = Record<string, string>

/** A place ken-<name> is looked for: a folder, or the bundled commands when `dir` is absent. */
type Place = { label: string; dir?: string }

const runnable = (file: string) => {
	try {
		accessSync(file, constants.X_OK)
		return isFile(file)
	} catch {
		return false
	}
}

/** Where ken-<name> is looked for, in order; PATH's folders that exist, each once. */
const placesOf = (root: string | undefined): Place[] => {
	const bin = root && join(root, '.bin')
	const seen = new Set([bin])
	const path: Place[] = []
	for (const entry of process.env.PATH?.split(delimiter) ?? []) {
		let dir: string
		try {
			dir = realpathSync.native(resolve(entry || '.'))
		} catch {
			continue
		}
		if (!seen.has(dir)) path.push({ label: 'PATH', dir })
		seen.add(dir)
	}
	return [...(bin ? [{ label: "the root's .bin/", dir: bin }] : []), { label: 'bundled' }, ...path]
}

/** Run `cmd` with `args`, stdio and exit status its own, KEN_ROOT the root or unset, and first on
 * PATH a folder whose `ken` is this ken, run by this runtime. */
const run = (cmd: string, args: string[], root: string | undefined) => {
	const shim = mkdtempSync(join(tmpdir(), 'ken-'))
	try {
		const entry = realpathSync.native(process.argv[1] ?? '')
		writeFileSync(join(shim, 'ken'), `#!/bin/sh\nexec ${q(process.execPath)} ${q(entry)} "$@"\n`, {
			mode: 0o755
		})
		const env: NodeJS.ProcessEnv = {
			...process.env,
			PATH: `${shim}${delimiter}${process.env.PATH ?? ''}`
		}
		delete env.KEN_ROOT
		if (root) env.KEN_ROOT = root
		const r = spawnSync(cmd, args, { stdio: 'inherit', env })
		if (r.error)
			die(
				`could not run ${args[0] && cmd === process.execPath ? args[0] : cmd}: ${r.error.message}.`,
				'An executable script needs a #! line naming what runs it, e.g. #!/bin/sh.'
			)
		return r.status ?? 128 + (r.signal ? os.signals[r.signal] : 0)
	} finally {
		rmSync(shim, { recursive: true, force: true })
	}
}

/** Run the first ken-<name> found with `args` and return its exit status, or stop, saying where
 * ken looked. `core` is the core's commands, which ran first. */
export const dispatch = (name: string, args: string[], bundled: Bundled, core: string[]) => {
	if (!/^[A-Za-z0-9][A-Za-z0-9-]*$/.test(name))
		die(
			`${q(name)} is not a ken command: a command's name is letters, digits and -, starting`,
			'with a letter or digit. Run `ken help` for every command.'
		)
	const root = rootIfAny()
	const places = placesOf(root)
	for (const place of places) {
		if (!place.dir) {
			const file = Object.hasOwn(bundled, name) ? bundled[name] : undefined
			if (file) return run(process.execPath, [file, ...args], root)
			continue
		}
		const file = join(place.dir, `ken-${name}`)
		if (runnable(file)) return run(file, args, root)
		if (root && place === places[0] && isFile(file))
			die(
				`${file} would run as \`ken ${name}\`, but it is not executable.`,
				`Run \`chmod +x ${q(file)}\`, then \`ken ${name}\` again.`
			)
	}
	const looked = [
		`the core commands: ${listed(core)}`,
		root
			? `${join(root, '.bin')}, the root's .bin/`
			: "the root's .bin/: skipped, as there is no root here",
		`the bundled commands: ${listed(Object.keys(bundled))}`,
		'PATH, each folder in order, as `echo "$PATH"` prints them'
	]
	const add = root ? join(root, '.bin') : 'the .bin/ of a root, and run ken inside it'
	die(
		`${name} is not a ken command, and no executable ken-${name} was found. Looked in, in order:${looked.map((l) => `\n  ${l}`).join('')}\nAdd an executable ken-${name} to ${add}, or run`,
		'`ken help` for every command found.'
	)
}

const listed = (names: string[]) => (names.length ? names.join(', ') : 'none')

/** The names of the ken-<name> files in `dir` that run, or with `all` that are files; none when
 * ken may not list it. */
const commandsIn = (dir: string, all: boolean) => {
	try {
		return readdirSync(dir)
			.filter(
				(f) => /^ken-[A-Za-z0-9][A-Za-z0-9-]*$/.test(f) && (all ? isFile : runnable)(join(dir, f))
			)
			.map((f) => f.slice(4))
	} catch {
		return []
	}
}

/** The extensions `ken help` lists: by where each was found, one shadowed saying by what. A
 * ken-<name> in the root's .bin/ that is not executable is listed, as dispatch stops at it. */
export const extensions = (root: string | undefined, bundled: Bundled, core: string[]) => {
	const first = new Map(core.map((name) => [name, 'the core command, which always wins']))
	const groups: string[] = []
	const places = placesOf(root)
	for (const place of places) {
		const top = root !== undefined && place === places[0]
		const names = place.dir ? commandsIn(place.dir, top) : Object.keys(bundled)
		const lines = names.sort().map((name) => {
			const by = first.get(name)
			if (by) return `    ${name}, shadowed by ${by}`
			const file = place.dir && join(place.dir, `ken-${name}`)
			first.set(name, file || 'the bundled one')
			return file && top && !runnable(file)
				? `    ${name}, not executable: run \`chmod +x ${q(file)}\``
				: `    ${name}`
		})
		if (lines.length)
			groups.push(
				`  ${place.dir ? `${place.label}, ${place.dir}` : place.label}\n${lines.join('\n')}`
			)
	}
	return groups.length
		? `Extensions, each a ken-<name> run as \`ken <name>\`, by where it was found, the first winning:\n${groups.join('\n')}\n`
		: `Extensions: none found. Add one as an executable ken-<name> in ${root ? join(root, '.bin') : "a root's .bin/"}.\n`
}
