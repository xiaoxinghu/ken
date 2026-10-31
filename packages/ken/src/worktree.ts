import { spawnSync } from 'node:child_process'
import {
	cpSync,
	existsSync,
	lstatSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	rmSync
} from 'node:fs'
import { basename, dirname, isAbsolute, join, normalize, sep } from 'node:path'
import { parse } from 'yaml'
import { branchFolder } from './branch.ts'
import { shellWord } from './command.ts'
import { git } from './git.ts'

/** What a repo's committed `.ken.yaml` asks of each new worktree (PRD "Configuration"). */
type RepoYaml = { copy: string[]; setup?: string }

/**
 * Give `branch` of the clone `clone` (of `key`) its worktree beside it, `<clone>.<folder>`, and
 * return its path. A new branch is made from `from`, or the default branch as it stands; its
 * creation is the lock, and a failure after it, up to reading the worktree's `.ken.yaml`, undoes
 * it. The default branch is the clone's; a branch with a worktree returns that.
 */
export function worktree(clone: string, key: string, branch: string, from?: string): string {
	const path = `${clone}.${branchFolder(branch)}`
	const get = `ken get ${key} -b ${shellWord(branch)}`
	const main = defaultBranch(clone)
	const exists = branchExists(clone, branch)
	if (exists || branch === main.name) {
		if (from !== undefined) {
			throw new Error(
				`branch ${branch} exists in ${clone}, so --from ${from} cannot be its base: ken never moves a ` +
					`branch. Run \`${get}\` for its worktree, or pick a new branch name for --from.`
			)
		}
		if (branch === main.name) return clone
		const held = worktreeOf(clone, branch)
		if (held !== undefined) {
			if (existsSync(held)) return held
			throw new Error(
				`branch ${branch} is checked out in ${held}, which is gone from disk, so git will not check ` +
					`it out again. Run \`git -C ${shellWord(clone)} worktree prune\`, then \`${get}\`.`
			)
		}
	} else if (from === undefined && !main.born) {
		throw new Error(
			`${clone} has no commit on its default branch ${main.name}, so there is nothing to branch ${branch} ` +
				`from. Commit there first, then run \`${get}\`; or base it on another ref with \`${get} --from <ref>\`.`
		)
	}
	requireFree(clone, path)
	if (!exists) {
		try {
			// full ref name: the short one turns ambiguous once a tag of the same name exists
			git(clone, 'branch', branch, from ?? main.ref)
		} catch (e) {
			if (!branchExists(clone, branch)) {
				throw new Error(`could not create branch ${branch} in ${clone}: ${(e as Error).message}`)
			}
			throw new Error(
				`branch ${branch} exists in ${clone}: another caller created it first, and ken never moves a ` +
					`branch. Run \`${get}\`, without --from, for its worktree.`
			)
		}
	}
	let repo: RepoYaml
	let made = false
	try {
		// the folder is the worktree's lock, as the branch is the branch's: of two callers that
		// both found it free, only one makes it, and a failure removes only what this one made
		mkdirSync(path) // fails on anything there; git adds a worktree into an empty folder
		made = true
		git(clone, 'worktree', 'add', '-q', path, branch)
		repo = readRepoYaml(path)
	} catch (e) {
		// a lost folder hands the branch on to the caller that made it, worktree or not yet
		const lost = !made && (e as NodeJS.ErrnoException).code === 'EEXIST'
		const undone = release(clone, branch, path, made, !exists && !lost)
		const why = lost
			? `${path} appeared meanwhile: another caller is giving ${branch} its worktree`
			: (e as Error).message
		throw new Error(
			`could not make the worktree of ${branch} at ${path}, so ken ${undone}: ${why}\n` +
				(!lost
					? `Fix the cause, then run \`${get}${from === undefined ? '' : ` --from ${shellWord(from)}`}\`.`
					: `Run \`${get}\` for its path once that caller is done.`)
		)
	}
	prepare(repo, clone, path)
	return path
}

