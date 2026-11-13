// `ken log <kind> <subject> <what...>`: one line appended to the root's log.md, the timeline the
// agents write as they act, `<time> <kind> <subject>: <what>`, the time now, local, to the
// minute with its offset. One short line in one append is atomic under O_APPEND, so sessions
// logging at once never tear a line. Prints nothing on success. In a session the start hook
// named, KEN_SESSION, it first writes the session's digest with `ken digest` and ends the line
// with ` s=<id>`, the link from the line to the story behind it.
import { spawnSync } from 'node:child_process'
import { appendFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { now, pointerOf, rootOf, wantsHelp } from './shared.ts'

const KINDS = ['ingest', 'query', 'page', 'task', 'promote', 'layer']
const USAGE = `Usage: ken log <kind> <subject> <what...>, e.g. \`ken log query flow/README.md answered X\`.
<kind> is one of: ${KINDS.join(' ')}. <subject> is one word grep finds the entry by: a repo key, a path
from the root, a task path, or <key>:<path>#<symbol>. <what> is one short clause. Log right
after an ingest, an answered question, a page, task, promote or layer change, before its commit.`

const refuse = (message: string) => {
	process.stderr.write(`ken log: ${message}\n${USAGE}\n`)
	process.exit(2)
}

const args = process.argv.slice(2)
if (wantsHelp(args)) {
	process.stdout.write(`${USAGE}\n`)
	process.exit(0)
}
if (args.length < 3) refuse('a kind, a subject and what happened are needed.')
const root = rootOf('log')
const [kind = '', subject = '', ...rest] = args
const what = rest.join(' ')
if (!KINDS.includes(kind))
	refuse(`'${kind}' is not a kind: the kinds are a closed list, so grep ' <kind> ' finds them.`)
if (subject === '' || /[ \t\n]/.test(subject))
	refuse(`the subject '${subject}' is not one word: a line is split at its first spaces.`)
if (what.includes('\n'))
	refuse('what happened spans lines: an entry is one line. Say it in one short clause.')
if (!/[^ \t]/.test(what)) refuse('what happened is empty.')

// A harness with no env file has its hook write the session to a pointer instead, as `ken
// status` names it.
const env = { ...process.env }
if (!env.KEN_SESSION) {
	try {
		const pointer = readFileSync(pointerOf(root), 'utf8')
		const value = (key: string) => pointer.match(new RegExp(`^${key}=(.*)$`, 'm'))?.[1] ?? ''
		env.KEN_SESSION = value('KEN_SESSION')
		env.KEN_SESSION_TRANSCRIPT = value('KEN_SESSION_TRANSCRIPT')
	} catch {}
}
let link = ''
if (env.KEN_SESSION && spawnSync('ken', ['digest'], { stdio: 'inherit', env }).status === 0)
	link = ` s=${env.KEN_SESSION}`
appendFileSync(join(root, 'log.md'), `${now()} ${kind} ${subject}: ${what}${link}\n`)
