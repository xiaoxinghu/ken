// `ken repos [--porcelain]`: the index times the disk, offline (docs/prd.md, "The core").
import { readdirSync, realpathSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { die, q } from './die.ts'
import { git } from './git.ts'
import { isKey, redact } from './keys.ts'
import { reposOf } from './layout.ts'
import { readIndex } from './registry.ts'
import { findRoot } from './root.ts'

const isDir = (path: string) => statSync(path, { throwIfNoEntry: false })?.isDirectory() ?? false
const names = (dir: string) => (isDir(dir) ? readdirSync(dir) : [])

/** The worktrees of `clone`, the clone first: path, branch (empty when detached), and whether
 * git marks it prunable, its folder gone. */
const worktrees = (clone: string) => {
	const list: { path: string; branch: string; gone: boolean }[] = []
	let at: (typeof list)[number] | undefined
	for (const line of git(clone, 'worktree', 'list', '--porcelain', '-z').out.split('\0')) {
		if (line.startsWith('worktree ')) {
			at = { path: line.slice(9), branch: '', gone: false }
			list.push(at)
		} else if (at && line.startsWith('branch refs/heads/')) at.branch = line.slice(18)
		else if (at && line.startsWith('prunable')) at.gone = true
	}
	return list
}

export const repos = (args: string[]) => {
	for (const arg of args)
		if (arg !== '--porcelain')
			die(`ken repos takes only --porcelain, not ${q(redact(arg))}. Run \`ken repos --help\`.`)
	const porcelain = args.length > 0
	const root = findRoot()
	const dir = reposOf(root)
	const listed = new Map(readIndex(root).map((s) => [s.key, s.fields.get('desc') ?? '']))
	const keys = new Set(listed.keys())
	for (const host of names(dir))
		for (const owner of names(join(dir, host)))
			for (const repo of names(join(dir, host, owner))) {
				const key = `${host}/${owner}/${repo}`
				if (isKey(key) && isDir(join(dir, key, '.git'))) keys.add(key)
			}
	if (!keys.size) {
		process.stderr.write(
			`ken: ${root}/.repos.index lists no repo, and ${dir} holds no clone, so there is nothing to` +
				' list. Run `ken get <key>` to clone a repo and list it, or `ken index set <key> desc="..."`' +
				' to list one uncloned.\n'
		)
		return ''
	}
	let out = ''
	for (const key of [...keys].sort()) {
		const clone = join(dir, key)
		const desc = listed.get(key) ?? ''
		const cloned = isDir(join(clone, '.git'))
		const lines: string[] = []
		const strays: string[] = []
		if (!listed.has(key))
			strays.push(
				'no entry lists it, so nothing says what it is and only this disk knows it.' +
					` Run \`ken index set ${key} desc="..."\`.`
			)
		else if (!desc)
			strays.push(
				'no desc, and a desc is what lets an agent choose a repo before cloning it.' +
					` Run \`ken index set ${key} desc="..."\`.`
			)
		let on = ''
		let only = ''
		if (cloned) {
			const [main, ...rest] = worktrees(clone)
			on = main?.branch ?? ''
			for (const wt of rest) {
				if (wt.gone) continue
				lines.push(`worktree ${wt.branch || '(detached)'}  ${wt.path.replaceAll('\n', '?')}`)
				let real = wt.path
				try {
					real = realpathSync.native(wt.path)
				} catch {}
				const want = `${clone}.${wt.branch.replaceAll('/', '-')}`
				if (wt.branch && real !== want)
					strays.push(
						`the worktree of ${wt.branch} is at ${real.replaceAll('\n', '?')}, not ${want}, where` +
							' `ken get -b` and `ken path code` look for it. Run' +
							` \`git -C ${q(clone)} worktree move ${q(real)} ${q(want)}\`.`
					)
			}
			// no remote-tracking branch: nothing fetched or pushed, so no other machine can clone it
			if (!git(clone, 'for-each-ref', '--count=1', 'refs/remotes/').out) only = ', local only'
			// the full ref, as --short turns origin/main into remotes/origin/main beside a tag
			const def = git(clone, 'symbolic-ref', '-q', 'refs/remotes/origin/HEAD').out.replace(
				/^refs\/remotes\/origin\//,
				''
			)
			if (def && on !== def)
				strays.push(
					`the clone has ${on ? `the branch ${on}` : 'a detached HEAD'} checked out, not its default` +
						` branch ${def}, which every \`ken get -b\` starts from. Run \`git -C ${q(clone)} switch` +
						` ${q(def)}${on ? `\`, then \`ken get ${key} -b ${q(on)}` : ''}\`.`
				)
		}
		if (porcelain) {
			out += `${[key, desc.replaceAll('\t', ' '), listed.has(key), cloned, on].join('\t')}\n`
			continue
		}
		const state = cloned ? `cloned on ${on || 'a detached HEAD'}${only}` : 'not cloned'
		out += `${key}  ${listed.has(key) ? 'listed' : 'not listed'}, ${state}\n`
		if (desc) out += `  ${desc}\n`
		for (const line of [...lines, ...strays.map((s) => `stray: ${s}`)]) out += `  ${line}\n`
	}
	return out
}
