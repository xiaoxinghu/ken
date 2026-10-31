import { spawnSync } from 'node:child_process'
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
	symlinkSync,
	writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { git } from './git.ts'
import { init, unattended } from './init.ts'

let dir: string
let root: string
let env: NodeJS.ProcessEnv

beforeEach(() => {
	dir = realpathSync.native(mkdtempSync(join(tmpdir(), 'ken-init-')))
	root = join(dir, 'ken')
	env = { HOME: join(dir, 'home'), XDG_CONFIG_HOME: join(dir, 'config'), KEN_ROOT: root }
})

const read = (file: string) => readFileSync(join(root, file), 'utf8')
const SKELETON = ['.repos/index.yaml', '.ken.yaml', '.gitignore', '.bin', 'README.md', 'AGENTS.md']

describe('ken init', () => {
	it('creates every file of the skeleton in a fresh folder', () => {
		const out = init(root, env)
		for (const file of SKELETON) expect(existsSync(join(root, file))).toBe(true)
		expect(out).toContain(`Created in ${root}:`)
		expect(read('.gitignore')).toBe('.repos/*/*/*/\n.env\n')
		expect(read('.repos/index.yaml')).toBe(
			"# .repos/index.yaml: what each repo is. Whether it exists is the remote's business.\n"
		)
		// ken layer add writes under these headings, so they must be exact
		expect(read('README.md')).toMatch(/^## Sections$[\s\S]*^## Layers$/m)
		expect(read('AGENTS.md').split('\n').length).toBeLessThan(40)
	})

	it('creates nothing on a second run, and says so', () => {
		init(root, env)
		const before = SKELETON.filter((f) => f !== '.bin').map(read)
		expect(init(root, env)).toContain('Nothing to create')
		expect(SKELETON.filter((f) => f !== '.bin').map(read)).toEqual(before)
	})

	it('leaves an existing README.md, AGENTS.md and .ken.yaml untouched, filling in the rest', () => {
		mkdirSync(root)
		for (const file of ['README.md', 'AGENTS.md', '.ken.yaml']) {
			writeFileSync(join(root, file), `mine: ${file}\n`)
		}
		const out = init(root, env)
		for (const file of ['README.md', 'AGENTS.md', '.ken.yaml']) {
			expect(read(file)).toBe(`mine: ${file}\n`)
			expect(out).not.toContain(`  ${file}`)
		}
		expect(out).toContain('  .repos/index.yaml')
	})

	it('adds to an existing .gitignore only the lines it lacks', () => {
		mkdirSync(root)
		writeFileSync(join(root, '.gitignore'), 'node_modules/\n.env')
		expect(init(root, env)).toContain('.repos/*/*/*/ in .gitignore')
		expect(read('.gitignore')).toBe('node_modules/\n.env\n.repos/*/*/*/\n')
	})

	it('adds a rule an existing .gitignore has only with a leading space, which git reads as another', () => {
		mkdirSync(root)
		spawnSync('git', ['init', '-q', root])
		writeFileSync(join(root, '.gitignore'), ' .env\n')
		init(root, env)
		expect(spawnSync('git', ['check-ignore', '-q', '.env'], { cwd: root }).status).toBe(0)
	})

	it('ignores the clones and worktrees, and tracks the index and owner context', () => {
		mkdirSync(root)
		spawnSync('git', ['init', '-q', root])
		init(root, env)
		mkdirSync(join(root, '.repos/github.com/a/b'), { recursive: true })
		writeFileSync(join(root, '.repos/github.com/a/AGENTS.md'), '')
		const ignored = (path: string) =>
			spawnSync('git', ['check-ignore', '-q', path], { cwd: root }).status === 0
		expect(ignored('.repos/github.com/a/b/')).toBe(true)
		expect(ignored('.repos/index.yaml')).toBe(false)
		expect(ignored('.repos/github.com/a/AGENTS.md')).toBe(false)
	})

	it.each([
		['a section', 'systems'],
		['a clone', '.repos/github.com/a/b'],
		['a section reached through a link', 'link']
	])('refuses a folder inside a root, in %s, naming the root', (_, inside) => {
		init(root, env)
		mkdirSync(join(root, 'systems'))
		symlinkSync(join(root, 'systems'), join(dir, 'link'))
		const target = inside === 'link' ? join(dir, 'link') : join(root, inside)
		expect(() => init(target, env)).toThrow(`is inside the ken root ${root}`)
		expect(existsSync(join(target, '.ken.yaml'))).toBe(false)
	})

	it('gives the line that points ken at a root that is not the configured one', () => {
		const out = init(root, { ...env, KEN_ROOT: undefined })
		expect(out).toContain(`not the configured root, ${join(dir, 'home/ken')} (from the default)`)
		expect(out).toContain(`export KEN_ROOT='${root}'`)
		expect(out).toContain(`{"root": "${root}"} in ${join(dir, 'config/ken/config.json')}`)
		expect(init(root, env)).not.toContain('KEN_ROOT')
	})

	it('quotes the root in the export line so a shell reads the path as written', () => {
		root = join(dir, "it's $HOME `x`")
		const line = init(root, { ...env, KEN_ROOT: undefined })
			.split('\n')
			.find((l) => l.includes('export KEN_ROOT='))
		const r = spawnSync('sh', ['-c', `${line}; printf %s "$KEN_ROOT"`], { encoding: 'utf8' })
		expect(r.stdout).toBe(root)
	})

	it('initialises the current folder when given none', () => {
		mkdirSync(root)
		const r = spawnSync(process.execPath, [join(import.meta.dirname, 'cli.ts'), 'init'], {
			cwd: root,
			encoding: 'utf8',
			env: { ...process.env, ...env }
		})
		expect(r).toMatchObject({ status: 0, stderr: '' })
		for (const file of SKELETON) expect(existsSync(join(root, file))).toBe(true)
	})
})

describe('ken init installs the layers', () => {
	// remotes are bare repos under <dir>/remotes, reached by key through url.insteadOf, as in get.test.ts
	const ken = (...args: string[]) =>
		spawnSync(process.execPath, [join(import.meta.dirname, 'cli.ts'), ...args], {
			encoding: 'utf8',
			env: {
				...process.env,
				KEN_ROOT: root,
				GIT_CONFIG_COUNT: '1',
				GIT_CONFIG_KEY_0: `url.file://${dir}/remotes/.insteadOf`,
				GIT_CONFIG_VALUE_0: 'https://example.com/'
			}
		})
	const commit = (cwd: string, ...args: string[]) =>
		git(cwd, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'x', ...args)
	/** A bare repo at <dir>/remotes/<path>.git holding `files`. */
	function remote(path: string, files: Record<string, string>): void {
		const work = join(dir, 'work', path)
		for (const [file, text] of Object.entries(files)) {
			mkdirSync(join(work, file, '..'), { recursive: true })
			writeFileSync(join(work, file), text)
		}
		git(work, 'init', '-q', '-b', 'main')
		git(work, 'add', '.')
		commit(work)
		git(dir, 'clone', '-q', '--bare', work, join(dir, 'remotes', `${path}.git`))
	}
	const ATLAS = '.repos/example.com/acme/atlas'
	const KB = '.repos/example.com/team/kb'

	/** A root listing the layers atlas and kb, committed as `ken layer add` leaves them, then cloned to `root` as a new machine would; kb's remote is gone. */
	beforeEach(() => {
		remote('acme/atlas', {
			'README.md': '# Atlas\n\nShared knowledge.\n',
			'systems/README.md': '# Systems\n',
			'.repos/index.yaml': 'example.com/acme:\n  repos:\n    web:\n      desc: The web app.\n',
			'.repos/example.com/acme/AGENTS.md': '# acme\n'
		})
		remote('acme/web', { 'README.md': '# web\n' })
		remote('team/kb', { 'README.md': '# KB\n\nThe team.\n' })
		root = join(dir, 'origin')
		mkdirSync(root)
		git(root, 'init', '-q')
		init(root, env)
		for (const key of ['example.com/acme/atlas', 'example.com/team/kb']) {
			expect(ken('layer', 'add', key).status).toBe(0)
		}
		git(root, 'add', '-A')
		commit(root)
		rmSync(join(dir, 'remotes/team'), { recursive: true })
		git(dir, 'clone', '-q', root, join(dir, 'ken'))
		root = join(dir, 'ken')
	})

	it('clones a reachable layer, so its links resolve and its index is read', () => {
		const r = ken('init', root)
		expect(r.status).toBe(0)
		expect(r.stdout).toContain(`atlas: cloned ${ATLAS}`)
		expect(readFileSync(join(root, 'atlas/systems/README.md'), 'utf8')).toBe('# Systems\n')
		expect(readFileSync(join(root, '.repos/example.com/acme/AGENTS.md'), 'utf8')).toBe('# acme\n')
		const web = JSON.parse(ken('repos', '--json').stdout).find(
			(row: { key: string }) => row.key === 'example.com/acme/web'
		)
		expect(web).toMatchObject({ desc: 'The web app.', listedBy: 'atlas' })
		// atlas's index lists web, so get registers nothing in the root's
		const get = ken('get', 'example.com/acme/web')
		expect(get).toMatchObject({ status: 0, stderr: '' })
	})

	it('reports an unreachable layer offline, changes nothing tracked, and gets it once it is back', () => {
		const r = ken('init', root)
		expect(r.status).toBe(0)
		expect(r.stderr).toContain('the layer kb (example.com/team/kb) is offline on this machine')
		expect(r.stderr).toContain('does not appear to be a git repository')
		expect(r.stderr).toContain(`run \`ken init ${root}\` again`)
		expect(existsSync(join(root, KB))).toBe(false)
		expect(git(root, 'status', '--porcelain')).toBe('')
		// the rest of the root works without it
		expect(ken('repos')).toMatchObject({ status: 0 })
		expect(ken('path', 'layer', 'kb')).toMatchObject({ status: 0, stdout: `${join(root, KB)}\n` })
		expect(ken('config').stdout).toContain(
			`kb: example.com/team/kb  (offline, no clone at ${KB}: once it can be reached, run \`ken init ${root}\``
		)

		git(dir, 'clone', '-q', '--bare', join(dir, 'work/team/kb'), join(dir, 'remotes/team/kb.git'))
		const again = ken('init', root)
		expect(again).toMatchObject({ status: 0, stderr: '' })
		expect(again.stdout).toContain(`kb: cloned ${KB}`)
		expect(readFileSync(join(root, 'kb/README.md'), 'utf8')).toContain('The team.')
	})

	it('touches no layer whose clone is there, even with its remote gone', () => {
		git(dir, 'clone', '-q', '--bare', join(dir, 'work/team/kb'), join(dir, 'remotes/team/kb.git'))
		ken('init', root)
		rmSync(join(dir, 'remotes'), { recursive: true })
		const r = ken('init', root)
		expect(r).toMatchObject({ status: 0, stderr: '' })
		expect(r.stdout).not.toMatch(/layer|atlas|kb/)
	})
})

describe('the clones ken init makes unasked', () => {
	const quiet = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' }

	it('neither prompt nor wait forever, over ssh or http', () => {
		mkdirSync(root)
		expect(unattended(root, quiet)).toMatchObject({
			GIT_TERMINAL_PROMPT: '0',
			GIT_ASKPASS: '',
			GIT_SSH_COMMAND:
				'ssh -o BatchMode=yes -o ConnectTimeout=15 -o ServerAliveInterval=15 -o ServerAliveCountMax=2',
			GIT_HTTP_LOW_SPEED_LIMIT: '1000',
			GIT_HTTP_LOW_SPEED_TIME: '30'
		})
	})

	it("keep the user's core.sshCommand, and leave a GIT_SSH program alone", () => {
		mkdirSync(root)
		const config = {
			GIT_CONFIG_COUNT: '1',
			GIT_CONFIG_KEY_0: 'core.sshCommand',
			GIT_CONFIG_VALUE_0: 'ssh -i ~/.ssh/work'
		}
		expect(unattended(root, { ...quiet, ...config }).GIT_SSH_COMMAND).toBe(
			'ssh -o BatchMode=yes -o ConnectTimeout=15 -o ServerAliveInterval=15 -o ServerAliveCountMax=2 -i ~/.ssh/work'
		)
		expect(unattended(root, { ...quiet, GIT_SSH: 'plink' }).GIT_SSH_COMMAND).toBeUndefined()
	})

	it("come before the user's own ssh options, since ssh takes the first value of each", () => {
		mkdirSync(root)
		const own = { ...quiet, GIT_SSH_COMMAND: `"/my ssh/ssh" -o BatchMode=no -o ConnectTimeout=0` }
		expect(unattended(root, own).GIT_SSH_COMMAND).toBe(
			'"/my ssh/ssh" -o BatchMode=yes -o ConnectTimeout=15 -o ServerAliveInterval=15 -o ServerAliveCountMax=2 -o BatchMode=no -o ConnectTimeout=0'
		)
	})

	it("run with them, the user's GIT_SSH_COMMAND kept", () => {
		// a stand-in ssh that logs how it was run and fails, so the layer is offline
		const ssh = join(dir, 'bin/ssh')
		mkdirSync(join(dir, 'bin'))
		writeFileSync(ssh, `#!/bin/sh\necho "$GIT_TERMINAL_PROMPT $*" >> ${dir}/ssh.log\nexit 1\n`, {
			mode: 0o755
		})
		init(root, env)
		writeFileSync(join(root, '.ken.yaml'), 'layers:\n  - { name: y, key: example.net/x/y }\n')
		const r = spawnSync(process.execPath, [join(import.meta.dirname, 'cli.ts'), 'init', root], {
			encoding: 'utf8',
			env: {
				...quiet,
				KEN_ROOT: root,
				GIT_SSH_COMMAND: `${ssh} -i key`,
				GIT_CONFIG_COUNT: '1',
				GIT_CONFIG_KEY_0: 'url.ssh://fake/.insteadOf',
				GIT_CONFIG_VALUE_0: 'https://example.net/'
			}
		})
		expect(r.status).toBe(0)
		expect(r.stderr).toContain('the layer y (example.net/x/y) is offline')
		expect(readFileSync(join(dir, 'ssh.log'), 'utf8')).toContain(
			'0 -o BatchMode=yes -o ConnectTimeout=15 -o ServerAliveInterval=15 -o ServerAliveCountMax=2 -i key '
		)
	})
})
