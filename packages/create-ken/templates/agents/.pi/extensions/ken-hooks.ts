// pi reads no hook file, so this runs the SessionStart hooks of .agents/hooks.json, written in
// Claude Code's schema, on pi's session_start, with the stdin JSON Claude Code and Codex send.
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

type Group = { matcher?: string; hooks: { type: string; command: string; timeout?: number }[] }
type Ctx = { cwd: string }
type Pi = { on(event: string, handler: (event: never, ctx: Ctx) => unknown): void }

const HOOKS = fileURLToPath(new URL('../../.agents/hooks.json', import.meta.url))
// pi's session_start reasons as Claude Code's SessionStart sources
const SOURCES: Record<string, string> = { new: 'clear', reload: 'startup' }

/** The stdout of the SessionStart hooks whose matcher matches `source`. */
function sessionStart(source: string, cwd: string) {
	let groups: Group[] = []
	try {
		groups = JSON.parse(readFileSync(HOOKS, 'utf8')).hooks?.SessionStart ?? []
	} catch {
		return ''
	}
	const stdin = JSON.stringify({ hook_event_name: 'SessionStart', cwd, source })
	return groups
		.filter((g) => !g.matcher || g.matcher === '*' || new RegExp(`^(?:${g.matcher})$`).test(source))
		.flatMap((g) => g.hooks.filter((h) => h.type === 'command'))
		.map(
			(h) =>
				spawnSync('sh', ['-c', h.command], {
					cwd,
					input: stdin,
					encoding: 'utf8',
					timeout: (h.timeout ?? 600) * 1000
				}).stdout ?? ''
		)
		.join('')
		.trim()
}

export default function (pi: Pi) {
	let context = ''
	pi.on('session_start', (event: { reason: string }, ctx) => {
		context = sessionStart(SOURCES[event.reason] ?? event.reason, ctx.cwd)
	})
	// session_start has no way to reach the model: its output goes with the first prompt
	pi.on('before_agent_start', () => {
		if (!context) return
		const content = context
		context = ''
		return { message: { customType: 'ken-hooks', content, display: false } }
	})
}
