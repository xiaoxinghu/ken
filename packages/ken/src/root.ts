import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

/** The per-machine config, `$XDG_CONFIG_HOME/ken/config.json`: optional, one key, `root`. */
export function configPath(env = process.env): string {
	return join(env.XDG_CONFIG_HOME || join(home(env), '.config'), 'ken', 'config.json')
}

/**
 * The root, as a real path: `KEN_ROOT`, else `root` in the config file, else `~/ken`. Resolved
 * once with realpath, so a symlink or a different case on a case-insensitive disk is one root
 * (PRD decision 15) and every later comparison is between real paths.
 */
export const findRoot = (env = process.env): string => locateRoot(env).root

/** The root and where it came from: `environment`, the config file's path, or `default`. */
export function locateRoot(env = process.env): { root: string; source: string } {
	const { path, from, source } = configuredRoot(env)
	const stat = statSync(path, { throwIfNoEntry: false })
	if (!stat?.isDirectory()) {
		throw new Error(
			`the ken root ${path} (from ${from}) ${stat ? 'is not a folder' : 'does not exist'}, and every ken command works inside one. ` +
				`Create it with \`npm create ken ${path}\`, or point KEN_ROOT or "root" in ${configPath(env)} at an existing root.`
		)
	}
	return { root: realpathSync.native(path), source }
}

/** Where the root is meant to be, existing or not, and which setting said so. */
export function configuredRoot(env = process.env): { path: string; from: string; source: string } {
	const file = configPath(env)
	const configured = env.KEN_ROOT || !existsSync(file) ? undefined : readRoot(file)
	const [value, source, from] = env.KEN_ROOT
		? [env.KEN_ROOT, 'environment', 'KEN_ROOT']
		: configured
			? [configured, file, `"root" in ${file}`]
			: ['~/ken', 'default', 'the default']
	return { path: resolve(value.replace(/^~(?=$|\/)/, home(env))), from, source }
}

const home = (env: NodeJS.ProcessEnv): string => env.HOME || homedir()

function readRoot(file: string): string | undefined {
	let parsed: unknown
	try {
		parsed = JSON.parse(readFileSync(file, 'utf8'))
	} catch (e) {
		throw new Error(
			`${file} is not valid JSON: ${(e as Error).message}. Fix it, or remove it to use ~/ken.`
		)
	}
	const object = typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
	const root = object ? (parsed as { root?: unknown }).root : undefined
	if (!object || (root !== undefined && (typeof root !== 'string' || !root))) {
		throw new Error(
			`${file} must be a JSON object like {"root": "~/ken"}, got ${JSON.stringify(parsed)}. Fix it, or remove it to use ~/ken.`
		)
	}
	return root as string | undefined
}
