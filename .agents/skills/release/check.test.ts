// check.sh against a scratch repository, a local bare one as origin: the refusals the workflow
// makes before it publishes, and that the agent meets before it makes a tag.
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeEach, expect, test } from 'vitest'

const script = fileURLToPath(new URL('./check.sh', import.meta.url))
const env = {
	...process.env,
	GIT_AUTHOR_NAME: 't',
	GIT_AUTHOR_EMAIL: 't@example.com',
	GIT_COMMITTER_NAME: 't',
	GIT_COMMITTER_EMAIL: 't@example.com',
	GIT_CONFIG_GLOBAL: '/dev/null'
}
let clone: string
const git = (...args: string[]) =>
	execFileSync('git', args, { cwd: clone, env, encoding: 'utf8' }).trim()
const check = (...args: string[]) =>
	spawnSync('sh', [script, ...args], { cwd: clone, env, encoding: 'utf8' })
const commit = (message: string) => {
	writeFileSync(join(clone, `${message}.txt`), message)
	git('add', '.')
	git('commit', '-qm', message)
	git('push', '-q', 'origin', 'HEAD:main')
	return git('rev-parse', 'HEAD')
}

beforeEach(() => {
	const dir = mkdtempSync(join(tmpdir(), 'release-'))
	execFileSync('git', ['init', '-q', '--bare', '-b', 'main', join(dir, 'origin.git')], { env })
	clone = join(dir, 'clone')
	execFileSync('git', ['clone', '-q', join(dir, 'origin.git'), clone], { env })
	git('checkout', '-qb', 'main')
})

test('passes a version above the last, then its tag annotated with notes', () => {
	const head = commit('first')
	expect(check('v0.1.0', head).status).toBe(0)
	// as the skill makes it: without --cleanup=whitespace git drops the # lines, the headings
	git('tag', '-a', '--cleanup=whitespace', '-m', '# notes', 'v0.1.0', head)
	git('push', '-q', 'origin', 'v0.1.0')
	expect(check('v0.1.0').stdout).toBe('check: v0.1.0 may be released.\n')
	expect(check('v0.1.1', commit('second')).status).toBe(0)
})

test('refuses a version not above the last', () => {
	git('tag', '-a', '-m', 'notes', 'v0.2.0', commit('first'))
	git('push', '-q', 'origin', 'v0.2.0')
	const next = commit('second')
	for (const version of ['v0.1.9', 'v0.1.0'])
		expect(check(version, next).stderr).toContain('is not above v0.2.0')
	expect(check('v0.2.0', next).stderr).toContain('exists already')
	expect(check('v0.10.0', next).status).toBe(0)
})

test('refuses a tag the workflow would not publish', () => {
	const head = commit('first')
	git('tag', 'v0.1.0', head)
	git('push', '-q', 'origin', 'v0.1.0')
	expect(check('v0.1.0').stderr).toContain('not annotated with notes')
	expect(check('0.1.0', head).stderr).toContain('not a version tag')
	git('checkout', '-qb', 'side')
	writeFileSync(join(clone, 'side.txt'), 'side')
	git('add', '.')
	git('commit', '-qm', 'side')
	expect(check('v0.2.0', git('rev-parse', 'HEAD')).stderr).toContain('not on main')
})
