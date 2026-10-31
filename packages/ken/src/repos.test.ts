import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { git } from './git.ts'
import { indexFile } from './index.ts'

let tmp: string
let root: string
const OWNER = 'example.com/acme'
const code = (repo: string) => join(root, '.repos', OWNER, repo)

// as in get.test.ts: a key alone clones from a local bare repo under <tmp>/remotes
const run = (kenRoot: string, ...args: string[]) =>
	spawnSync(process.execPath, [join(import.meta.dirname, 'cli.ts'), ...args], {
		encoding: 'utf8',
		env: {
			...process.env,
			KEN_ROOT: kenRoot,
			GIT_CONFIG_COUNT: '1',
			GIT_CONFIG_KEY_0: `url.file://${tmp}/remotes/.insteadOf`,
			GIT_CONFIG_VALUE_0: 'https://example.com/'
		}
	})
const ken = (...args: string[]) => run(root, ...args)
const json = (...args: string[]) => JSON.parse(ken(...args, '--json').stdout)

// a root and its layer atlas, whose indexes overlap on web; a second layer, gone, not cloned.
// web and atlas cloned by `ken get`; api cloned by hand and switched to another branch; lone
// cloned by hand and listed nowhere. web has a worktree in place, one renamed by hand and one
// moved outside the layout.
beforeAll(() => {
	tmp = realpathSync.native(mkdtempSync(join(tmpdir(), 'ken-repos-')))
	for (const repo of ['web', 'api', 'lone', 'atlas']) {
		const remote = join(tmp, 'remotes/acme', `${repo}.git`)
		mkdirSync(remote, { recursive: true })
		git(remote, 'init', '-q', '--bare', '-b', 'main')
		const tree = git(remote, 'hash-object', '-t', 'tree', '-w', '--stdin')
		git(remote, 'update-ref', 'refs/heads/main', git(remote, 'commit-tree', '-m', 'x', tree))
	}
	root = join(tmp, 'ken')
	mkdirSync(join(root, '.repos'), { recursive: true })
	writeFileSync(
		join(root, '.ken.yaml'),
		`layers:\n  - name: atlas\n    key: ${OWNER}/atlas\n  - name: gone\n    key: ${OWNER}/gone\n`
	)
	writeFileSync(
		indexFile(root),
		`${OWNER}:\n  repos:\n    web:\n      desc: The root's web.\n    api:\n    atlas:\n      desc: The team layer.\n`
	)
	for (const repo of ['web', 'atlas']) expect(ken('get', `${OWNER}/${repo}`).status).toBe(0)
	const layer = code('atlas')
	mkdirSync(join(layer, '.repos'))
	writeFileSync(
		indexFile(layer),
		`${OWNER}:\n  repos:\n    web:\n      desc: The layer's web.\n      kind: frontend\n    docs:\n      desc: Team docs.\n    wiki:\n`
	)
	symlinkSync(layer, join(root, 'atlas'))

	for (const repo of ['api', 'lone']) {
		git(tmp, 'clone', '-q', `file://${tmp}/remotes/acme/${repo}.git`, code(repo))
	}
	git(code('api'), 'switch', '-q', '-c', 'other')
	git(code('web'), 'worktree', 'add', '-q', '-b', 'feat/ok', `${code('web')}.feat-ok`)
	git(code('web'), 'worktree', 'add', '-q', '-b', 'feat/x', `${code('web')}.feat-x`)
	git(code('web'), 'worktree', 'move', `${code('web')}.feat-x`, `${code('web')}.renamed`)
	git(code('web'), 'worktree', 'add', '-q', '-b', 'out', join(tmp, 'out\nside'))

	// mentions of web: two pages, and copies where repos <key> must not look
	const mention = `See ${OWNER}/web.\n`
	mkdirSync(join(root, 'systems'))
	writeFileSync(join(root, 'systems/join.md'), mention)
	mkdirSync(join(layer, 'flows'))
	writeFileSync(join(layer, 'flows/join.md'), mention)
	writeFileSync(join(root, '.repos', OWNER, 'AGENTS.md'), mention)
	writeFileSync(join(code('web'), 'README.md'), mention)
	mkdirSync(join(root, '.claude'))
	writeFileSync(join(root, '.claude/notes.md'), mention)
	writeFileSync(join(root, 'blob.bin'), `\0${mention}`)
})

type Row = { key: string; strays: string[]; [field: string]: unknown }
const byKey = (rows: Row[]) => Object.fromEntries(rows.map((r) => [r.key.split('/')[2], r]))

