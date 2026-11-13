import { describe, expect, it } from 'vitest'
import { KenError } from './die.ts'
import { parseIndex, parseSettings, setFields, setSetting } from './files.ts'

const refusal = (read: () => unknown) => {
	try {
		read()
	} catch (e) {
		if (e instanceof KenError) return e.message
		throw e
	}
	throw new Error('read the file without refusing it')
}

describe('.ken', () => {
	it('reads key=value lines, a repeated key as its last line, comments and blanks skipped', () => {
		const settings = parseSettings(
			'# a comment=not a key\n\nken.format=1\ntask.folder=a\ntask.folder= b #c \n',
			'.ken'
		)
		expect([...settings]).toEqual([
			['ken.format', '1'],
			['task.folder', 'b #c']
		])
	})

	it('refuses a line it cannot read, naming the file and the line', () => {
		expect(refusal(() => parseSettings('ken.format=1\ntask folder=x\n', '/r/.ken'))).toMatch(
			/^\/r\/\.ken line 2, 'task folder=x', is not a line ken can read/
		)
		expect(refusal(() => parseSettings('ken.format=1\njust words\n', '/r/.ken'))).toContain(
			'line 2'
		)
	})

	it('sets a key in its last line, or appends it, every other line kept', () => {
		const text = '# settings\nx.a=1\nken.format=1\nx.a=2\nother.key=3'
		expect(setSetting(text, 'x.a', '9')).toBe(
			'# settings\nx.a=1\nken.format=1\nx.a=9\nother.key=3\n'
		)
		expect(setSetting(text, 'x.b', '4')).toBe(`${text}\nx.b=4\n`)
	})
})

const INDEX = `# .repos.index: what each repo is.

owner: github.com/acme
desc: acme's GitHub org. #1 for sales.

repo: github.com/acme/join-web
desc: Front end for the join funnel.
# a comment inside a stanza
tags: sales join
x_custom: kept

repo: github.com/acme/api
`

describe('.repos.index', () => {
	it('reads stanzas, owner and repo, fields in order, comments anywhere skipped', () => {
		expect(parseIndex(INDEX, '.repos.index')).toEqual([
			{
				kind: 'owner',
				key: 'github.com/acme',
				fields: new Map([['desc', "acme's GitHub org. #1 for sales."]])
			},
			{
				kind: 'repo',
				key: 'github.com/acme/join-web',
				fields: new Map([
					['desc', 'Front end for the join funnel.'],
					['tags', 'sales join'],
					['x_custom', 'kept']
				])
			},
			{ kind: 'repo', key: 'github.com/acme/api', fields: new Map() }
		])
	})

	it('refuses what docs/files.md does not allow, naming the line and what it expects', () => {
		const cases: [string, string][] = [
			['desc: no stanza\n', 'line 1'],
			['repo: github.com/Acme/api\n', 'lowercase'],
			['repo: github.com/acme\n', 'one part per /'],
			['owner: github.com/acme/api\n', 'one part per /'],
			['repo: github.com/../api\n', 'one part per /'],
			['repo: a/b/c\n\nrepo: a/b/c\n', 'line 3'],
			['repo: a/b/c\ntags: x\ntags: y\n', 'once per stanza'],
			['repo: a/b/c\nrepo: a/b/d\n', 'once per stanza'],
			['repo: a/b/c\ndesc:\n', 'desc: with a value'],
			['repo: a/b/c\nno colon here\n', 'a field, <name>: <value>']
		]
		for (const [text, says] of cases)
			expect(refusal(() => parseIndex(text, '/r/.repos.index'))).toContain(says)
	})

	it('sets fields in one stanza, in place or at its end, every other line kept', () => {
		const out = setFields(INDEX, 'github.com/acme/join-web', [
			['tags', 'sales'],
			['kind', 'frontend']
		])
		expect(out).toBe(
			INDEX.replace('tags: sales join', 'tags: sales').replace(
				'x_custom: kept\n',
				'x_custom: kept\nkind: frontend\n'
			)
		)
		expect(setFields(INDEX, 'github.com/acme/api', [['desc', 'The API.']])).toBe(
			`${INDEX}desc: The API.\n`
		)
	})

	it('adds a stanza at the end for a new key, after a blank line', () => {
		expect(setFields('# index', 'a/b/c', [['desc', 'C.']])).toBe(
			'# index\n\nrepo: a/b/c\ndesc: C.\n'
		)
		expect(setFields('', 'a/b/c', [])).toBe('repo: a/b/c\n')
		const out = setFields(INDEX, 'github.com/acme/new', [['desc', 'New.']])
		expect(out).toBe(`${INDEX}\nrepo: github.com/acme/new\ndesc: New.\n`)
		expect(parseIndex(out, '.repos.index')).toHaveLength(4)
	})
})
