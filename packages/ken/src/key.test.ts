import { describe, expect, it } from 'vitest'
import { parseKey } from './key.ts'

describe('parseKey', () => {
	it.each([
		'github.com/acme/join-web',
		'GitHub.com/Acme/Join-Web',
		'https://github.com/acme/join-web',
		'https://github.com/Acme/Join-Web.git',
		'https://user:s3cret@github.com/acme/join-web.git',
		'ssh://git@github.com/acme/join-web.git',
		'git@github.com:acme/join-web.git'
	])('reads %s as the one lowercase key', (input) => {
		expect(parseKey(input).key).toBe('github.com/acme/join-web')
	})

	it('clones a key alone from https://<key>.git, and a URL from itself', () => {
		expect(parseKey('github.com/Acme/Join-Web').url).toBe('https://github.com/acme/join-web.git')
		expect(parseKey('git@github.com:Acme/X.git').url).toBe('git@github.com:Acme/X.git')
	})

	it('drops .git from a URL only, so a key passed back names the same repo', () => {
		expect(parseKey('github.com/acme/tools.git')).toEqual({
			key: 'github.com/acme/tools.git',
			url: 'https://github.com/acme/tools.git.git'
		})
		const { key } = parseKey('https://github.com/acme/tools.git.git')
		expect(key).toBe('github.com/acme/tools.git')
		expect(parseKey(key).key).toBe(key)
	})

	it.each([
		['a GitLab subgroup', 'gitlab.com/group/sub/repo'],
		['a subgroup by URL', 'https://gitlab.com/group/sub/repo.git'],
		['a missing repo', 'github.com/acme'],
		['a missing owner and repo', 'github.com'],
		['an empty owner', 'github.com//join-web'],
		['an empty repo', 'github.com/acme/'],
		['an empty host', '/acme/join-web'],
		['an empty input', ''],
		['a part that leaves its folder', 'github.com/../join-web'],
		['a part that is its folder', 'github.com/acme/.'],
		['a URL with a part that leaves its folder', 'https://github.com/acme/ignored/../repo.git'],
		['a URL with an encoded dot part', 'https://github.com/acme/%2e%2e/repo.git'],
		['a URL with no path', 'https://github.com'],
		['a space', 'github.com/acme/join web'],
		['a newline', 'github.com/acme/join-web\ndesc: x']
	])('refuses %s, saying what a key looks like', (_, input) => {
		expect(() => parseKey(input)).toThrow('A key is <host>/<owner>/<repo>')
	})

	it.each([
		'https://user:s3cret@github.com/onlyowner',
		'https://s3cret@gitlab.com/a/b/c.git',
		's3cret@github.com:onlyowner',
		'https://user:prefix@s3cret@github.com/onlyowner',
		'user@s3cret@github.com:onlyowner',
		' s3cret@github.com:onlyowner'
	])('never shows the userinfo of %s', (input) => {
		expect(() => parseKey(input)).toThrow('is not a repo key')
		expect(() => parseKey(input)).not.toThrow(/s3cret/)
	})
})
