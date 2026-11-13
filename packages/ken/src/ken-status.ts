// `ken status`, the session-start hook: one screen of what this root holds, so the agent never
// lists folders, and the root's .bin/ on the PATH of the agent's shell where the harness has a
// way. Exit 0 always: the output is the agent's context, the errors included.
import { spawnSync } from 'node:child_process'
import { appendFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { now, type Obj, pointerOf, wantsHelp } from './shared.ts'

if (wantsHelp(process.argv.slice(2))) {
	process.stdout.write(`Usage: ken status: the session-start hook's screen, the repos, the settings, the ready
tasks and the last lines of log.md. Run by the hook with its JSON on stdin, it also gives
the session's shell the root's .bin/ on PATH and the session for \`ken log\`, through
CLAUDE_ENV_FILE where the harness sets it, else a pointer under ~/.local/state/ken.
  ken status
`)
	process.exit(0)
}

const out: string[] = []
const say = (s = '') => out.push(`${s}\n`)
/** `ken <args>` with its stderr in its stdout, as `2>&1` gives them. */
const ken = (...args: string[]) =>
	spawnSync('sh', ['-c', 'ken "$@" 2>&1', 'ken', ...args], {
		encoding: 'utf8',
		stdio: ['ignore', 'pipe', 'inherit']
	}).stdout ?? ''

const root = process.env.KEN_ROOT
if (!root) {
	process.stdout.write(
		`This is no ken root: ken found no .ken at or above ${process.cwd()}, so there is nothing to show. Its CLI is \`ken\`; \`ken help\` lists the commands, and \`ken init\` makes a root.\n`
	)
	process.exit(0)
}

/** Text a shell reads back as one word, inside single quotes. */
const q = (s: string) => `'${s.replaceAll("'", "'\\''")}'`
// The hook's stdin JSON names the session and its transcript, which `ken log` needs for the
// digest; a person running it at a terminal sends none.
let input: Obj = {}
if (!process.stdin.isTTY) {
	try {
		const v: unknown = JSON.parse(readFileSync(0, 'utf8'))
		if (v && typeof v === 'object') input = v
	} catch {}
}
const session = typeof input.session_id === 'string' ? input.session_id : ''
const transcript = typeof input.transcript_path === 'string' ? input.transcript_path : ''
// Claude Code sources CLAUDE_ENV_FILE before each shell command: the root's .bin/ goes on its
// PATH, for the root's own tools; `ken` finds the root from any folder under it. A harness with
// no such file gets the session in a pointer `ken log` reads when the environment has none.
const pointer = pointerOf(root)
try {
	const envFile = process.env.CLAUDE_ENV_FILE
	if (envFile) {
		appendFileSync(envFile, `export PATH=${q(join(root, '.bin'))}:"$PATH"\n`)
		if (session)
			appendFileSync(
				envFile,
				`export KEN_SESSION=${q(session)} KEN_SESSION_TRANSCRIPT=${q(transcript)}\n`
			)
	} else if (session) {
		mkdirSync(dirname(pointer), { recursive: true })
		writeFileSync(pointer, `KEN_SESSION=${session}\nKEN_SESSION_TRANSCRIPT=${transcript}\n`)
	} else if ('hook_event_name' in input) {
		// a hook that names no session, pi's shim, starts one all the same: the file is stale
		rmSync(pointer, { force: true })
	}
} catch (e) {
	say(`ken status: the session was not passed on: ${(e as Error).message}.`)
}

say(`This is a ken root: ${root}. Its CLI is \`ken\`; \`ken help\` lists the commands.`)
say()
out.push(ken('repos'))
say()
say('Settings, .ken:')
try {
	for (const line of readFileSync(join(root, '.ken'), 'utf8').replace(/\n$/, '').split('\n'))
		say(`  ${line}`)
} catch (e) {
	say(`  ${(e as Error).message}`)
}
// The ready tasks, when a `ken task` is there: bundled, in the root's .bin/ or on PATH.
const ready = ken('task', 'ready')
if (!ready.startsWith('ken: task is not a ken command')) {
	say()
	out.push(ready)
}
// The last entries of the timeline the agents write with `ken log`, never the whole file. A
// union merge can leave lines out of order; sorting puts back those that share an offset.
let log = ''
try {
	log = readFileSync(join(root, 'log.md'), 'utf8')
} catch {}
if (log) {
	say()
	say(`Recent, log.md (now ${now()}); grep it for older entries, never read it whole:`)
	const lines = log.replace(/\n$/, '').split('\n')
	lines.sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)))
	for (const line of lines.slice(-10)) say(line)
}
process.stdout.write(out.join(''))
