import { type Command, commandHelp, indent } from './command.ts'
import { config } from './config.ts'
import { initCommand } from './init.ts'
import { redact } from './key.ts'
import { path } from './path.ts'
import { configPath } from './root.ts'

const help: Command = {
	usage: 'help [<command>]',
	summary: 'Print every command with examples, or one in full as `ken <command> --help` does.',
	examples: ['ken help', 'ken help path'],
	run([name, ...rest]) {
		if (name === undefined) return overview()
		if (rest.length) throw new Error('ken help takes one command. Run e.g. `ken help path`.')
		return commandHelp(lookup(name))
	}
}

/** The builtins. A command added later adds its entry here; a builtin cannot be shadowed. */
export const COMMANDS: Record<string, Command> = { init: initCommand, path, config, help }

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
		`The root is KEN_ROOT, else "root" in ${configPath()}, else ~/ken.`,
		'Run `ken <command> --help` for its forms.'
	].join('\n')
}

export function lookup(name: string): Command {
	const command = Object.hasOwn(COMMANDS, name) ? COMMANDS[name] : undefined
	if (command) return command
	throw new Error(
		`${JSON.stringify(redact(name))} is not a ken command. ` +
			`The commands are ${Object.keys(COMMANDS).join(', ')}: run \`ken help\` for what each does.`
	)
}
