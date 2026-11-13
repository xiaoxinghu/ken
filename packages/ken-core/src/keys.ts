// Repo keys and branch folders, the addresses of the layout (PRD 5, "Guards").
import { spawnSync } from 'node:child_process'
import { die, q } from './die.ts'
import { KEY } from './files.ts'

/** Whether `key` is a repo key: `<host>/<owner>/<repo>`, lowercase, no part `.` or `..`. */
export const isKey = (key: string) =>
	KEY.repo.test(key) && key.split('/').every((part) => part !== '.' && part !== '..')

/** `s` without the userinfo (`user:token@`) of any URL in it, so a message never shows a secret. */
export const redact = (s: string) =>
	s
		.replace(/([A-Za-z][A-Za-z0-9+.-]*:\/\/)[^/\s]*@/g, '$1')
		.replace(/(^|\s)[^/:\s]*@([^@:/\s]+:)/g, '$1$2')

/** The key of a key or a git URL (https, ssh or scp-style `[user@]host:path`), and the URL to
 * clone it from: a URL as given, a key alone from `https://<key>.git`; undefined for neither. */
export const keyOf = (arg: string) => {
	let key = arg.toLowerCase()
	let url = arg
	if (/^[a-z][^:]*:\/\//.test(key))
		key = key
			.replace(/^[a-z][a-z0-9+.-]*:\/\/([^/]*@)?([^/:@]*)(:[0-9]*)?\//, '$2/')
			.replace(/\.git$/, '')
	else if (key.includes(':'))
		key = key.replace(/^([^/:]*@)?([^@:/]+):/, '$2/').replace(/\.git$/, '')
	else url = `https://${key}.git`
	return isKey(key) ? { key, url } : undefined
}

/** `keyOf(arg)`, or stop saying what a key is. */
export const parseKey = (arg: string) =>
	keyOf(arg) ??
	die(
		`${q(redact(arg))} is not a repo key or git URL, so it names no checkout folder. A key is`,
		'<host>/<owner>/<repo> with one slash between each part, e.g. github.com/acme/join-web; a URL',
		'is https://github.com/acme/join-web.git, ssh://git@github.com/acme/join-web.git or',
		'git@github.com:acme/join-web.git. GitLab subgroups (an owner with slashes) are not supported.'
	)

/** The folder of `branch`'s worktree beside its clone, `<repo>.<folder>`: `/` as `-`. A name
 * `git check-ref-format --branch` refuses, or `@`, which `git branch` refuses, stops it. */
export const branchFolder = (branch: string) => {
	const checked =
		branch === '' || branch === '@' || branch.includes('@{')
			? undefined
			: spawnSync('git', ['check-ref-format', '--branch', branch], { encoding: 'utf8' })
	if (checked?.status !== 0 || checked.stdout.replace(/\n$/, '') !== branch)
		die(
			`${q(redact(branch))} is not a branch name git accepts (git check-ref-format --branch), so no`,
			'worktree can hold it. A branch name has no empty part between slashes, no part that starts',
			'with . or ends in .lock, no .., @{, space, control character or any of ~^:?*[\\, does not',
			'start with - or end with ., and is not HEAD or @. Pick one such as feat/login.'
		)
	return branch.replaceAll('/', '-')
}
