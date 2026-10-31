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
import { type Command, shellWord } from './command.ts'
import { type Layer, readKenYaml } from './config.ts'
import { git, requireGit } from './git.ts'
import { indexFile, readIndex, setFields } from './index.ts'
import { parseKey, redact } from './key.ts'
import { codePath } from './path.ts'
import { findRoot } from './root.ts'

/**
 * Make the repo `input` names ready in `root` and return its clone, `.repos/<key>`: cloned when
 * missing, a clone already there used as it is (no fetch), anything else there refused. Then set
 * up for relative worktrees and repaired, so a clone moved in with `mv` works, and registered in
 * the root's index when no index lists it (PRD "The kernel", `get`).
 */
export function get(root: string, input: string): string {
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
			git(root, 'clone', '-q', ...filter, '--', url, dir)
		} catch (e) {
			rmSync(dir, { recursive: true, force: true })
			const hint =
				url === `https://${key}.git`
					? ` A key alone clones ${url}; for another URL, such as ssh, pass it: \`ken get git@${key.replace('/', ':')}.git\`.`
					: ''
			throw new Error(
				`could not clone ${redact(url)} into ${dir}, so ${key} is not here; nothing was left behind. ` +
					`${(e as Error).message}\nFix the cause, then run \`ken get ${shellWord(redact(input.trim()))}\` again.${hint}`
			)
		}
	} else {
		requireClone(dir, key)
	}
	git(dir, 'config', 'worktree.useRelativePaths', 'true')
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

/** Throw unless `dir` is a clone: a folder of its own (no link) holding a `.git` folder. */
function requireClone(dir: string, key: string): void {
	const stat = lstatSync(dir)
	const dotGit = statSync(join(dir, '.git'), { throwIfNoEntry: false })
	if (stat.isDirectory() && dotGit?.isDirectory()) return
	const aside = `~/${basename(dir)}.aside`
	const worktree = stat.isDirectory() && dotGit?.isFile()
	const plain = stat.isDirectory() && !dotGit
	const what = stat.isSymbolicLink()
		? 'a symlink'
		: !stat.isDirectory()
			? 'a file'
			: worktree
				? 'a worktree of another clone (its .git is a file)'
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
	usage: 'get <url|key>',
	summary:
		'Make a repo ready here: clone it to .repos/<key> when missing, register it, print the path.',
	details: [
		'  <key>     <host>/<owner>/<repo>, cloned from https://<key>.git',
		'  <url>     a git URL (https, ssh, or git@host:owner/repo.git), cloned from as given',
		'',
		'Clones blobless (--filter=blob:none) unless .ken.yaml says clone.blobless: false; never',
		'shallow. A clone already at .repos/<key> is used as it is, with no fetch; anything else',
		'there is refused and left untouched. Every time, sets worktree.useRelativePaths and runs',
		'`git worktree repair` in the clone, so a clone moved there with `mv` is adopted. When no',
		"index, the root's or a layer's, lists the key, writes an entry into the root's and says on",
		'stderr how to describe it. Prints only the path on stdout. Needs git 2.48 or newer.'
	].join('\n'),
	examples: [
		'ken get github.com/acme/join-web',
		'cd "$(ken get git@github.com:acme/join-web.git)"',
		'# adopt a clone: its owner folder first, then mv it in',
		'mkdir -p "$(ken path repos)/github.com/acme" && mv ~/src/join-web "$(ken path code github.com/acme/join-web)" && ken get github.com/acme/join-web',
		'git init "$(ken path code github.com/acme/new-repo)" && ken get github.com/acme/new-repo   # a new repo'
	],
	run(args) {
		const [input] = args
		if (args.length !== 1 || input === undefined || input.startsWith('-')) {
			throw new Error(
				`ken get takes one <url|key>, got ${JSON.stringify(redact(args.join(' ')))}. ` +
					'Run e.g. `ken get github.com/acme/join-web`, or `ken get --help`.'
			)
		}
		return get(findRoot(), input)
	}
}
