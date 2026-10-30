/**
 * A repo key, `<host>/<owner>/<repo>` lowercase, is the address everywhere (PRD decision 2):
 * the clone at `.repos/<key>`, the index entry, the prefix of a code reference.
 */
export type Repo = { key: string; url: string }

const SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i
// the userinfo runs to the last @ before the host, and the path is taken as written, so no
// part a URL parser would normalise away (`..`, `%2e`) escapes the checks below
const URL_FORM = /^[a-z][a-z0-9+.-]*:\/\/(?:[^/\s]*@)?([^/:@\s]*)(?::\d*)?\/(.*)$/i
const SCP = /^[^/\s:]*@([^@:/\s]+):(.*)$/ // git@github.com:owner/repo.git
// a part is a folder name under .repos/: nothing a path, a shell or YAML would read twice
const PART = /^[a-z0-9._-]+$/

/** Strip the userinfo (`user:token@`) from URLs in `text`, so a message never shows a secret. */
export function redact(text: string): string {
	return text
		.replace(/([a-z][a-z0-9+.-]*:\/\/)[^/\s]*@/gi, '$1')
		.replace(/(^|\s)[^/\s:]*@(?=[^@:/\s]+:)/g, '$1')
}

/**
 * Parse a key or a git URL (https, ssh, or scp-style) into its key and the URL to clone. A key
 * alone clones from `https://<key>.git`; a URL is kept as given, for git, and loses its `.git`
 * in the key. A key keeps a `.git` of its own: `<host>/<owner>/tools.git` is that repo.
 */
export function parseKey(input: string): Repo {
	const s = input.trim()
	const scheme = SCHEME.test(s)
	const url = scheme ? URL_FORM.exec(s) : SCP.exec(s)
	let host = ''
	let path = ''
	if (url) {
		host = url[1] ?? ''
		path = (url[2] ?? '').replace(/\.git$/, '')
	} else if (!scheme) {
		const i = s.indexOf('/')
		host = i < 0 ? s : s.slice(0, i)
		path = i < 0 ? '' : s.slice(i + 1)
	}
	const parts = [host, ...path.split('/')].map((p) => p.toLowerCase())
	const valid = parts.length === 3 && parts.every((p) => PART.test(p) && p !== '.' && p !== '..')
	if (!valid) {
		throw new Error(
			`${JSON.stringify(redact(s))} is not a repo key or git URL, so it names no folder under .repos/. ` +
				'A key is <host>/<owner>/<repo> with one slash between each part, e.g. github.com/acme/join-web; ' +
				'a URL is https://github.com/acme/join-web.git, ssh://git@github.com/acme/join-web.git ' +
				'or git@github.com:acme/join-web.git. GitLab subgroups (an owner with slashes) are not supported.'
		)
	}
	const key = parts.join('/')
	return { key, url: scheme || url ? s : `https://${key}.git` }
}
