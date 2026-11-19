// release.sh against a scratch repository, a local bare one as origin: what a release pushes,
// and what it refuses before pushing anything.
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeEach, expect, test } from 'vitest'

const script = fileURLToPath(new URL('./release.sh', import.meta.url))
const env = {
	...process.env,
	GIT_AUTHOR_NAME: 't',
	GIT_AUTHOR_EMAIL: 't@example.com',
	GIT_COMMITTER_NAME: 't',
	GIT_COMMITTER_EMAIL: 't@example.com',
	GIT_CONFIG_GLOBAL: '/dev/null'
}
let dir: string
let clone: string
const git = (...args: string[]) =>
	execFileSync('git', args, { cwd: clone, env, encoding: 'utf8' }).trim()
const release = (...args: string[]) =>
	spawnSync('sh', [script, ...args], { cwd: clone, env, encoding: 'utf8' })
const commit = (message: string) => {
	writeFileSync(join(clone, `${message}.txt`), message)
	git('add', '.')
	git('commit', '-qm', message)
	git('push', '-q', 'origin', 'HEAD:main')
	return git('rev-parse', 'HEAD')
}

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), 'release-'))
	execFileSync('git', ['init', '-q', '--bare', '-b', 'main', join(dir, 'origin.git')], { env })
	clone = join(dir, 'clone')
	execFileSync('git', ['clone', '-q', join(dir, 'origin.git'), clone], { env })
	git('checkout', '-qb', 'main')
})

test('publish pushes the tag annotated with the notes, headings and all', () => {
	const head = commit('first')
	const notes = release('notes')
	expect(notes.status).toBe(0)
	expect(notes.stdout).toContain('No release yet')
	expect(notes.stdout).toContain(`main on GitHub: ${head}`)
	expect(notes.stdout).toContain('  first.txt')

	const text = '## ken\n\n# Upgrading\n\n- nothing to do\n'
	writeFileSync(join(dir, 'NOTES'), text)
	const r = release('publish', 'v0.1.0', join(dir, 'NOTES'), head)
	expect(r.stderr).toBe('')
	expect(r.status).toBe(0)
	const pushed = execFileSync(
		'git',
		['tag', '-l', '--format=%(objecttype) %(contents)', 'v0.1.0'],
		{
			cwd: join(dir, 'origin.git'),
			encoding: 'utf8'
		}
	)
	expect(pushed).toBe(`tag ${text}\n`)
	expect(release('check', 'v0.1.0').status).toBe(0)
})

test('refuses a version not above the last, before pushing anything', () => {
	const head = commit('first')
	writeFileSync(join(dir, 'NOTES'), '# notes\n')
	expect(release('publish', 'v0.2.0', join(dir, 'NOTES'), head).status).toBe(0)
	const next = commit('second')
	for (const version of ['v0.1.9', 'v0.1.0']) {
		const r = release('publish', version, join(dir, 'NOTES'), next)
		expect(r.status).toBe(1)
		expect(r.stderr).toContain('is not above v0.2.0')
	}
	expect(release('publish', 'v0.2.0', join(dir, 'NOTES'), next).stderr).toContain('exists already')
	expect(release('notes').stdout).toContain('Last release: v0.2.0')
	expect(git('ls-remote', '--tags', 'origin')).not.toContain('v0.1.')
})

test('the workflow refuses a tag it would not publish', () => {
	const head = commit('first')
	git('tag', 'v0.1.0', head)
	git('push', '-q', 'origin', 'v0.1.0')
	expect(release('check', 'v0.1.0').stderr).toContain('not annotated with notes')
	expect(release('check', '0.1.0', head).stderr).toContain('not a version tag')
	git('checkout', '-qb', 'side')
	writeFileSync(join(clone, 'side.txt'), 'side')
	git('add', '.')
	git('commit', '-qm', 'side')
	expect(release('check', 'v0.2.0', git('rev-parse', 'HEAD')).stderr).toContain('not on main')
})
