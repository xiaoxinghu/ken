import { spawnSync } from 'node:child_process'
import {
	existsSync,
	lstatSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readlinkSync,
	realpathSync,
	symlinkSync,
	unlinkSync,
	writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { readKenYaml } from './config.ts'
import { git } from './git.ts'
import { indexFile, readIndex } from './index.ts'
import { init } from './init.ts'

let tmp: string
let root: string
const KEY = 'example.com/acme/atlas'
const clone = () => join(root, '.repos', KEY)
const OWNER_AGENTS = '.repos/example.com/acme/AGENTS.md'

// remotes are bare repos under <tmp>/remotes, reached by key through url.insteadOf, as in get.test.ts
const ken = (...args: string[]) =>
	spawnSync(process.execPath, [join(import.meta.dirname, 'cli.ts'), ...args], {
		encoding: 'utf8',
		env: {
			...process.env,
			KEN_ROOT: root,
			GIT_CONFIG_COUNT: '1',
			GIT_CONFIG_KEY_0: `url.file://${tmp}/remotes/.insteadOf`,
			GIT_CONFIG_VALUE_0: 'https://example.com/'
		}
	})

/** A bare repo at <tmp>/remotes/<path>.git holding `files`. */
function remote(path: string, files: Record<string, string>): void {
	const work = join(tmp, 'work', path)
	for (const [file, text] of Object.entries(files)) {
		mkdirSync(join(work, file, '..'), { recursive: true })
		writeFileSync(join(work, file), text)
	}
	git(work, 'init', '-q', '-b', 'main')
	git(work, 'add', '.')
	git(work, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'x')
	git(tmp, 'clone', '-q', '--bare', work, join(tmp, 'remotes', `${path}.git`))
}

beforeAll(() => {
	tmp = realpathSync.native(mkdtempSync(join(tmpdir(), 'ken-layer-')))
	// a layer: a front page, a section, an index and an owner-level AGENTS.md
	remote('acme/atlas', {
		'README.md': "# Atlas\n\nThe sales tribe's shared knowledge.\n\n## Sections\n",
		'systems/README.md': '# Systems\n',
		'.repos/index.yaml': 'example.com/acme:\n  repos:\n    web:\n      desc: The web app.\n',
		[OWNER_AGENTS]: '# acme\n'
	})
	remote('acme/web', { 'README.md': '# web\n' })
	remote('acme/team', { '.repos/example.org/team/AGENTS.md': '# team\n' })
})

beforeEach(() => {
	root = mkdtempSync(join(tmp, 'root-'))
	init(root)
	writeFileSync(join(root, '.ken.yaml'), '# my settings\norgs:\n  me: example.com/me # mine\n')
})

describe('ken layer add', () => {
	it('links the clone and its owner AGENTS.md, records it and adds its front-page line', () => {
		const r = ken('layer', 'add', KEY)
		expect(r.status).toBe(0)
		expect(readlinkSync(join(root, 'atlas'))).toBe(`.repos/${KEY}`)
		expect(readFileSync(join(root, 'atlas/systems/README.md'), 'utf8')).toBe('# Systems\n')
		expect(readFileSync(join(root, OWNER_AGENTS), 'utf8')).toBe('# acme\n')
		expect(readlinkSync(join(root, OWNER_AGENTS))).toBe(`atlas/${OWNER_AGENTS}`)
		const kenYaml = readFileSync(join(root, '.ken.yaml'), 'utf8')
		expect(kenYaml).toContain('# my settings')
		expect(kenYaml).toContain('me: example.com/me # mine')
		expect(readKenYaml(root).layers).toEqual([{ name: 'atlas', key: KEY }])
		expect(readFileSync(join(root, 'README.md'), 'utf8')).toMatch(
			/## Layers\n\n- \[atlas\]\(atlas\/README\.md\): The sales tribe's shared knowledge\.\n$/
		)
		expect(r.stdout).toContain(`add -- atlas ${OWNER_AGENTS} .ken.yaml README.md .repos/index.yaml`)
		expect(r.stdout).toContain('`ken repos --layer atlas`')

		// the layer's index is now part of the merged one: get registers nothing for its repos
		expect(ken('get', 'example.com/acme/web')).toMatchObject({ status: 0, stderr: '' })
		expect(readIndex(indexFile(root))).not.toHaveProperty('example.com/acme/web')
	})

	it("leaves the root's own owner AGENTS.md alone", () => {
		mkdirSync(join(root, OWNER_AGENTS, '..'), { recursive: true })
		writeFileSync(join(root, OWNER_AGENTS), '# ours\n')
		const r = ken('layer', 'add', KEY)
		expect(r.status).toBe(0)
		expect(lstatSync(join(root, OWNER_AGENTS)).isSymbolicLink()).toBe(false)
		expect(readFileSync(join(root, OWNER_AGENTS), 'utf8')).toBe('# ours\n')
		expect(r.stdout).toContain(`left ${OWNER_AGENTS}`)
	})

	it('links no owner AGENTS.md through a host folder that is a symlink out of the root', () => {
		const outside = mkdtempSync(join(tmp, 'outside-'))
		symlinkSync(outside, join(root, '.repos/example.org'))
		const r = ken('layer', 'add', 'example.com/acme/team')
		expect(r.status).toBe(0)
		expect(r.stdout).toContain(
			'left .repos/example.org/team/AGENTS.md: .repos/example.org is a symlink'
		)
		expect(existsSync(join(outside, 'team'))).toBe(false)
	})

	it.each([
		[['--as', 'log.md'], 'log.md is reserved at the root'],
		[['--as', 'Readme.md'], 'Readme.md is reserved at the root'],
		[['--as', '../x'], 'is not a folder name for the root']
	])('refuses %j before writing anything', (as, message) => {
		const r = ken('layer', 'add', KEY, ...as)
		expect(r.status).toBe(1)
		expect(r.stderr).toContain(message)
		expect(r.stderr).toContain(`ken layer add ${KEY} --as <name>`)
		expect(existsSync(clone())).toBe(false)
	})

	it('refuses an existing section, or a dangling link, in the way', () => {
		mkdirSync(join(root, 'atlas'))
		expect(ken('layer', 'add', KEY).stderr).toContain(`${join(root, 'atlas')} is already a section`)
		symlinkSync('nowhere', join(root, 'other'))
		expect(ken('layer', 'add', KEY, '--as', 'other').stderr).toContain('is already a link')
		// a link into the clone, not to it, is a section of its own
		symlinkSync(`.repos/${KEY}/systems`, join(root, 'systems'))
		expect(ken('layer', 'add', KEY, '--as', 'systems').stderr).toContain('is already a link')
		expect(existsSync(clone())).toBe(false)
	})

	it('refuses a second add of the same key, and a name another layer has', () => {
		expect(ken('layer', 'add', KEY).status).toBe(0)
		const kenYaml = readFileSync(join(root, '.ken.yaml'), 'utf8')
		const again = ken('layer', 'add', KEY, '--as', 'atlas2')
		expect(again.status).toBe(1)
		expect(again.stderr).toContain(`${KEY} is already the layer atlas`)
		const web = ken('layer', 'add', 'example.com/acme/web', '--as', 'atlas')
		expect(web.stderr).toContain(`atlas is already the layer of ${KEY}`)
		expect(readFileSync(join(root, '.ken.yaml'), 'utf8')).toBe(kenYaml)
		expect(existsSync(join(root, 'atlas2'))).toBe(false)
	})

	it('finishes an add that failed after linking: its own link is no clash', () => {
		symlinkSync(`.repos/${KEY}`, join(root, 'atlas'))
		expect(ken('layer', 'add', KEY).status).toBe(0)
		expect(readKenYaml(root).layers).toEqual([{ name: 'atlas', key: KEY }])
	})
})

describe('ken layer remove', () => {
	it('undoes each step of add and keeps the clone; a second remove has nothing to do', () => {
		// the front page's own line of the layer's shape, outside ## Layers, is not the layer's
		const readme = readFileSync(join(root, 'README.md'), 'utf8').replace(
			'## Sections\n',
			'## Sections\n\n- [atlas](atlas/README.md)\n'
		)
		writeFileSync(join(root, 'README.md'), readme)
		const kenYaml = readFileSync(join(root, '.ken.yaml'), 'utf8')
		// an owner link the user made into another place is not the layer's
		mkdirSync(join(root, '.repos/example.com/other'), { recursive: true })
		symlinkSync('../../../elsewhere.md', join(root, '.repos/example.com/other/AGENTS.md'))
		expect(ken('layer', 'add', KEY).status).toBe(0)
		expect(readFileSync(join(root, 'README.md'), 'utf8')).toMatch(/## Layers\n\n- \[atlas\]/)

		const r = ken('layer', 'remove', 'atlas')
		expect(r.status).toBe(0)
		expect(r.stdout).toContain(`rm -rf "$(ken path code ${KEY})"`)
		expect(existsSync(join(root, 'atlas'))).toBe(false)
		expect(lstatSync(join(root, OWNER_AGENTS), { throwIfNoEntry: false })).toBeUndefined()
		expect(lstatSync(join(root, '.repos/example.com/other/AGENTS.md')).isSymbolicLink()).toBe(true)
		expect(readFileSync(join(root, 'README.md'), 'utf8')).toBe(readme)
		expect(readFileSync(join(root, '.ken.yaml'), 'utf8')).toBe(`${kenYaml}layers: []\n`)
		expect(existsSync(join(clone(), 'README.md'))).toBe(true)

		const again = ken('layer', 'remove', 'atlas')
		expect(again.status).toBe(0)
		expect(again.stdout).toContain('atlas is not a layer')
		expect(again.stdout).toContain('nothing to remove')
	})

	it('stages the links an earlier remove deleted before it failed', () => {
		expect(ken('layer', 'add', KEY).status).toBe(0)
		unlinkSync(join(root, 'atlas'))
		unlinkSync(join(root, OWNER_AGENTS))
		expect(ken('layer', 'remove', 'atlas').stdout).toContain(
			`rm -q --cached --ignore-unmatch -- atlas ${OWNER_AGENTS} && `
		)
	})
})
