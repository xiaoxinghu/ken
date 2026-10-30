import { join } from 'node:path'
import { branchFolder } from './branch.ts'
import type { Command } from './command.ts'
import { parseKey, redact } from './key.ts'
import { findRoot } from './root.ts'

/** A repo's clone, `.repos/<key>`, or the worktree of one of its branches beside it. */
export function codePath(root: string, key: string, branch?: string): string {
	const clone = join(root, '.repos', key)
	return branch === undefined ? clone : `${clone}.${branchFolder(branch)}`
}

const FORMS = 'root, repos, bin, or code <key> [<branch>]'

export const path: Command = {
	usage: 'path <what>',
	summary: 'Print a path in the root, whether or not it exists. Nobody pastes absolute paths.',
	details: [
		'  root                    the root, as a real path',
		'  repos                   <root>/.repos, where every checkout lives',
		"  bin                     <root>/.bin, the root's ken-* scripts",
		'  code <key> [<branch>]   the clone, <root>/.repos/<key>, or the worktree of <branch> beside',
		'                          it, <root>/.repos/<key>.<branch> with / as -. <key> is',
		'                          <host>/<owner>/<repo> or a git URL.'
	].join('\n'),
	examples: [
		'ken path root',
		'ken path code github.com/acme/join-web',
		'ken path code github.com/acme/join-web feat/login   # .../join-web.feat-login',
		'cd "$(ken path code git@github.com:acme/join-web.git PROJ-123)"'
	],
	run([what, ...args]) {
		switch (what) {
			case 'root':
			case 'repos':
			case 'bin': {
				if (args.length) {
					throw new Error(`ken path ${what} takes no arguments. Run \`ken path ${what}\`.`)
				}
				const root = findRoot()
				return what === 'root' ? root : join(root, `.${what}`)
			}
			case 'code': {
				const [input, branch] = args
				if (!input || args.length > 2) {
					throw new Error(
						`ken path code takes <key> [<branch>], got ${args.length} arguments. ` +
							'Run e.g. `ken path code github.com/acme/join-web feat/login`.'
					)
				}
				const { key } = parseKey(input)
				if (branch !== undefined) branchFolder(branch)
				return codePath(findRoot(), key, branch)
			}
			default:
				throw new Error(
					`${what === undefined ? 'ken path needs what to print' : `ken path does not resolve ${JSON.stringify(redact(what))}`}: ` +
						`it takes ${FORMS}. Run \`ken path --help\` for what each prints.`
				)
		}
	}
}
