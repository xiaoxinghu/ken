// `ken get <url|key> [-b <branch> [--from <ref>]]`: the one write into the layout, idempotent,
// the path the only thing on stdout (docs/prd.md, "The core").
import { spawnSync } from 'node:child_process'
import {
	appendFileSync,
	lstatSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	readlinkSync,
	rmdirSync,
	rmSync,
	statSync,
	symlinkSync
} from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { die, q } from './die.ts'
import { parseSettings, setFields } from './files.ts'
import { alive, checkGit, git, sleep } from './git.ts'
import { branchFolder, keyOf, parseKey, redact } from './keys.ts'
import { reposOf } from './layout.ts'
import { editIndex } from './registry.ts'
import { findRoot, isFile } from './root.ts'

const say = (...parts: string[]) => process.stderr.write(`ken: ${parts.join(' ')}\n`)
const isDir = (path: string) => statSync(path, { throwIfNoEntry: false })?.isDirectory() ?? false
const absent = (path: string) => !lstatSync(path, { throwIfNoEntry: false })

/** Link `CLAUDE.md -> AGENTS.md` in the fresh checkout `dir` when it has AGENTS.md and no
 * CLAUDE.md, listed in its repo's info/exclude: Claude Code reads a checkout's AGENTS.md only
 * while no CLAUDE.md is at or above it, and the root's is above it (PRD 6). */
const claudeLink = (dir: string) => {
	if (!isFile(join(dir, 'AGENTS.md')) || !absent(join(dir, 'CLAUDE.md'))) return
	try {
		symlinkSync('AGENTS.md', join(dir, 'CLAUDE.md'))
	} catch {
		return
	}
	const common = git(dir, 'rev-parse', '--path-format=absolute', '--git-common-dir')
	if (common.ok) {
		// one exclude file for the clone and its worktrees, so the line goes in once
		const exclude = join(common.out, 'info/exclude')
		const text = isFile(exclude) ? readFileSync(exclude, 'utf8') : ''
		if (!text.split('\n').includes('/CLAUDE.md')) {
			mkdirSync(dirname(exclude), { recursive: true })
			appendFileSync(exclude, `${text && !text.endsWith('\n') ? '\n' : ''}/CLAUDE.md\n`)
		}
	}
	say(
		`linked ${dir}/CLAUDE.md -> AGENTS.md, excluded from git: Claude Code reads a checkout's`,
		"AGENTS.md only while no CLAUDE.md is at or above it, and a root's is above every checkout."
	)
}

/** Stop when the root's git does not ignore `.repos/`, or `key` is the root's own repo (PRD 9). */
const guardRoot = (root: string, key: string, again: string) => {
	if (!git(root, 'rev-parse', '--show-toplevel').ok) return
	if (spawnSync('git', ['-C', root, 'check-ignore', '-q', '.repos/']).status === 1)
		die(
			`${root}/.repos is not ignored by the git of ${root}, so every clone ken makes there would`,
			'show in its status and could be committed into the knowledge base. Add the line .repos/ to',
			`${root}/.gitignore, e.g. \`printf '.repos/\\n' >> ${q(`${root}/.gitignore`)}\`, or run`,
			`\`ken init ${q(root)}\`, which adds it; then run \`${again}\` again.`
		)
	const origin = git(root, 'config', '--get', 'remote.origin.url')
	if (origin.ok && keyOf(origin.out)?.key === key)
		die(
			`${key} is the repo of the root ${root} itself, its origin, and its clone in ${root}/.repos`,
			`would be a root inside itself. Work on the root in place, in ${root}, with git there.`
		)
}

