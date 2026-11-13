// `ken path` and `ken which`: the layout's addresses, from a key to a path and back (PRD 5, 16).
import { existsSync, realpathSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { die, q } from './die.ts'
import { git } from './git.ts'
import { branchFolder, isKey, parseKey, redact } from './keys.ts'
import { findRoot, realPath } from './root.ts'

const isDir = (path: string) => statSync(path, { throwIfNoEntry: false })?.isDirectory() ?? false

/** The folder of every checkout of `root`. */
export const reposOf = (root: string) => join(root, '.repos')

/** `ken path root | code <key> [<branch>] | <key>:<path>[#<symbol>]`. */
export const path = (args: string[]) => {
	const [form = '', ...rest] = args
	if (form === 'root') {
		if (rest.length) die('ken path root takes no arguments. Run `ken path root`.')
		return `${findRoot()}\n`
	}
	if (form === 'code') {
		if (rest.length < 1 || rest.length > 2)
			die(
				`ken path code takes <key> [<branch>], got ${rest.length} arguments.`,
				'Run e.g. `ken path code github.com/acme/join-web feat/login`.'
			)
		const { key } = parseKey(rest[0] ?? '')
		const folder = rest[1] === undefined ? '' : `.${branchFolder(rest[1])}`
		return `${join(reposOf(findRoot()), key)}${folder}\n`
	}
	if (form.includes(':')) {
		if (rest.length)
			die(
				`ken path takes one reference, got ${q(redact(args.join(' ')))}. Quote a path with spaces.`,
				'Run `ken path --help` for the forms.'
			)
		const colon = form.indexOf(':')
		const { key } = parseKey(form.slice(0, colon))
		const rel = form.slice(colon + 1).split('#')[0] ?? ''
		let depth = 0
		for (const part of rel.split('/')) {
			depth += part === '..' ? -1 : part === '' || part === '.' ? 0 : 1
			if (depth < 0)
				die(
					`${q(redact(form))} points outside its repo: the path after the colon is relative to the`,
					`repo's root and cannot climb out of it. Write it as ${key}:<path>[#<symbol>].`
				)
		}
		const clone = join(reposOf(findRoot()), key)
		if (isDir(clone)) return `${clone}${rel ? `/${rel}` : ''}\n`
		process.stderr.write(
			`ken: ${key} is not cloned here, so ${redact(rel || 'its root')} has no local path; printed` +
				` its URL instead. Run \`ken get ${key}\` to clone it, then \`ken path ${q(redact(form))}\` again.\n`
		)
		return `https://${key}.git\n`
	}
	return die(
		`ken path does not take ${q(redact(form))}: it takes root, code <key> [<branch>], or a code`,
		'reference <key>:<path>[#<symbol>]. Run `ken path --help` for what each prints.'
	)
}

/** `ken which [<path>]`: `<key> <clone|worktree> [<branch>]` of the checkout `<path>` is in. */
export const which = (args: string[]) => {
	if (args.length > 1)
		die(
			`ken which takes one path, got ${args.length}: quote a path with spaces.`,
			'Run e.g. `ken which .`.'
		)
	const repos = reposOf(findRoot())
	const at = realPath(args[0] ?? '.')
	const nowhere = () =>
		die(
			`${at} is in ${repos}, the folder of every checkout of the root, but in no checkout, so it`,
			`has no key: a checkout is a folder ${repos}/<host>/<owner>/<repo>, or <repo>.<branch>`,
			'beside it. Run `ken path code <key> [<branch>]` for the folder of one.'
		)
	if (at !== repos && !at.startsWith(`${repos}/`))
		die(
			`${at} is outside ${repos}, the folder of every checkout of the root, so it is in no`,
			'checkout and has no key. Run `ken which` on a path inside a checkout, such as one',
			'`ken path code <key>` prints.'
		)
	const [host = '', owner = '', folder] = at.slice(repos.length + 1).split('/')
	if (folder === undefined) return nowhere()
	const dir = join(repos, host, owner, folder)
	if (existsSync(dir) && !isDir(dir)) nowhere()
	// its shape: <repo>.<x> beside a clone <repo>, a .git folder, is its worktree; the folder
	// name of a worktree holds a branch, so only the clone's name is a key
	let repo = folder
	let kind = 'clone'
	for (let dot = folder.lastIndexOf('.'); dot > 0; dot = folder.lastIndexOf('.', dot - 1)) {
		if (isDir(join(dirname(dir), folder.slice(0, dot), '.git'))) {
			repo = folder.slice(0, dot)
			kind = 'worktree'
			break
		}
	}
	if (!existsSync(dir)) return `${parseKey(`${host}/${owner}/${repo}`).key} ${kind}\n`
	if (!existsSync(join(dir, '.git'))) {
		const { key } = parseKey(`${host}/${owner}/${repo}`)
		die(
			`${dir} is where a checkout belongs, but it has no .git, so it is no checkout and has no`,
			`branch. Look inside; if nothing there is needed, remove it and run \`ken get ${key}${kind === 'worktree' ? ' -b <branch>' : ''}\`.`
		)
	}
	const dirs = git(dir, 'rev-parse', '--path-format=absolute', '--git-dir', '--git-common-dir')
	if (!dirs.ok)
		die(
			`git cannot read the checkout ${dir}, so ken cannot tell its key or branch. git said:`,
			`${dirs.err.trim()}\nRun \`git -C ${q(dir)} status\` to see what is wrong.`
		)
	const [gitDir = '', common = ''] = dirs.out.split('\n')
	const branch = git(dir, 'branch', '--show-current').out
	const tail = branch ? ` ${branch}` : ''
	if (gitDir === common) return `${parseKey(`${host}/${owner}/${folder}`).key} clone${tail}\n`
	// a worktree's key is its clone's, wherever the worktree's folder is
	const clone = dirname(realpathSync.native(common))
	const key = clone.slice(repos.length + 1)
	if (clone.startsWith(`${repos}/`) && isKey(key)) return `${key} worktree${tail}\n`
	return die(
		`${dir} is a worktree of ${clone}, a clone outside ${repos}/<host>/<owner>/<repo>, so it has`,
		`no key, and a worktree in ${repos} must belong to a clone there. Move it beside its clone:`,
		`\`git -C ${q(clone)} worktree move ${q(dir)} ${q(join(dirname(clone), folder))}\`.`
	)
}