/** The clone's default branch, the one its HEAD names, and whether it has a commit yet. */
function defaultBranch(clone: string): { ref: string; name: string; born: boolean } {
	let ref: string
	try {
		ref = git(clone, 'symbolic-ref', '-q', 'HEAD')
	} catch {
		throw new Error(
			`${clone} has a detached HEAD, so ken cannot tell its default branch, which the clone holds. ` +
				`Check it out there, e.g. \`git -C ${shellWord(clone)} switch main\`, then rerun.`
		)
	}
	return { ref, name: ref.replace(/^refs\/heads\//, ''), born: verify(clone, ref) }
}

const branchExists = (clone: string, branch: string) => verify(clone, `refs/heads/${branch}`)

function verify(clone: string, ref: string): boolean {
	return spawnSync('git', ['show-ref', '--verify', '--quiet', ref], { cwd: clone }).status === 0
}

/** Every worktree of the clone, the clone first, with the branch it has checked out, as git lists them. */
function worktrees(clone: string): { path: string; branch?: string }[] {
	const list: { path: string; branch?: string }[] = []
	for (const line of git(clone, 'worktree', 'list', '--porcelain', '-z').split('\0')) {
		if (line.startsWith('worktree ')) list.push({ path: line.slice('worktree '.length) })
		const last = list.at(-1)
		if (last && line.startsWith('branch refs/heads/'))
			last.branch = line.slice('branch refs/heads/'.length)
	}
	return list
}

/** The worktree that has `branch` checked out, the clone included. */
const worktreeOf = (clone: string, branch: string) =>
	worktrees(clone).find((w) => w.branch === branch)?.path

/**
 * Throw if anything is at `path`, or a folder beside it differs from it only by case, which is
 * the same folder on a case-insensitive disk and a trap on any other (decision 15).
 */
function requireFree(clone: string, path: string): void {
	const name = basename(path)
	const twin = readdirSync(dirname(path)).find(
		(n) => n !== name && n.toLowerCase() === name.toLowerCase()
	)
	const taken = twin ?? (lstatSync(path, { throwIfNoEntry: false }) ? name : undefined)
	if (taken === undefined) return
	const other = join(dirname(path), taken)
	const held = worktrees(clone).find((w) => w.path === other)?.branch
	const what = held
		? `the worktree of branch ${held}`
		: 'not a worktree of this clone: a repo named so, or a folder'
	throw new Error(
		`the worktree belongs at ${path}, and ${other} ${twin ? 'differs from it only by case' : 'is in the way'}: ` +
			`${what}. Two branches that map to one folder collide, so nothing was created. ` +
			`Pick another branch name, or move ${other} aside${held ? ` with \`git -C ${shellWord(clone)} worktree move ${shellWord(other)} <path>\`` : ''}, then rerun.`
	)
}

/**
 * Undo a worktree that failed, only what this caller made: the folder, and the worktree in it if
 * git got that far; the branch if it is to go and no worktree holds it. Says what.
 */
function release(
	clone: string,
	branch: string,
	path: string,
	made: boolean,
	ours: boolean
): string {
	const undone: string[] = []
	if (made) {
		if (worktreeOf(clone, branch) === path) git(clone, 'worktree', 'remove', '--force', path)
		rmSync(path, { recursive: true, force: true })
		undone.push('removed the worktree')
	}
	if (ours && worktreeOf(clone, branch) === undefined) {
		git(clone, 'branch', '-D', branch)
		undone.push('deleted the branch')
	}
	return undone.length ? `${undone.join(' and ')} again` : 'left them as they are'
}

/** Read the worktree's `.ken.yaml`: `copy`, paths inside the repo, and `setup`, a command. */
function readRepoYaml(dir: string): RepoYaml {
	const file = join(dir, '.ken.yaml')
	if (!existsSync(file)) return { copy: [] }
	const fail = (what: string): never => {
		throw new Error(
			`${file} ${what}. A repo's .ken.yaml takes \`copy: [<path>...]\`, paths relative to the repo, ` +
				'and `setup: <command>`. Fix it on the branch you base on.'
		)
	}
	let doc: unknown
	try {
		doc = parse(readFileSync(file, 'utf8')) ?? {}
	} catch (e) {
		return fail(`is not valid YAML: ${(e as Error).message.trimEnd()}`)
	}
	if (typeof doc !== 'object' || doc === null || Array.isArray(doc)) return fail('is not a mapping')
	const { copy = [], setup } = doc as Record<string, unknown>
	const inside = (p: unknown) =>
		typeof p === 'string' &&
		p !== '' &&
		!isAbsolute(p) &&
		!`${normalize(p)}${sep}`.startsWith(`..${sep}`)
	if (!Array.isArray(copy) || !copy.every(inside)) {
		fail(`has copy: ${JSON.stringify(copy)}, which is not a list of paths inside the repo`)
	}
	if (setup !== undefined && (typeof setup !== 'string' || setup === '')) {
		fail(`has setup: ${JSON.stringify(setup)}, which is not a command`)
	}
	return { copy: copy as string[], setup: setup as string | undefined }
}

/**
 * Copy `repo.copy` from the clone into the new worktree, then run `repo.setup` there with its
 * output on stderr, so stdout stays the path. A failure keeps the worktree and names the commands
 * that finish it by hand.
 */
function prepare(repo: RepoYaml, clone: string, path: string): void {
	const { copy, setup } = repo
	const steps = (from: number) => [
		...copy.slice(from).map((p) => {
			const to = join(path, p)
			return `mkdir -p ${shellWord(dirname(to))} && cp -R ${shellWord(join(clone, p))} ${shellWord(to)}`
		}),
		...(setup ? [`cd ${shellWord(path)} && sh -c ${shellWord(setup)}`] : [])
	]
	const kept = (why: string, from: number) =>
		new Error(
			`${why}. The worktree of the branch is kept at ${path}. Finish it by hand:\n` +
				steps(from)
					.map((s) => `  ${s}`)
					.join('\n')
		)
	for (const [i, p] of copy.entries()) {
		const from = join(clone, p)
		if (!existsSync(from)) {
			throw kept(
				`${from}, which the repo's .ken.yaml says to copy into each new worktree, does not exist; put it in the clone`,
				i
			)
		}
		try {
			mkdirSync(dirname(join(path, p)), { recursive: true })
			cpSync(from, join(path, p), { recursive: true })
		} catch (e) {
			throw kept(`could not copy ${from}: ${(e as Error).message}`, i)
		}
	}
	if (!setup) return
	const r = spawnSync('sh', ['-c', setup], { cwd: path, stdio: ['inherit', 2, 'inherit'] })
	if (r.error || r.status !== 0) {
		const why = r.error?.message ?? (r.signal ? `killed by ${r.signal}` : `exit ${r.status}`)
		throw kept(`the setup \`${setup}\` from the repo's .ken.yaml failed (${why})`, copy.length)
	}
}
