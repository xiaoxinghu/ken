import {
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	realpathSync,
	renameSync,
	writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { index, indexFile, readIndex } from './index.ts'

vi.mock('node:fs', async (original) => {
	const fs = await original<typeof import('node:fs')>()
	return { ...fs, renameSync: vi.fn(fs.renameSync) }
})

let root: string
let file: string
const read = () => readFileSync(file, 'utf8')
const write = (lines: string[]) => writeFileSync(file, `${lines.join('\n')}\n`)
const ken = (...args: string[]) => index.run(args)
const refusal = (...args: string[]) => {
	try {
		ken(...args)
	} catch (e) {
		return (e as Error).message
	}
	throw new Error(`ken index ${args.join(' ')} did not refuse`)
}

beforeEach(() => {
	root = realpathSync.native(mkdtempSync(join(tmpdir(), 'ken-index-')))
	mkdirSync(join(root, '.repos'))
	file = indexFile(root)
	write(["# .repos/index.yaml: what each repo is. Whether it exists is the remote's business."])
	vi.stubEnv('KEN_ROOT', root)
})

describe('ken index set', () => {
	it('creates the owner and the entry in an empty index, parsing each value as YAML', () => {
		ken(
			'set',
			'github.com/Acme/join-web',
			'desc=Join API: identity, payment',
			'tags=[sales,join]',
			'n=3'
		)
		expect(readIndex(file)).toEqual({
			'github.com/acme/join-web': {
				desc: 'Join API: identity, payment',
				tags: ['sales', 'join'],
				n: 3
			}
		})
		expect(read()).toBe(
			[
				"# .repos/index.yaml: what each repo is. Whether it exists is the remote's business.",
				'',
				'github.com/acme:',
				'  repos:',
				'    join-web:',
				'      desc: "Join API: identity, payment"',
				'      tags: [ sales, join ]',
				'      n: 3',
				''
			].join('\n')
		)
	})

	it('merges into an entry, keeping its comments, order and the fields written by hand', () => {
		write([
			'github.com/acme:',
			'  desc: acme # the org',
			'  repos:',
			'    # the funnel',
			'    join-web:',
			'      lifecycle: production # not in the PRD list',
			'      desc: old',
			'    join-api: {}'
		])
		ken('set', 'github.com/acme/join-web', 'desc=Front end', 'kind=frontend')
		expect(read()).toBe(
			[
				'github.com/acme:',
				'  desc: acme # the org',
				'  repos:',
				'    # the funnel',
				'    join-web:',
				'      lifecycle: production # not in the PRD list',
				'      desc: Front end',
				'      kind: frontend',
				'    join-api: {}',
				''
			].join('\n')
		)
	})

	// `ken get` writes `{}`, flow style; the first field set into it must not keep that style
	it('keeps the comments on a field it replaces', () => {
		write([
			'github.com/acme:',
			'  repos:',
			'    join-web:',
			'      # one line',
			'      desc: old # by sales'
		])
		ken('set', 'github.com/acme/join-web', 'desc=new')
		expect(read()).toBe(
			[
				'github.com/acme:',
				'  repos:',
				'    join-web:',
				'      # one line',
				'      desc: new # by sales',
				''
			].join('\n')
		)
	})

	it.each([[['github.com/acme:']], [['github.com/acme:', '  repos:']]])(
		'fills in an owner or repos left empty in %j',
		(lines) => {
			write(lines)
			ken('set', 'github.com/acme/join-web', 'desc=Front end')
			expect(readIndex(file)).toEqual({ 'github.com/acme/join-web': { desc: 'Front end' } })
		}
	)

	it('keeps the comment on an entry left empty when it fills it in', () => {
		write(['github.com/acme:', '  repos:', '    join-web: # by sales'])
		ken('set', 'github.com/acme/join-web', 'desc=Front end')
		expect(read()).toBe(
			[
				'github.com/acme:',
				'  repos:',
				'    join-web:',
				'      # by sales',
				'      desc: Front end',
				''
			].join('\n')
		)
	})

	it('writes into an entry that is {} or empty as a block', () => {
		write(['github.com/acme:', '  repos:', '    join-web: {}', '    join-api:'])
		ken('set', 'github.com/acme/join-web', 'desc=Front end')
		ken('set', 'github.com/acme/join-api', 'desc=API')
		expect(read()).toBe(
			[
				'github.com/acme:',
				'  repos:',
				'    join-web:',
				'      desc: Front end',
				'    join-api:',
				'      desc: API',
				''
			].join('\n')
		)
	})

	it.each([
		['desc=', 'desc must be a non-empty string'],
		['desc=2024', 'desc must be a non-empty string'],
		['tags=[sales', 'starts like a YAML flow value but is not one'],
		['desc', 'ken index set takes <field>=<value>, got "desc"']
	])('refuses %j, leaving the file as it was', (arg, message) => {
		const before = read()
		expect(refusal('set', 'github.com/acme/join-web', arg)).toContain(message)
		expect(read()).toBe(before)
	})

	it('keeps a text with " #" whole, where YAML would read a comment', () => {
		ken('set', 'github.com/acme/join-web', 'desc=Fix #12')
		expect(readIndex(file)['github.com/acme/join-web']).toEqual({ desc: 'Fix #12' })
	})

	it.each([
		[['github.com/acme:', '  repos:', '    join-web:', '      desc: a', '     kind: b'], 'line 5'],
		[
			['github.com/acme:', '  repos: [join-web]'],
			`${join('.repos', 'index.yaml')}:2: github.com/acme repos must be a mapping`
		],
		[
			['github.com/acme:', '  repos:', '    join-web:', '      desc: ""'],
			'index.yaml:4: the desc of github.com/acme/join-web'
		],
		[
			['github.com/acme:', '  desc: &d tools', '  repos:', '    ken:', '      desc: *d'],
			'index.yaml:2: a YAML anchor or alias'
		],
		// YAML reads 123 as a number, which no string path finds: set would add a second '123'
		[
			['github.com/acme:', '  repos:', '    123:', '      desc: x'],
			'index.yaml:3: the key 123 is not a string'
		],
		[
			['GitHub.com/acme:', '  repos: {}'],
			'index.yaml:1: "GitHub.com/acme" is not a lowercase <host>/<owner>'
		]
	])('refuses a malformed index naming the line, and leaves it unchanged', (lines, message) => {
		write(lines)
		const before = read()
		expect(refusal('set', 'github.com/acme/x', 'desc=x')).toContain(message)
		expect(read()).toBe(before)
	})

	it('writes beside and renames over: a failed rename leaves the file and no .tmp', () => {
		const before = read()
		vi.mocked(renameSync).mockImplementationOnce(() => {
			throw new Error('disk full')
		})
		expect(refusal('set', 'github.com/acme/join-web', 'desc=x')).toBe('disk full')
		expect(read()).toBe(before)
		expect(readdirSync(join(root, '.repos'))).toEqual(['index.yaml'])
	})
})

describe('ken index unset', () => {
	beforeEach(() =>
		write([
			'github.com/acme:',
			'  repos:',
			'    join-web:',
			'      desc: Front end',
			'      tags: [sales]',
			'      kind: frontend',
			'    join-api:',
			'      desc: API',
			'github.com/me:',
			'  desc: mine',
			'  repos:',
			'    ken:',
			'      desc: kernel'
		])
	)

	it('removes the fields named, then the whole entry', () => {
		ken('unset', 'github.com/acme/join-web', 'tags', 'kind')
		expect(readIndex(file)['github.com/acme/join-web']).toEqual({ desc: 'Front end' })
		ken('unset', 'github.com/acme/join-web')
		expect(Object.keys(readIndex(file))).toEqual(['github.com/acme/join-api', 'github.com/me/ken'])
	})

	it('removes an owner with its last repo, but not one that still has a desc', () => {
		ken('unset', 'github.com/acme/join-web')
		ken('unset', 'github.com/acme/join-api')
		ken('unset', 'github.com/me/ken')
		expect(read()).toBe(['github.com/me:', '  desc: mine', ''].join('\n'))
	})

	it.each([
		[['github.com/acme/join-web', 'desc'], 'so it is changed, not removed'],
		[['github.com/acme/join-web', 'owner'], 'its fields are desc, tags, kind'],
		[['github.com/acme/nope'], 'github.com/acme/nope has no entry']
	])('refuses %j, leaving the file as it was', (args, message) => {
		const before = read()
		expect(refusal('unset', ...args)).toContain(message)
		expect(read()).toBe(before)
	})
})

describe('ken index --layer', () => {
	beforeEach(() =>
		writeFileSync(
			join(root, '.ken.yaml'),
			'layers:\n  - name: sales-atlas\n    key: github.com/acme/sales-atlas\n'
		)
	)

	it("writes the layer's index in its clone, and not the root's", () => {
		const layer = join(root, '.repos', 'github.com', 'acme', 'sales-atlas')
		mkdirSync(layer, { recursive: true })
		const before = read()
		ken('set', 'github.com/acme/join-web', 'desc=Front end', '--layer', 'sales-atlas')
		expect(readIndex(indexFile(layer))).toEqual({
			'github.com/acme/join-web': { desc: 'Front end' }
		})
		expect(read()).toBe(before)
	})

	it('refuses a layer this root does not have, naming the ones it has', () => {
		expect(refusal('set', 'github.com/acme/x', 'desc=x', '--layer', 'atlas')).toContain(
			'The layers in'
		)
		expect(refusal('set', 'github.com/acme/x', 'desc=x', '--layer', 'atlas')).toContain(
			'are sales-atlas.'
		)
	})

	it('refuses a layer that is not cloned, with the command that clones it', () => {
		expect(refusal('set', 'github.com/acme/x', 'desc=x', '--layer', 'sales-atlas')).toContain(
			'Run `ken layer add github.com/acme/sales-atlas --as sales-atlas`'
		)
	})
})
