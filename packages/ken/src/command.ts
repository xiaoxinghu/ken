/** A builtin: its entry in `ken help`, the same examples in `ken <name> --help`, and what it runs. */
export type Command = {
	/** The synopsis after `ken`, starting with the command's name. */
	usage: string
	summary: string
	/** Only in `ken <name> --help`: the forms and what each prints. */
	details?: string
	examples: string[]
	/** Returns what goes to stdout. Throws a message that says what to run next. */
	run: (args: string[]) => string
}

export const indent = (text: string, by: string): string => text.replace(/^/gm, by)

/** What `ken <name> --help` prints. */
export function commandHelp(command: Command): string {
	return [
		`ken ${command.usage}`,
		'',
		command.summary,
		...(command.details ? ['', command.details] : []),
		'',
		'Examples:',
		indent(command.examples.join('\n'), '  ')
	].join('\n')
}
