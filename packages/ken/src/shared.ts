// What the standard commands share. Each is an extension (docs/extensions.md): the root from
// KEN_ROOT, the core only through `ken`, so nothing here imports @unclex/ken-core.
import { join } from 'node:path'

/** The root ken found, or a message on stderr and exit 2 when `ken` ran outside any root. */
export const rootOf = (name: string) => {
	const root = process.env.KEN_ROOT
	if (root) return root
	process.stderr.write(
		`ken ${name}: there is no root here: KEN_ROOT is unset, as \`ken\` found no .ken at or above ${process.cwd()}. cd into a root and run \`ken ${name}\` again, or \`ken init\` to make one.\n`
	)
	process.exit(2)
}

/** Where a harness with no environment file keeps the session for `ken log`: machine-local
 * state, out of the root, one per root named by its path with / as -. */
export const pointerOf = (root: string) =>
	join(process.env.HOME ?? '', '.local/state/ken', root.replaceAll('/', '-'))

const pad = (n: number) => String(n).padStart(2, '0')

/** `d` in local time by a strftime format of %Y %m %d %H %M %z only. */
export const strftime = (d: Date, format: string) => {
	const offset = -d.getTimezoneOffset()
	const z = `${offset < 0 ? '-' : '+'}${pad(Math.trunc(Math.abs(offset) / 60))}${pad(Math.abs(offset) % 60)}`
	const parts: Record<string, string> = {
		Y: String(d.getFullYear()),
		m: pad(d.getMonth() + 1),
		d: pad(d.getDate()),
		H: pad(d.getHours()),
		M: pad(d.getMinutes()),
		z
	}
	return format.replace(/%([YmdHMz])/g, (_, c: string) => parts[c] ?? '')
}

/** Now, as log.md stamps it: local, to the minute, with the offset. */
export const now = () => strftime(new Date(), '%Y-%m-%dT%H:%M%z')

/** A string, cut to `max` characters, counted as code points, with … when cut. */
export const cut = (s: string, max: number) => {
	const chars = Array.from(s)
	return chars.length > max ? `${chars.slice(0, max).join('')}…` : s
}

/** A JSON object as read: its fields are checked where they are used. */
// biome-ignore lint/suspicious/noExplicitAny: a transcript's shape is the harness's, checked field by field
export type Obj = Record<string, any>

/** The objects of a JSON-lines text; a line that is not one, as one still being written, is
 * skipped. */
export const objects = (text: string) =>
	text.split('\n').flatMap((line) => {
		if (!line) return []
		try {
			const v: unknown = JSON.parse(line)
			return v && typeof v === 'object' && !Array.isArray(v) ? [v as Obj] : []
		} catch {
			return []
		}
	})

/** Whether `args` asks for the usage: the one argument --help or -h. */
export const wantsHelp = (args: string[]) =>
	args.length === 1 && (args[0] === '--help' || args[0] === '-h')