describe('ken repos', () => {
	it("merges the root's index then each layer's, the first whole entry winning, with every clone", () => {
		const r = ken('repos', '--json')
		expect(r.status).toBe(0)
		expect(r.stderr).toContain(`the layer gone is not cloned at ${code('gone')}`)
		expect(r.stderr).toContain(`Run \`ken get ${OWNER}/gone\``)
		const rows = byKey(JSON.parse(r.stdout))
		expect(Object.keys(rows)).toEqual(['api', 'atlas', 'docs', 'lone', 'web', 'wiki'])
		expect(rows.web).toMatchObject({ desc: "The root's web.", listedBy: 'root', cloned: true })
		expect(rows.docs).toMatchObject({ desc: 'Team docs.', listedBy: 'atlas', cloned: false })
		expect(rows.docs?.strays).toEqual([])
		expect(rows.atlas).toMatchObject({ listedBy: 'root', branch: 'main', strays: [] })
	})

	it('names a clone no index lists, with the index set to run', () => {
		const { lone } = byKey(json('repos'))
		expect(lone).toMatchObject({ listedBy: null, cloned: true })
		expect(lone?.strays).toEqual([expect.stringContaining('no index lists it')])
		expect(lone?.strays[0]).toContain(`\`ken index set ${OWNER}/lone desc="..."\``)
	})

	it('names an entry without desc, in the index of whoever listed it', () => {
		const { api, wiki } = byKey(json('repos'))
		expect(api?.strays[0]).toContain(`\`ken index set ${OWNER}/api desc="..."\``)
		expect(wiki?.strays).toEqual([
			expect.stringContaining(`\`ken index set ${OWNER}/wiki desc="..." --layer atlas\``)
		])
	})

	it('names a clone switched off its default branch, with how to put it back', () => {
		const { api } = byKey(json('repos'))
		expect(api).toMatchObject({ branch: 'other' })
		expect(api?.strays[1]).toContain('not its default branch main')
		expect(api?.strays[1]).toContain(
			`\`git -C ${code('api')} switch main\`, then \`git -C ${code('api')} worktree add ${code('api')}.other other\``
		)
	})

	it('lists the worktrees, naming one renamed by hand and one outside the layout', () => {
		const { web } = byKey(json('repos'))
		expect(web?.worktrees).toEqual([
			{ path: `${code('web')}.feat-ok`, branch: 'feat/ok' },
			{ path: `${code('web')}.renamed`, branch: 'feat/x' },
			{ path: join(tmp, 'out\nside'), branch: 'out' }
		])
		expect(web?.strays).toEqual([
			expect.stringContaining(
				`its folder does not match its branch feat/x, so \`ken path code ${OWNER}/web feat/x\` points elsewhere: run \`git -C ${code('web')} worktree move ${code('web')}.renamed ${code('web')}.feat-x\``
			),
			expect.stringContaining(`outside the layout, where \`ken path code\` cannot find it`)
		])
	})

	it('prints one row per key, the strays under it', () => {
		const r = ken('repos')
		expect(r.stdout).toContain(`${OWNER}/docs  listed by atlas, not cloned\n  Team docs.\n`)
		expect(r.stdout).toContain(`${OWNER}/web  listed by root, cloned on main\n  The root's web.\n`)
		expect(r.stdout).toContain(`  worktree feat/ok  ${code('web')}.feat-ok\n`)
		expect(r.stdout).toContain(
			`${OWNER}/lone  in no index, cloned on main\n  stray: cloned, but no index`
		)
	})

	it('keeps the keys one workspace lists with --layer, root for its own', () => {
		expect(json('repos', '--layer', 'atlas').map((r: Row) => r.key)).toEqual([
			`${OWNER}/docs`,
			`${OWNER}/web`,
			`${OWNER}/wiki`
		])
		expect(json('repos', '--layer', 'root').map((r: Row) => r.key)).toEqual([
			`${OWNER}/api`,
			`${OWNER}/atlas`,
			`${OWNER}/web`
		])
		expect(ken('repos', `${OWNER}/web`, '--layer', 'atlas').stderr).toContain('not both')
		const r = ken('repos', '--layer', 'nope')
		expect(r.status).toBe(1)
		expect(r.stderr).toContain('one of the layers in')
		expect(r.stderr).toContain('atlas, gone')
	})

	it("shows one key's merged entry, then the pages in a root and a layer section that mention it", () => {
		const one = json('repos', `${OWNER}/web`)
		expect(one).toMatchObject({ listedBy: 'root', entry: { desc: "The root's web." } })
		expect(one.mentions).toEqual([join(root, 'atlas/flows/join.md'), join(root, 'systems/join.md')])
		const r = ken('repos', `${OWNER}/web`)
		expect(r.stdout).toContain(`Entry, from ${indexFile(root)}:\n  desc: The root's web.\n`)
		expect(r.stdout).toContain(`Mentioned in:\n  ${join(root, 'atlas/flows/join.md')}\n`)
	})

	it('answers for a key no index lists and nothing mentions', () => {
		const r = ken('repos', `${OWNER}/nothing`)
		expect(r.stdout).toBe(
			`${OWNER}/nothing  in no index, not cloned\n\nMentioned in no file under ${root}.\n`
		)
	})

	it('says what to run in a root with no repos', () => {
		const empty = join(tmp, 'empty')
		mkdirSync(empty)
		expect(run(empty, 'repos')).toMatchObject({ status: 0, stderr: '' })
		expect(run(empty, 'repos').stdout).toContain('Run `ken get <key>`')
	})
})
