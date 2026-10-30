import { spawn } from 'node:child_process'
import { accessSync, constants, readdirSync, statSync } from 'node:fs'
import { constants as os } from 'node:os'
import { delimiter, join } from 'node:path'
import { readKenYaml } from './config.ts'
import { redact } from './key.ts'
import { codePath } from './path.ts'
import { findRoot } from './root.ts'

type Place = { dir: string; from: string }

/** Where `ken-<name>` is looked for, in order (decision 10): the root's .bin, each layer's, PATH. */
function places(root: string): Place[] {
	return [
		{ dir: join(root, '.bin'), from: 'the root' },
		...readKenYaml(root).layers.map(({ name, key }) => ({
			dir: join(codePath(root, key), '.bin'),
			from: `layer ${name}`
		})),
		...(process.env.PATH ?? '')
			.split(delimiter)
			.filter(Boolean)
			.map((dir) => ({ dir, from: 'PATH' }))
	]
}

const isFile = (file: string): boolean => {
	try {
		return statSync(file).isFile()
	} catch {
		return false
	}
}

const isExecutable = (file: string): boolean => {
	try {
		accessSync(file, constants.X_OK)
		return true
	} catch {
		return false
	}
}

/**
 * Run `ken-<name>` with `args`, stdio inherited and KEN_ROOT the real root; resolves to the
 * child's exit code, 128 + the signal number when it was killed. The first executable wins.
 */
export async function runExternal(name: string, args: string[]): Promise<number> {
	const root = findRoot()
	const where = places(root)
	const files = name && !name.includes('/') ? where.map((p) => join(p.dir, `ken-${name}`)) : []
	const file = files.find((f) => isFile(f) && isExecutable(f))
	if (!file) {
		const plain = files.find(isFile)
		if (plain) {
			throw new Error(
				`${plain} would run as \`ken ${name}\`, but it is not executable. ` +
					`Run \`chmod +x ${plain}\`, then \`ken ${name}\` again.`
			)
		}
		const shown = JSON.stringify(redact(name))
		throw new Error(
			[
				`${shown} is not a ken command, and no executable ken-${redact(name)} was found. Looked in, in order:`,
				...where.map((p) => `  ${p.dir}  (${p.from})`),
				'Run `ken help` for the builtins and the external commands found, ' +
					`or add one as an executable ken-<name> in ${join(root, '.bin')}.`
			].join('\n')
		)
	}
	const child = spawn(file, args, { stdio: 'inherit', env: { ...process.env, KEN_ROOT: root } })
	// The terminal sends these to the child too; ken waits for it to decide.
	for (const signal of ['SIGINT', 'SIGQUIT'] as const) process.on(signal, () => {})
	return new Promise((resolve, reject) => {
		child.on('error', (e) =>
			reject(
				new Error(
					`${file} could not be run: ${e.message}. Check that its #! line names an interpreter that exists, then run \`ken ${name}\` again.`
				)
			)
		)
		child.on('exit', (code, signal) => resolve(signal ? 128 + os.signals[signal] : (code ?? 1)))
	})
}

/** For `ken help`: each external command that `ken <name>` runs, grouped by where it was found. */
export function externals(builtins: string[]): string {
	let root: string
	let where: Place[]
	try {
		root = findRoot()
		where = places(root)
	} catch (e) {
		return `External commands: none listed, because ${(e as Error).message}`
	}
	const seen = new Set(builtins)
	const lines = where.flatMap(({ dir, from }) => {
		let entries: string[]
		try {
			entries = readdirSync(dir)
		} catch {
			return []
		}
		const names = entries
			.filter((entry) => entry.startsWith('ken-'))
			.map((entry) => entry.slice(4))
			.filter((name) => {
				const file = join(dir, `ken-${name}`)
				if (!name || seen.has(name) || !isFile(file) || !isExecutable(file)) return false
				seen.add(name)
				return true
			})
			.sort()
		return names.length ? [`  ${from}, ${dir}: ${names.join(', ')}`] : []
	})
	return lines.length
		? [
				'External commands, run as `ken <name>`, by where their ken-<name> was found:',
				...lines
			].join('\n')
		: `External commands: none found. Add one as an executable ken-<name> in ${join(root, '.bin')}.`
}
