#!/usr/bin/env node
// The kernel. Primitives only: see docs/prd.md, "The kernel".
import { commandHelp } from './command.ts'
import { builtin } from './commands.ts'
import { runExternal } from './extension.ts'

const [first, ...args] = process.argv.slice(2)
const name = first === undefined || first === '--help' || first === '-h' ? 'help' : first
try {
	const command = builtin(name)
	if (!command) process.exit(await runExternal(name, args))
	const out =
		args.includes('--help') || args.includes('-h') ? commandHelp(command) : command.run(args)
	process.stdout.write(`${out}\n`)
} catch (e) {
	process.stderr.write(`ken: ${e instanceof Error ? e.message : String(e)}\n`)
	process.exit(1)
}
