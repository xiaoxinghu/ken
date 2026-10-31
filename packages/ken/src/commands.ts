import { type Command, commandHelp, indent } from './command.ts'
import { config } from './config.ts'
import { externals } from './extension.ts'
import { getCommand } from './get.ts'
import { index } from './index.ts'
import { initCommand } from './init.ts'
import { redact } from './key.ts'
import { path } from './path.ts'
import { configPath } from './root.ts'
import { which } from './which.ts'

const help: Command = {
	usage: 'help [<command>]',
	summary: 'Print every command with examples, or one in full as `ken <command> --help` does.',
	examples: ['ken help', 'ken help path'],
	run([name, ...rest]) {
		if (name === undefined) return overview()
		if (rest.length) throw new Error('ken help takes one command. Run e.g. `ken help path`.')
		const command = builtin(name)
		if (command) return commandHelp(command)
		throw new Error(
			`${JSON.stringify(redact(name))} is not a builtin, so ken help has no page for it. ` +
				`If it is an external command, run \`ken ${redact(name)} --help\`; run \`ken help\` for every command.`
		)
	}
}

/** The builtins. A command added later adds its entry here; a builtin cannot be shadowed. */
export const COMMANDS: Record<string, Command> = {
	init: initCommand,
	path,
	which,
	get: getCommand,
	index,
	config,
	help
}

function overview(): string {
	return [
		'ken: the kernel of a ken root, a workspace that is a knowledge base with every checkout',
		'inside it at .repos/<host>/<owner>/<repo>, and each branch beside it at <repo>.<branch>.',
		'',
		'Usage: ken <command> [<args>]',
		'',
		'Commands:',
		...Object.values(COMMANDS).map((c) =>
			indent([c.usage, indent([c.summary, ...c.examples].join('\n'), '    ')].join('\n'), '  ')
		),
		'',
		externals(Object.keys(COMMANDS)),
		'',
		`The root is KEN_ROOT, else "root" in ${configPath()}, else ~/ken.`,
		'Run `ken <command> --help` for its forms.'
	].join('\n')
}

/** The builtin called `name`, if any: it always wins over a `ken-<name>` (decision 10). */
export const builtin = (name: string): Command | undefined =>
	Object.hasOwn(COMMANDS, name) ? COMMANDS[name] : undefined