export const get = (args: string[]) => {
	let asked: string | undefined
	let branch: string | undefined
	let from: string | undefined
	let opts = ''
	for (let i = 0; i < args.length; i++) {
		const arg = args[i] ?? ''
		if (arg === '-b' || arg === '--from') {
			const value = args[++i]
			if (value === undefined)
				die(`ken get ${arg} needs a value. Run e.g. \`ken get <key> -b feat/login\`.`)
			if (arg === '-b') branch = value
			else from = value
			opts += ` ${arg} ${q(redact(value))}`
		} else if (asked !== undefined || arg.startsWith('-'))
			die(
				'ken get takes one repo key or git URL, then -b <branch> [--from <ref>], not',
				`${q(redact(arg))} as well. Run e.g. \`ken get github.com/acme/join-web -b feat/login\`.`
			)
		else asked = arg
	}
	if (from !== undefined && branch === undefined)
		die(
			'ken get --from names what a new branch starts from, so it needs -b <branch>.',
			'Run e.g. `ken get <key> -b fix/x --from v1.2`.'
		)
	if (asked === undefined)
		die('ken get needs a repo key or git URL. Run e.g. `ken get github.com/acme/join-web`.')
	const { key, url } = parseKey(asked)
	// a bad branch name is refused before anything is touched
	const folder = branch === undefined ? '' : `.${branchFolder(branch)}`
	const again = `ken get ${key}${opts}`
	checkGit(again)
	const root = findRoot()
	guardRoot(root, key, again)
	const blobless = parseSettings(readFileSync(join(root, '.ken'), 'utf8'), join(root, '.ken')).get(
		'clone.blobless'
	)
	if (blobless !== undefined && !['', 'true', 'false'].includes(blobless))
		die(
			`${root}/.ken sets clone.blobless to neither true nor false, so ken cannot tell how to clone.`,
			`Fix that line to clone.blobless=false or true, then run \`${again}\` again.`
		)
	const repos = reposOf(root)
	const clone = join(repos, key)
	const parent = dirname(clone)
	for (const at of [repos, dirname(parent), parent]) {
		if (!lstatSync(at, { throwIfNoEntry: false })?.isSymbolicLink()) continue
		const to = resolve(dirname(at), readlinkSync(at))
		die(
			`${at} is a symlink to ${to}, so a clone under it would be outside ${root}, where a checkout`,
			"is found by its real path and loads the root's rules from above it. Put the folder in its",
			`place, \`rm ${q(at)} && mv ${q(to)} ${q(at)}\`, or start an empty one, \`rm ${q(at)}\`; then`,
			`run \`${again}\` again.`
		)
	}
	// every get marks itself before the claim, the mkdir of the clone's folder, so one that
	// loses it waits while the winner lives: its clone is whole once the mark is gone
	const repo = basename(clone)
	const mark = join(parent, `.${repo}.ken-get.${process.pid}`)
	try {
		mkdirSync(mark, { recursive: true })
	} catch (e) {
		die(
			`could not make ${parent}: ${(e as Error).message}, so ${key} has no folder to be cloned`,
			`into. Fix that, then run \`${again}\` again.`
		)
	}
	try {
		let fresh = false
		try {
			mkdirSync(clone)
			fresh = true
		} catch (e) {
			if ((e as NodeJS.ErrnoException).code !== 'EEXIST')
				die(
					`could not make ${clone}: ${(e as Error).message}. Fix that, then run \`${again}\` again.`
				)
		}
		if (fresh) cloneInto(clone, url, blobless !== 'false', asked, opts, key)
		else {
			rmdirSync(mark)
			const marks = new RegExp(`^\\.${repo.replaceAll('.', '\\.')}\\.ken-get\\.([0-9]+)$`)
			while (readdirSync(parent).some((name) => alive(Number(marks.exec(name)?.[1] ?? Number.NaN))))
				sleep(200)
		}
		checkClone(clone, key, again)
		// another get of an existing repo may hold git's config lock, setting the same: wait, retry
		// true in the clone's own config, whatever a global one says
		const relative = () =>
			git(clone, 'config', '--local', '--type=bool', '--get', 'worktree.useRelativePaths').out ===
				'true' || git(clone, 'config', '--local', 'worktree.useRelativePaths', 'true').ok
		if (!relative() && !(sleep(1000) && relative()))
			die(
				`could not set worktree.useRelativePaths in ${clone}, which lets its <owner>/ folder and`,
				`the root move. Run \`git -C ${q(clone)} config worktree.useRelativePaths true\`, then`,
				`\`${again}\` again.`
			)
		spawnSync('git', ['-C', clone, 'worktree', 'repair'], { stdio: ['ignore', 2, 2] })
		if (fresh) claudeLink(clone)
		register(root, key, clone)
		return `${branch === undefined ? clone : worktree(clone, key, branch, from, folder, again)}\n`
	} finally {
		rmSync(mark, { recursive: true, force: true })
	}
}

