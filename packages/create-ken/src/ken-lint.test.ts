import { execFileSync, spawnSync } from 'node:child_process'
import {
	appendFileSync,
	mkdirSync,
	mkdtempSync,
	realpathSync,
	symlinkSync,
	writeFileSync
} from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const pkg = require.resolve('@unclex/ken/package.json')
const KEN = join(dirname(pkg), require(pkg).bin.ken)
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

// A clean root from the agents template, with a section, a cloned repo and a layer, each
// page listed once and every link and code reference resolving.
beforeEach(() => {
	dir = realpathSync.native(mkdtempSync(join(tmpdir(), 'create-ken-lint-')))
	root = join(dir, 'my ken')
	const bin = join(dir, 'bin')
	mkdirSync(bin)
	writeFileSync(join(bin, 'ken'), `#!/bin/sh\nexec ${process.execPath} ${KEN} "$@"\n`, {
		mode: 0o755
	})
	const git = execFileSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim()
	env = {
		HOME: join(dir, 'home'),
		XDG_CONFIG_HOME: join(dir, 'config'),
		KEN_ROOT: root,
		PATH: [bin, dirname(process.execPath), dirname(git), '/usr/bin', '/bin'].join(':')
	}
	const r = spawnSync(
		process.execPath,
		[join(import.meta.dirname, 'cli.ts'), root, '--template', 'agents'],
		{ env, encoding: 'utf8' }
	)
	expect(r.status).toBe(0)
	write({
		// reference-style, and a footnote that is no link
		'systems/README.md':
			'# Systems\n\n- [join][j]: the join flow.[^1]\n\n[j]: join.md\n[^1]: Since 2025.\n',
		'systems/join.md':
			'The form is `example.com/acme/web:src/app.ts#start`; the team is in [the atlas](../atlas/teams/sales.md).\n',
		'.repos/example.com/acme/web/src/app.ts': 'export const start = 1\n',
		// tasks, not pages, in a task folder below a section
		'work/README.md': '# Work\n',
		'work/tasks/fix-join.md': 'Fix the join form.\n',
		[`${LAYER}/README.md`]: '# Atlas\n\n- [teams](teams/README.md)\n',
		[`${LAYER}/teams/README.md`]: '# Teams\n\n- [sales](sales.md): who sells.\n',
		[`${LAYER}/teams/sales.md`]: '# Sales\n'
	})
	run(`git init -q ${LAYER}`)
	commit(join(root, LAYER))
	symlinkSync(LAYER, join(root, 'atlas'))
	appendFileSync(
		join(root, '.ken.yaml'),
		'task:\n  folder: work/tasks\nlayers:\n  - name: atlas\n    key: example.com/acme/atlas\n'
	)
}, 30_000)

describe('ken lint', { timeout: 30_000 }, () => {
	it('passes a clean root with a layer', () => {
		const r = run('ken lint')
		expect(r.stderr).toBe('')
		expect(r.stdout).toBe('ken lint: no errors in 2 pages.\n')
		expect(r.status).toBe(0)
	})

	it('reports each problem once, with its file, in the root and through the layer link', () => {
		const pad = (n: number) => 'line\n'.repeat(n)
		write({
			'systems/lost.md': 'See `example.com/acme/api:src/x.ts`, not cloned here.\n',
			'flows/README.md':
				'# Flows\n\n- [join](../systems/join.md): listed twice.\n\ngit/acme/web:src/gone.ts\n',
			'.repos/git/acme/web/src/app.ts': 'export const start = 1\n',
			'systems/old.md': '# Old\n'
		})
		appendFileSync(join(root, 'systems/README.md'), '- [old](old.md): settled long ago.\n')
		commit(root, 'systems/old.md', '2020-01-01T00:00:00')
		appendFileSync(join(root, 'README.md'), pad(60))
		appendFileSync(join(root, 'AGENTS.md'), pad(40))
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
				'error atlas/teams/sales.md', // a link to a file that does not exist
				'error atlas/teams/sales.md', // and a reference-style one
				'error flows/README.md', // a reference to a file not in the clone, a host with no dot
				'error systems/join.md', // listed in two section READMEs
				'error systems/lost.md', // listed in none
				'note systems/old.md' // nobody links to it, untouched since 2020
			].sort()
		)
		// the uncloned repo is counted, not an error
		expect(r.stdout).toMatch(/^note: .*1 code reference.*example\.com\/acme\/api/m)
	})
})
