/**
 * A repo key, `<host>/<owner>/<repo>` lowercase, is the address everywhere (PRD decision 2):
 * the clone at `.repos/<key>`, the index entry, the prefix of a code reference.
 */
export type Repo = { key: string; url: string }

const SCP = /^[^@/\s]+@([^:/\s]+):(.*)$/ // git@github.com:owner/repo.git
const SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i
// a part is a folder name under .repos/: nothing a path, a shell or YAML would read twice
const PART = /^[a-z0-9._-]+$/

/** Strip the userinfo (`user:token@`) from URLs in `text`, so a message never shows a secret. */
export function redact(text: string): string {
	return text
		.replace(/([a-z][a-z0-9+.-]*:\/\/)[^/@\s]+@/gi, '$1')
		.replace(/^[^@/\s:]+@(?=[^:/\s]+:)/, '')
}

/**
 * Parse a key or a git URL (https, ssh, or scp-style) into its key and the URL to clone. A key
 * alone clones from `https://<key>.git`; a URL is kept as given, for git.
 */
export function parseKey(input: string): Repo {
	const s = input.trim()
	let host = ''
	let path = ''
	const scp = SCP.exec(s)
	if (scp) {
		host = scp[1] ?? ''
		path = scp[2] ?? ''
	} else if (SCHEME.test(s)) {
		try {
			const url = new URL(s)
			host = url.hostname
			path = url.pathname.slice(1)
		} catch {}
	} else {
		const i = s.indexOf('/')
		host = i < 0 ? s : s.slice(0, i)
		path = i < 0 ? '' : s.slice(i + 1)
	}
	const parts = [host, ...path.replace(/\.git$/, '').split('/')].map((p) => p.toLowerCase())
	const valid = parts.length === 3 && parts.every((p) => PART.test(p) && p !== '.' && p !== '..')
	if (!valid) {
		throw new Error(
			`${JSON.stringify(redact(input))} is not a repo key or git URL, so it names no folder under .repos/. ` +
				'A key is <host>/<owner>/<repo> with one slash between each part, e.g. github.com/acme/join-web; ' +
				'a URL is https://github.com/acme/join-web.git, ssh://git@github.com/acme/join-web.git ' +
				'or git@github.com:acme/join-web.git. GitLab subgroups (an owner with slashes) are not supported.'
		)
	}
	const key = parts.join('/')
	return { key, url: scp || SCHEME.test(s) ? s : `https://${key}.git` }
}
