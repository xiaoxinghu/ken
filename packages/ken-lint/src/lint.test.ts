import { execFileSync, spawnSync } from 'node:child_process'
import {
	appendFileSync,
	mkdirSync,
	mkdtempSync,
	realpathSync,
	symlinkSync,
	writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'

const LAYER = '.repos/example.com/acme/atlas'

let dir: string
let root: string
let env: NodeJS.ProcessEnv

const run = (command: string, cwd = root) =>
	spawnSync('sh', ['-c', command], { cwd, env, encoding: 'utf8' })

/** Write files under the root, making their folders. */
function write(files: Record<string, string>): void {
	for (const [file, text] of Object.entries(files)) {
		mkdirSync(dirname(join(root, file)), { recursive: true })
		writeFileSync(join(root, file), text)
	}
}

const commit = (cwd: string, paths = '.', date?: string) => {
	const when = date ? `GIT_AUTHOR_DATE=${date} GIT_COMMITTER_DATE=${date} ` : ''
	const r = run(
		`git add -A ${paths} && ${when}git -c user.name=t -c user.email=t@t commit -qm x`,
		cwd
	)
	expect(r.stderr).toBe('')
}

// A clean root, with a section, a cloned repo and a layer, each page listed once and every
// link and code reference resolving. `ken` and `ken-lint` are on PATH as a user installs them,
// so `ken lint` goes through dispatch.
beforeEach(() => {
	dir = realpathSync.native(mkdtempSync(join(tmpdir(), 'ken-lint-')))
	root = join(dir, 'my ken')
	const bin = join(dir, 'bin')
	mkdirSync(bin)
	symlinkSync(join(import.meta.dirname, '../../../ken'), join(bin, 'ken'))
	symlinkSync(join(import.meta.dirname, 'cli.ts'), join(bin, 'ken-lint'))
	const git = execFileSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim()
	env = {
		HOME: join(dir, 'home'),
		XDG_CONFIG_HOME: join(dir, 'config'),
		KEN_ROOT: root,
		PATH: [bin, dirname(process.execPath), dirname(git), '/usr/bin', '/bin'].join(':')
	}
	mkdirSync(root)
	expect(run('git init -q && ken init').status).toBe(0)
	write({
		'README.md': '# My ken\n',
		'AGENTS.md': '# Agents\n',
		// reference-style, a footnote that is no link, and parentheses in a destination
		'systems/README.md':
			'# Systems\n\n- [join][j]: the join flow.[^1]\n- [design](design(v2).md): v2.\n- [intro](pages/intro.md): read first.\n\n[j]: join.md\n[^1]: Since 2025.\n',
		// listed by its folder's name, walked first through a link to that folder
		'systems/pages/intro.md': '# Intro\n',
		// a link in a tilde fence is an example
		'systems/design(v2).md':
			'# Design\n\n~~~md\n[example](missing.md) example.com/acme/web:src/nope.ts\n~~~\n\nOr inline: ``[example](missing.md)``, `a`.\n',
		// a reference in code, as a link, as a link's label, with brackets in its path inside
		// parentheses, and in bold
		'systems/join.md':
			'The form is `example.com/acme/web:src/app.ts#start`, [started](example.com/acme/web:src/app.ts) ' +
			'by a page (example.com/acme/web:src/app/[id]/page.ts), [example.com/acme/web:src/app.ts](design(v2).md), ' +
			'**example.com/acme/web:src/app.ts** in bold, [encoded](example.com/acme/web:src/app/%5Bid%5D/page.ts), [spaced](example.com/acme/web:src/my%20file.ts); the team is in [the atlas](../atlas/teams/sales.md).\n',
		'.repos/example.com/acme/web/src/app.ts': 'export const start = 1\n',
		'.repos/example.com/acme/web/src/my file.ts': 'export default 1\n',
		'.repos/example.com/acme/web/src/app/[id]/page.ts': 'export default 1\n',
		'.repos/example.com/acme/web/src/app/(auth)/page.ts': 'export default 1\n',
		// tasks, not pages, in a task folder below a section
		'work/README.md': '# Work\n',
		'work/tasks/fix-join.md': 'Fix the join form.\n',
		[`${LAYER}/README.md`]: '# Atlas\n\n- [teams](teams/README.md)\n',
		[`${LAYER}/teams/README.md`]: '# Teams\n\n- [sales](sales.md): who sells.\n',
		[`${LAYER}/teams/sales.md`]: '# Sales\n',
		// a root itself, with its own tasks in its default task folder
		[`${LAYER}/.ken`]: "# the layer's settings\n",
		[`${LAYER}/tasks/hire.md`]: 'Hire a seller.\n'
	})
	// a link back into a section walks nothing twice
	symlinkSync('.', join(root, 'systems/again'))
	symlinkSync('pages', join(root, 'systems/alias'))
	// the task folder, first reached through a link to the section above it
	symlinkSync('work', join(root, 'a-work'))
	run(`git init -q ${LAYER}`)
	commit(join(root, LAYER))
	symlinkSync(LAYER, join(root, 'atlas'))
	appendFileSync(join(root, '.ken'), 'task.folder=work/tasks\nlayer.atlas=example.com/acme/atlas\n')
}, 30_000)

describe('ken lint', { timeout: 30_000 }, () => {
	it('passes a clean root with a layer', () => {
		const r = run('ken lint')
		expect(r.stderr).toBe('')
		expect(r.stdout).toBe('ken lint: no errors in 4 pages.\n')
		expect(r.status).toBe(0)
	})

	it('reports each problem once, with its file, in the root and through the layer link', () => {
		const pad = (n: number) => 'line\n'.repeat(n)
		write({
			'systems/lost.md': 'See `example.com/acme/api:src/x.ts`, not cloned here.\n',
			'flows/README.md':
				'# Flows\n\n- [join](../systems/join.md): listed twice.\n\ngit/acme/web:src/gone.ts\n\n[lost]: ../systems/lost.md\n',
			'.repos/git/acme/web/src/app.ts': 'export const start = 1\n',
			'systems/old notes.md': '# Old\n',
			'overview.md': '# Overview\n'
		})
		appendFileSync(join(root, 'systems/README.md'), '- [old](old%20notes.md): settled long ago.\n')
		commit(root, "'systems/old notes.md'", '2020-01-01T00:00:00')
		write({ [`${LAYER}/teams/old.md`]: '# Old team\n' })
		appendFileSync(join(root, LAYER, 'teams/README.md'), '- [old](old.md): disbanded.\n')
		commit(join(root, LAYER), 'teams/old.md', '2020-01-01T00:00:00')
		appendFileSync(join(root, 'README.md'), pad(60))
		appendFileSync(join(root, 'AGENTS.md'), pad(40))
		appendFileSync(join(root, 'systems/join.md'), 'example.com/acme/web:src/app/(auth)/gone.ts\n')
		appendFileSync(join(root, LAYER, 'teams/README.md'), pad(150))
		appendFileSync(
			join(root, LAYER, 'teams/sales.md'),
			'[the old team](gone.md)\n\n[new]: <new team.md>\n'
		)

		const r = run('ken lint')
		expect(r.status).toBe(1)
		const found = r.stdout
			.split('\n')
			.filter((l) => /^(error|note): /.test(l) && !l.includes('not cloned here'))
			.map((l) => l.split(': ').slice(0, 2).join(' '))
		expect(found.sort()).toEqual(
			[
				'error AGENTS.md', // over 40 lines
				'error README.md', // the front page over 60
				'error atlas/teams/README.md', // a section README over 150, in the layer
				'error atlas/teams/sales.md:2', // a link to a file that does not exist
				'error atlas/teams/sales.md:4', // and a reference-style one
				'error overview.md', // a page at the top, in no section
				'error flows/README.md:5', // a reference to a file not in the clone, a host with no dot
				'error systems/join.md', // listed in two section READMEs
				'error systems/join.md:2', // a reference to a missing file under (auth)/, on its line
				'error systems/lost.md', // listed in none: a definition no link uses renders nothing
				'note systems/old notes.md', // nobody links to it, untouched since 2020
				'note atlas/teams/old.md' // and in the layer
			].sort()
		)
		// the archive command keeps a name with a space one word
		expect(r.stdout).toContain("git mv -- 'systems/old notes.md' '.archive/systems/old notes.md'")
		// a layer's page moves in the layer's clone, reached through its link
		expect(r.stdout).toContain(
			`cd "$(ken path root)"/'atlas' && mkdir -p -- '.archive/teams' && git mv -- 'teams/old.md' '.archive/teams/old.md'`
		)
		// the uncloned repo is counted, not an error
		expect(r.stdout).toMatch(/^note: .*1 code reference.*example\.com\/acme\/api/m)
	})

	it("walks a layer's own layer as a layer, and skips an offline one", () => {
		const HANDBOOK = '.repos/example.com/acme/handbook'
		write({
			[`${HANDBOOK}/.ken`]: 'task.folder=todo\n',
			[`${HANDBOOK}/README.md`]: '# Handbook\n',
			[`${HANDBOOK}/guide/README.md`]: '# Guide\n\n- [start](start.md): day one.\n',
			[`${HANDBOOK}/guide/start.md`]: '# Start\n',
			// its tasks, in the folder its own .ken names, are not pages
			[`${HANDBOOK}/todo/write.md`]: 'Write the guide.\n'
		})
		run(`git init -q ${HANDBOOK}`)
		appendFileSync(join(root, LAYER, '.ken'), 'layer.handbook=example.com/acme/handbook\n')
		symlinkSync('.repos/example.com/acme/handbook', join(root, LAYER, 'handbook'))
		// links atlas/.repos/<handbook> to the hoisted clone, as installing a layer does
		expect(run('ken init').status).toBe(0)
		// offline: listed, its link dangling, no clone here; after init, which would try to clone it
		appendFileSync(join(root, '.ken'), 'layer.gone=example.com/acme/gone\n')
		symlinkSync('.repos/example.com/acme/gone', join(root, 'gone'))
		const r = run('ken lint')
		expect(r.stderr).toBe('')
		expect(r.stdout).toBe('ken lint: no errors in 5 pages.\n')
		expect(r.status).toBe(0)
	})

	it("stops when a layer's .ken cannot be read, rather than guess its task folder", () => {
		// a layer named . would be the layer itself, walked again as its own layer
		writeFileSync(join(root, LAYER, '.ken'), 'layer..=example.com/acme/up\n')
		const r = run('ken lint')
		expect(r.status).toBe(1)
		expect(r.stdout).toBe('')
		expect(r.stderr).toMatch(
			/\.ken line 1, "layer\.\.=example\.com\/acme\/up", is not a layer line, at the layer atlas, so its task folder and its layers are unknown/
		)
	})
})
