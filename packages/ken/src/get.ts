import {
	existsSync,
	lstatSync,
	mkdirSync,
	readlinkSync,
	realpathSync,
	rmSync,
	statSync
} from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { branchFolder } from './branch.ts'
import { type Command, shellWord } from './command.ts'
import { type Layer, readKenYaml } from './config.ts'
import { git, gitWith, requireGit } from './git.ts'
import { indexFile, readIndex, setFields } from './index.ts'
import { parseKey, redact } from './key.ts'
import { codePath } from './path.ts'
import { findRoot } from './root.ts'
import { worktree } from './worktree.ts'

/**
 * Make the repo `input` names ready in `root` and return its clone, `.repos/<key>`: cloned when
 * missing, a clone already there used as it is (no fetch), anything else there refused. Then set
 * up for relative worktrees and repaired, so a clone moved in with `mv` works, and registered in
 * the root's index when no index lists it (PRD "The kernel", `get`). The clone runs with `env`; a
 * clone that fails throws with git's error as the `cause`.
 */
export function get(root: string, input: string, env = process.env): string {
	const { key, url } = parseKey(input)
	requireGit(git(root, '--version'))
	const { clone, layers } = readKenYaml(root)
	const dir = codePath(root, key)
	requireFolders(root, key)
	mkdirSync(dirname(dir), { recursive: true })
	if (claim(dir)) {
		try {
			// never shallow (decision 14); `--` so a URL is never read as an option
			const filter = clone.blobless ? ['--filter=blob:none'] : []
			gitWith(env, root, 'clone', '-q', ...filter, '--', url, dir)
		} catch (e) {
			rmSync(dir, { recursive: true, force: true })
			const hint =
				url === `https://${key}.git`
					? ` A key alone clones ${url}; for another URL, such as ssh, pass it: \`ken get git@${key.replace('/', ':')}.git\`.`
					: ''
			throw new Error(
				`could not clone ${redact(url)} into ${dir}, so ${key} is not here; nothing was left behind. ` +
					`${(e as Error).message}\nFix the cause, then ${rerun(input.trim())}.${hint}`,
				{ cause: e }
			)
		}
	} else {
		requireClone(dir, key)
	}
	// written only when unset, so parallel gets of one clone do not race for its config lock
	if (
		git(dir, 'config', '--type=bool', '--default=false', 'worktree.useRelativePaths') !== 'true'
	) {
		git(dir, 'config', 'worktree.useRelativePaths', 'true')
	}
	git(dir, 'worktree', 'repair')
	register(root, key, layers)
	return dir
}

/**
 * Throw if `.repos`, the host or the owner folder is a link: a clone under it would be outside the
 * root, where no session in it loads the root's context (decision 3). The root itself is real.
 */
function requireFolders(root: string, key: string): void {
	const [host = '', owner = ''] = key.split('/')
	for (const parts of [['.repos'], ['.repos', host], ['.repos', host, owner]]) {
		const path = join(root, ...parts)
		if (!lstatSync(path, { throwIfNoEntry: false })?.isSymbolicLink()) continue
		const target = existsSync(path) ? realpathSync.native(path) : undefined
		const fix = target
			? `replace the link with what it points to, \`rm ${shellWord(path)} && mv ${shellWord(target)} ${shellWord(path)}\``
			: `the link points nowhere (${readlinkSync(path)}): remove it, \`rm ${shellWord(path)}\``
		throw new Error(
			`${path} is a symlink, so a clone of ${key} under it would be outside the root ${root}, ` +
				"where no session in it loads the root's context. Checkouts live physically inside the root: " +
				`${fix}, then run \`ken get ${key}\`.`
		)
	}
}

/** Make `dir`, failing on anything already there, so of two gets at once only one clones. */
function claim(dir: string): boolean {
	try {
		mkdirSync(dir)
		return true
	} catch (e) {
		if ((e as NodeJS.ErrnoException).code === 'EEXIST') return false
		throw e
	}
}

/** How to run `ken get` again on `input`, never showing a user name or token it holds. */
const rerun = (input: string): string =>
	redact(input) === input
		? `run \`ken get ${shellWord(input)}\` again`
		: 'run `ken get` again with the URL you gave (not shown: it holds a user name or token)'

/** Throw unless `dir` is a clone: a folder of its own (no link) whose `.git` folder git takes as its repo. */
function requireClone(dir: string, key: string): void {
	const stat = lstatSync(dir)
	const dotGit = statSync(join(dir, '.git'), { throwIfNoEntry: false })
	// an empty or broken .git is no repo, and git would go on up to the root's own
	if (stat.isDirectory() && dotGit?.isDirectory() && ownRepo(dir)) return
	const aside = `~/${basename(dir)}.aside`
	const worktree = stat.isDirectory() && dotGit?.isFile()
	const plain = stat.isDirectory() && !dotGit
	const what = stat.isSymbolicLink()
		? 'a symlink'
		: !stat.isDirectory()
			? 'a file'
			: worktree
				? 'a worktree of another clone (its .git is a file)'
				: dotGit
					? 'a folder whose .git git does not take as a repository'
					: 'a folder that is not a git clone (it has no .git)'
	const move = worktree
		? `\`git -C ${shellWord(dir)} worktree move ${shellWord(dir)} ${aside}\``
		: `\`mv ${shellWord(dir)} ${aside}\``
	throw new Error(
		`${dir} is ${what}, where the clone of ${key} belongs, so ken get left it untouched: it clones ` +
			'only into an empty place and uses only a clone it finds there. ' +
			`Move it aside with ${move}, then run \`ken get ${key}\`` +
			(plain
				? `; or, to make that folder the repo, run \`git init ${shellWord(dir)}\`, then \`ken get ${key}\`.`
				: '.')
	)
}