/** Clone `url` into the empty folder `clone`, removing it again when the clone fails. */
const cloneInto = (
	clone: string,
	url: string,
	blobless: boolean,
	asked: string,
	opts: string,
	key: string
) => {
	let interrupted = false
	const stop = () => {
		interrupted = true
	}
	const signals = ['SIGINT', 'SIGTERM', 'SIGHUP'] as const
	for (const s of signals) process.on(s, stop)
	const r = spawnSync(
		'git',
		['clone', '-q', ...(blobless ? ['--filter=blob:none'] : []), '--', url, clone],
		{ encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
	)
	for (const s of signals) process.off(s, stop)
	if (r.status === 0 && !interrupted) return
	rmSync(clone, { recursive: true, force: true })
	const rerun = `ken get ${q(redact(asked))}${opts}`
	if (interrupted)
		die(
			`the clone of ${key} was interrupted, so ${clone} was removed again. Run \`${rerun}\` to clone it.`
		)
	const hint = asked.includes(':')
		? ''
		: `A key alone clones https://${key}.git; for another remote pass its URL, e.g. \`ken get git@${key.replace('/', ':')}.git\`. `
	die(
		`could not clone ${redact(url)} into ${clone}, so it was removed again. git said:`,
		`${redact((r.stderr ?? '').trim())}\n${hint}Fix the cause, then run \`${rerun}\` again. If the repo`,
		'is not pushed yet, or private to an account this machine lacks, nothing here is wrong: go on',
		'without it.'
	)
}

/** Stop unless `clone` is a clone ken may use as it is: a folder whose own `.git` git takes. */
const checkClone = (clone: string, key: string, again: string) => {
	const stat = lstatSync(clone, { throwIfNoEntry: false })
	if (!stat)
		die(
			`${clone} is gone: another \`ken get ${key}\` was cloning into it and failed, saying why in`,
			`its own output. Run \`${again}\` again to clone it here.`
		)
	const dotGit = stat.isDirectory()
		? lstatSync(join(clone, '.git'), { throwIfNoEntry: false })
		: undefined
	const what = stat.isSymbolicLink()
		? `a symlink to ${readlinkSync(clone)}`
		: !stat.isDirectory()
			? 'a file'
			: !dotGit
				? 'a folder with no .git'
				: !dotGit.isDirectory()
					? 'a checkout whose .git is not a folder: a worktree, or a repo kept elsewhere'
					: git(clone, 'rev-parse', '--absolute-git-dir').out !== join(clone, '.git')
						? 'a folder whose .git git does not take as its repo'
						: undefined
	if (what)
		die(
			`${clone} is where the clone of ${key} belongs, but it is ${what}, so ken neither uses nor`,
			`replaces it. Move it aside, e.g. \`mv ${q(clone)} ~/${basename(clone)}.aside\`, then run`,
			`\`${again}\` again.${
				what === 'a folder with no .git'
					? ` To make this folder the repo instead, run \`git init ${q(clone)}\` then \`${again}\`.`
					: ''
			}`
		)
}

/** Write the entry of `key` when the index lists none: a clone holding `.ken` is a root whose
 * front page opens with what it is for, so its first line of prose is the desc. */
const register = (root: string, key: string, clone: string) => {
	const file = join(root, '.repos.index')
	let note = ''
	editIndex(root, key, (text, listed) => {
		if (listed) return undefined
		const readme = join(clone, 'README.md')
		const desc =
			isFile(join(clone, '.ken')) && isFile(readme)
				? readFileSync(readme, 'utf8')
						// every line break the index's reader stops on, so the desc is one line
						.split(/\r\n|[\n\r\u2028\u2029]/)
						.find((line) => /^[^#\s<![|`-]/.test(line))
						?.trimEnd()
				: undefined
		note = desc
			? `registered ${key} in ${file} with the first line of its front page as desc: "${desc}". Change it with \`ken index set ${key} desc="..."\`.`
			: `registered ${key} in ${file} with no desc, and a desc is what lets an agent choose a repo before cloning it. Run \`ken index set ${key} desc="..."\` with what it is, in a line.`
		return setFields(text, key, desc ? [['desc', desc]] : [])
	})
	if (note) say(note)
}

/** The worktree of `branch` beside `clone`, made when missing, or the clone for the default
 * branch (PRD 5). */
