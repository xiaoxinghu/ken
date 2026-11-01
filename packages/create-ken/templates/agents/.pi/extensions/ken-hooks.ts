// pi reads no hook file, so this runs the hooks of .agents/hooks.json, written in Claude Code's
// schema, on pi's events: session_start as SessionStart, tool_call as PreToolUse. Each command
// gets the stdin JSON Claude Code and Codex send; exit 2, or a permissionDecision of deny,
// blocks the tool. It never throws, since pi blocks the tool when a tool_call handler fails.
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

type Group = { matcher?: string; hooks: { type: string; command: string; timeout?: number }[] }
type Ctx = { cwd: string }
type Pi = { on(event: string, handler: (event: never, ctx: Ctx) => unknown): void }

const HOOKS = fileURLToPath(new URL('../../.agents/hooks.json', import.meta.url))
// pi's tools under Claude Code's names, which the matchers are written in
const TOOLS: Record<string, string> = {
	read: 'Read',
	grep: 'Grep',
	find: 'Glob',
	bash: 'Bash',
	edit: 'Edit',
	write: 'Write'
}
// pi's session_start reasons as Claude Code's SessionStart sources
const SOURCES: Record<string, string> = { new: 'clear', reload: 'startup' }

/** Run the hooks of `event` whose matcher matches `match`; the results of those that ran. */
function run(event: string, match: string, input: object, cwd: string) {
	let groups: Group[] = []
	try {
		groups = JSON.parse(readFileSync(HOOKS, 'utf8')).hooks?.[event] ?? []
	} catch {
		return []
	}
	const stdin = JSON.stringify({ hook_event_name: event, cwd, ...input })
	return groups
		.filter((g) => !g.matcher || g.matcher === '*' || new RegExp(`^(?:${g.matcher})$`).test(match))
		.flatMap((g) => g.hooks.filter((h) => h.type === 'command'))
		.map((h) =>
			spawnSync('sh', ['-c', h.command], {
				cwd,
				input: stdin,
				encoding: 'utf8',
				timeout: (h.timeout ?? 600) * 1000
			})
		)
}

export default function (pi: Pi) {
	let context = ''
	pi.on('session_start', (event: { reason: string }, ctx) => {
		const source = SOURCES[event.reason] ?? event.reason
		context = run('SessionStart', source, { source }, ctx.cwd)
			.map((r) => r.stdout ?? '')
			.join('')
			.trim()
	})
	// session_start has no way to reach the model: its output goes with the first prompt
	pi.on('before_agent_start', () => {
		if (!context) return
		const content = context
		context = ''
		return { message: { customType: 'ken-hooks', content, display: false } }
	})
	pi.on('tool_call', (event: { toolName: string; input: object }, ctx) => {
		try {
			const tool_name = TOOLS[event.toolName] ?? event.toolName
			for (const r of run(
				'PreToolUse',
				tool_name,
				{ tool_name, tool_input: event.input },
				ctx.cwd
			)) {
				if (r.status === 2) return { block: true, reason: r.stderr.trim() || 'blocked by a hook' }
				let out: { permissionDecision?: string; permissionDecisionReason?: string } | undefined
				try {
					out = JSON.parse(r.stdout)?.hookSpecificOutput
				} catch {
					// plain stdout decides nothing
				}
				if (out?.permissionDecision === 'deny') {
					return { block: true, reason: out.permissionDecisionReason || 'blocked by a hook' }
				}
			}
		} catch {
			// a hook that fails to run blocks nothing
		}
	})
}