/** Whether git, asked in `dir`, finds `dir/.git` and not a repository above it. */
function ownRepo(dir: string): boolean {
	try {
		const found = git(dir, 'rev-parse', '--absolute-git-dir')
		return realpathSync.native(found) === realpathSync.native(join(dir, '.git'))
	} catch {
		return false
	}
}

/** Write an entry for `key` into the root's index when neither it nor a layer's lists one. */
function register(root: string, key: string, layers: Layer[]): void {
	const dirs = [root, ...layers.map((l) => codePath(root, l.key))]
	if (dirs.some((dir) => Object.hasOwn(readIndex(indexFile(dir)), key))) return
	const file = indexFile(root)
	setFields(file, key, {})
	process.stderr.write(
		`ken: registered ${key} in ${file}, with no desc. Describe it in one line, so an agent can ` +
			`choose it before cloning: \`ken index set ${key} desc="..."\`.\n`
	)
}

export const getCommand: Command = {
	usage: 'get <url|key> [-b <branch> [--from <ref>]]',
	summary:
		'Make a repo ready here: clone it to .repos/<key> when missing, register it, print the path; -b: its worktree of <branch>.',
	details: [
		'  <key>          <host>/<owner>/<repo>, cloned from https://<key>.git',
		'  <url>          a git URL (https, ssh, or git@host:owner/repo.git), cloned from as given',
		'  -b <branch>    then give <branch> its worktree at .repos/<key>.<branch>, / as -, and print',
		'                 that path instead: a new branch is made from the default branch as it',
		'                 stands (no fetch), an existing one is checked out there, one with a',
		'                 worktree prints it, and the default branch prints the clone',
		'  --from <ref>   base a new <branch> on <ref>; refused for a branch that exists',
		'',
		'Clones blobless (--filter=blob:none) unless .ken.yaml says clone.blobless: false; never',
		'shallow. A clone already at .repos/<key> is used as it is, with no fetch; anything else',
		'there is refused and left untouched. Every time, sets worktree.useRelativePaths and runs',
		'`git worktree repair` in the clone, so a clone moved there with `mv` is adopted. When no',
		"index, the root's or a layer's, lists the key, writes an entry into the root's and says on",
		'stderr how to describe it. Prints only the path on stdout. Needs git 2.48 or newer.',
		'',
		"A new worktree reads the repo's own .ken.yaml: `copy: [<path>...]` copies each file from the",
		'clone to the same path in it, then `setup: <command>` runs there with `sh -c`, its output on',
		'stderr. A failure there keeps the worktree and prints the commands to finish by hand. A',
		'folder in the way, or one differing only by case, is refused before anything is made.'
	].join('\n'),
	examples: [
		'ken get github.com/acme/join-web',
		'cd "$(ken get git@github.com:acme/join-web.git)"',
		'cd "$(ken get github.com/acme/join-web -b feat/login)"   # .../join-web.feat-login',
		'ken get github.com/acme/join-web -b hotfix --from v1.2.0',
		'# adopt a clone: its owner folder first, then mv it in',
		'mkdir -p "$(ken path repos)/github.com/acme" && mv ~/src/join-web "$(ken path code github.com/acme/join-web)" && ken get github.com/acme/join-web',
		'git init "$(ken path code github.com/acme/new-repo)" && ken get github.com/acme/new-repo   # a new repo'
	],
	run(args) {
		const usage =
			'Run e.g. `ken get github.com/acme/join-web`, `ken get github.com/acme/join-web -b feat/login`, or `ken get --help`.'
		const inputs: string[] = []
		const flags: Record<string, string> = {}
		for (let i = 0; i < args.length; i++) {
			const arg = args[i] ?? ''
			if (arg === '-b' || arg === '--from') {
				const value = args[++i]
				if (value === undefined || value.startsWith('-') || arg in flags) {
					throw new Error(`ken get takes ${arg} once, followed by a value. ${usage}`)
				}
				flags[arg] = value
			} else {
				inputs.push(arg)
			}
		}
		const [input] = inputs
		const branch = flags['-b']
		const from = flags['--from']
		if (inputs.length !== 1 || input === undefined || input.startsWith('-')) {
			throw new Error(
				`ken get takes one <url|key>, got ${JSON.stringify(redact(inputs.join(' ')))}. ${usage}`
			)
		}
		if (from !== undefined && branch === undefined) {
			throw new Error(
				`ken get takes --from only with -b <branch>, the branch to base on it. ${usage}`
			)
		}
		// a bad branch name is refused before anything is cloned
		if (branch !== undefined) branchFolder(branch)
		const clone = get(findRoot(), input)
		return branch === undefined ? clone : worktree(clone, parseKey(input).key, branch, from)
	}
}