const worktree = (
	clone: string,
	key: string,
	branch: string,
	from: string | undefined,
	folder: string,
	again: string
) => {
	// the full ref, as --short turns main into heads/main when a tag is named main too
	const head = git(clone, 'symbolic-ref', '-q', 'HEAD')
	if (!head.ok) {
		const origin = git(clone, 'symbolic-ref', '-q', '--short', 'refs/remotes/origin/HEAD')
		die(
			`${clone} has a detached HEAD, so it names no default branch, and the clone holds the`,
			'default branch for every worktree to start from. Run',
			`\`git -C ${q(clone)} switch ${origin.ok ? origin.out.replace(/^origin\//, '') : 'main'}\``,
			`(or the default branch's name), then \`${again}\` again.`
		)
	}
	const def = head.out.replace(/^refs\/heads\//, '')
	const exists =
		branch === def || git(clone, 'show-ref', '-q', '--verify', `refs/heads/${branch}`).ok
	if (exists && from !== undefined)
		die(
			`${branch} exists in ${clone} already, so it is not made again from --from ${q(redact(from))}.`,
			`Run \`ken get ${key} -b ${q(branch)}\` for its worktree, or pick a new branch name.`
		)
	if (branch === def) return clone
	// the worktree holding the branch, asked of git one ref at a time and only for a branch
	// that exists: refs/heads/feat would match refs/heads/feat/x too
	const held = exists
		? git(clone, 'for-each-ref', '--format=%(worktreepath)', `refs/heads/${branch}`).out
		: ''
	if (held && isDir(held)) return held
	if (held)
		die(
			`${branch} is checked out in the worktree ${held}, whose folder is gone, and git checks a`,
			`branch out in one worktree at a time. Run \`git -C ${q(clone)} worktree prune\`, then`,
			`\`${again}\` again.`
		)
	const wt = `${clone}${folder}`
	const parent = dirname(clone)
	const name = basename(wt).toLowerCase()
	const hitName = readdirSync(parent).find((n) => n.toLowerCase() === name)
	if (hitName !== undefined) {
		const hit = join(parent, hitName)
		let its = git(hit, 'branch', '--show-current').out
		if (
			its &&
			git(clone, 'for-each-ref', '--format=%(worktreepath)', `refs/heads/${its}`).out !== hit
		)
			its = ''
		let what = `${hit} is in the way`
		if (hit !== wt)
			what = `${hit} differs only by case from it, one folder on a case-insensitive disk`
		if (its) what += `, a worktree of ${clone} holding the branch ${its}`
		die(
			`the worktree of ${branch} belongs at ${wt}, but ${what}, so ken makes nothing. Pick another`,
			`branch name, or move it aside, e.g. \`mv ${q(hit)} ~/${basename(hit)}.aside\`, then`,
			`\`${again}\` again.`
		)
	}
	let madeBranch = false
	if (!exists) {
		const start = from ?? 'HEAD'
		const base = git(clone, 'rev-parse', '-q', '--verify', '--end-of-options', `${start}^{commit}`)
		if (!base.ok) {
			if (from !== undefined)
				die(
					`${q(redact(from))} is no commit in ${clone}, so ${branch} cannot start from it. Run`,
					`\`git -C ${q(clone)} fetch --tags\` if it is on the remote, then \`${again}\` again.`
				)
			die(
				`the default branch ${def} of ${clone} has no commit yet, so there is nothing to start`,
				`${branch} from. Commit to ${def} there first, or run`,
				`\`ken get ${key} -b ${q(branch)} --from <ref>\`.`
			)
		}
		// the lock: of two gets of one new branch, one makes it
		const made = git(clone, 'branch', branch, base.out)
		if (!made.ok) {
			if (git(clone, 'show-ref', '-q', '--verify', `refs/heads/${branch}`).ok)
				die(
					`${branch} was made in ${clone} just now, by another \`ken get\`, so this one made`,
					`nothing. Run \`ken get ${key} -b ${q(branch)}\`, without --from, for its worktree.`
				)
			die(
				`could not make the branch ${branch} in ${clone}. git said: ${made.err.trim()}\n`,
				`Fix that, then run \`${again}\` again.`
			)
		}
		madeBranch = true
	}
	let madeDir = false
	let err = ''
	try {
		mkdirSync(wt)
		madeDir = true
	} catch (e) {
		err = (e as Error).message
	}
	const added = madeDir ? git(clone, 'worktree', 'add', '-q', '--', wt, branch) : undefined
	if (!added?.ok) {
		err = added?.err.trim() ?? err
		let undone = ''
		if (madeDir) {
			try {
				rmdirSync(wt)
			} catch {}
			undone = absent(wt)
				? ` Removed the folder ${wt} again.`
				: ` Left ${wt}, which is not empty: look inside.`
		}
		// a folder made there since the checks is another get's claim, about to check it out
		const wtStat = lstatSync(wt, { throwIfNoEntry: false })
		if (!madeDir && wtStat?.isDirectory())
			die(
				`${wt} was made just now, by another \`ken get\` adding the worktree of ${branch}, so this`,
				`one stops and leaves ${branch} to it. Run \`ken get ${key} -b ${q(branch)}\` for its worktree.`
			)
		if (madeBranch && git(clone, 'branch', '-q', '-D', branch).ok)
			undone += ` Deleted the branch ${branch} again.`
		else if (madeBranch)
			undone += ` Left the branch ${branch}, which a worktree holds: \`git -C ${q(clone)} worktree list\`.`
		die(
			`could not make the worktree of ${branch} at ${wt}: ${err}\nSo ${branch} has no worktree.${undone}`,
			`Fix that, then run \`${again}\` again.`
		)
	}
	claudeLink(wt)
	return wt
}
