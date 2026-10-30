import { existsSync, realpathSync, statSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import type { Command } from './command.ts'
import { git } from './git.ts'
import { parseKey } from './key.ts'
import { findRoot } from './root.ts'

/** The checkout a path is in. `branch` is null when it is not checked out yet, or detached. */
export type Place = { key: string; kind: 'clone' | 'worktree'; branch: string | null }

/** `path` as a real path: the realpath of its longest existing prefix, then the rest as written. */
function realPath(path: string): string {
	let head = path
	const tail: string[] = []
	while (!existsSync(head)) {
		tail.unshift(basename(head))
		head = dirname(head)
	}
	return join(realpathSync.native(head), ...tail)
}

/**
 * The checkout `path` is in, from git when it exists and from its shape when it does not yet
 * (PRD decisions 2 and 15). Throws when the path is in no checkout under `root`.
 */
export function locate(path: string, root: string): Place {
	const real = realPath(resolve(path))
	const rel = relative(root, real)
	if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
		throw new Error(
			`${real} is not under the ken root ${root}, so it is in no checkout of it. ` +
				'Run `ken path code <key> [<branch>]` for a checkout here, or set KEN_ROOT to the root this path is in.'
		)
	}
	const [repos, host = '', owner = '', folder = ''] = rel.split(sep)
	const dir = join(root, '.repos', host, owner, folder)
	if (repos !== '.repos' || !folder || (existsSync(dir) && !statSync(dir).isDirectory())) {
		throw new Error(
			`${real} is in the ken root but outside .repos/, so it is in no repo checkout: checkouts are ` +
				'.repos/<host>/<owner>/<repo> and .repos/<host>/<owner>/<repo>.<branch>. ' +
				'Run `ken path code <key> [<branch>]` for one.'
		)
	}
	const keyOf = (repo: string) => parseKey(`${host}/${owner}/${repo}`).key
	if (!existsSync(dir)) {
		// not checked out yet: `<repo>.<anything>` beside an existing clone `<repo>` is its worktree
		const clone = [...folder.matchAll(/\./g)]
			.map((m) => folder.slice(0, m.index))
			.findLast((c) => c && existsSync(join(dir, '..', c)))
		return clone
			? { key: keyOf(clone), kind: 'worktree', branch: null }
			: { key: keyOf(folder), kind: 'clone', branch: null }
	}
	if (!existsSync(join(dir, '.git'))) {
		throw new Error(
			`${dir} is where a checkout belongs, but it is not a git checkout (it has no .git), so it ` +
				`has no key or branch. Look inside; if nothing there is needed, remove it and run \`ken get ${keyOf(folder)}\`.`
		)
	}
	const [gitDir, common = ''] = git(
		dir,
		'rev-parse',
		'--path-format=absolute',
		'--git-dir',
		'--git-common-dir'
	).split('\n')
	const branch = git(dir, 'branch', '--show-current') || null
	if (gitDir === common) return { key: keyOf(folder), kind: 'clone', branch }
	// a worktree's key is its clone's, wherever the worktree's folder is
	const clone = dirname(realpathSync.native(common))
	const parts = relative(join(root, '.repos'), clone).split(sep)
	if (parts.length !== 3 || parts[0] === '..' || isAbsolute(parts[0] ?? '')) {
		throw new Error(
			`${dir} is a worktree of ${clone}, which is not a clone at .repos/<host>/<owner>/<repo>, so it ` +
				`has no key. Remove it with \`git -C ${clone} worktree remove ${dir}\`, then make it in the ` +
				'layout with `ken get <key> -b <branch>`.'
		)
	}
	return { key: keyOf(parts[2] ?? ''), kind: 'worktree', branch }
}

export const which: Command = {
	usage: 'which [<path>] [--json]',
	summary:
		'Reverse of `ken path code`: the repo key of the checkout a path is in, clone or worktree, and its branch.',
	details: [
		'  <path>    default the current directory; compared as a real path, so a path through a',
		"            layer's link resolves. A checkout's branch and whether it is a worktree come",
		'            from git; a path not checked out yet is answered from its shape, with no branch.',
		'  --json    {"key", "kind": "clone"|"worktree", "branch"}, branch null when not known.',
		'',
		'Prints `<key> <clone|worktree> <branch>`, the branch left out when not checked out yet or',
		'detached. Exits 1 for a path outside .repos/, saying so.'
	].join('\n'),
	examples: [
		'ken which',
		'ken which "$(ken path code github.com/acme/join-web feat/login)"   # github.com/acme/join-web worktree feat/login',
		'ken which --json .repos/github.com/acme/api/src/x.ts   # not cloned yet: {"key":...,"kind":"clone","branch":null}'
	],
	run(args) {
		const json = args.includes('--json')
		const rest = args.filter((a) => a !== '--json')
		if (rest.length > 1 || rest[0]?.startsWith('-')) {
			throw new Error(
				`ken which takes one path and --json, got ${JSON.stringify(rest)}. ` +
					'Run e.g. `ken which --json .repos/github.com/acme/join-web/src`.'
			)
		}
		const place = locate(rest[0] ?? '.', findRoot())
		if (json) return JSON.stringify(place)
		return [place.key, place.kind, ...(place.branch ? [place.branch] : [])].join(' ')
	}
}
