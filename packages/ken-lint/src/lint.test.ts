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
import { dirname, isAbsolute, join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'

let dir: string
let root: string
let clone: string // the clone of example.com/acme/web, in the root's .repos/
let env: NodeJS.ProcessEnv

const run = (command: string, cwd = root) =>
	spawnSync('sh', ['-c', command], { cwd, env, encoding: 'utf8' })

/** Write files under the root, or at an absolute path, making their folders. */
function write(files: Record<string, string>): void {
	for (const [file, text] of Object.entries(files)) {
		const at = isAbsolute(file) ? file : join(root, file)
		mkdirSync(dirname(at), { recursive: true })
		writeFileSync(at, text)
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

// A clean root, with a section and a cloned repo, each page listed once and every link and code
// reference resolving. `ken`, which bundles `ken lint`, is on PATH as a user installs it, so
// `ken lint` goes through dispatch.
beforeEach(() => {
	dir = realpathSync.native(mkdtempSync(join(tmpdir(), 'ken-lint-')))
	root = join(dir, 'my ken')
	clone = join(root, '.repos/example.com/acme/web')
	const bin = join(dir, 'bin')
	mkdirSync(bin)
	writeFileSync(
		join(bin, 'ken'),
		`#!/bin/sh\nexec '${process.execPath}' '${join(import.meta.dirname, '../../ken/src/cli.ts')}' "$@"\n`,
		{ mode: 0o755 }
	)
	const git = execFileSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim()
	env = {
		HOME: join(dir, 'home'),
		XDG_CONFIG_HOME: join(dir, 'config'),
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
			'**example.com/acme/web:src/app.ts** in bold, [encoded](example.com/acme/web:src/app/%5Bid%5D/page.ts), [spaced](example.com/acme/web:src/my%20file.ts).\n',
		[join(clone, 'src/app.ts')]: 'export const start = 1\n',
		[join(clone, 'src/my file.ts')]: 'export default 1\n',
		[join(clone, 'src/app/[id]/page.ts')]: 'export default 1\n',
		[join(clone, 'src/app/(auth)/page.ts')]: 'export default 1\n',
		// the clone's own pages, listed by no section here
		[join(clone, 'README.md')]: '# Web\n',
		[join(clone, 'docs/stray.md')]: '# Stray\n',
		// tasks, not pages, in a task folder below a section
		'work/README.md': '# Work\n',
		'work/tasks/fix-join.md': 'Fix the join form.\n'
	})
	// a link back into a section walks nothing twice
	symlinkSync('.', join(root, 'systems/again'))
	symlinkSync('pages', join(root, 'systems/alias'))
	// the task folder, first reached through a link to the section above it
	symlinkSync('work', join(root, 'a-work'))
	// the checkouts, never walked, even through a link
	symlinkSync('.repos/example.com/acme/web', join(root, 'web'))
	appendFileSync(join(root, '.ken'), 'task.folder=work/tasks\n')
}, 30_000)

describe('ken lint', { timeout: 30_000 }, () => {
	it('passes a clean root', () => {
		const r = run('ken lint')
		expect(r.stderr).toBe('')
		expect(r.stdout).toBe('ken lint: no errors in 3 pages.\n')
		expect(r.status).toBe(0)
	})

	it('reports each problem once, with its file', () => {
		const pad = (n: number) => 'line\n'.repeat(n)
		write({
			'systems/lost.md': 'See `example.com/acme/api:src/x.ts`, not cloned here.\n',
			'flows/README.md':
				'# Flows\n\n- [join](../systems/join.md): listed twice.\n\ngit/acme/web:src/gone.ts\n\n[lost]: ../systems/lost.md\n',
			[join(root, '.repos/git/acme/web/src/app.ts')]: 'export const start = 1\n',
			'systems/old notes.md': '# Old\n',
			'overview.md': '# Overview\n'
		})
		appendFileSync(join(root, 'systems/README.md'), '- [old](old%20notes.md): settled long ago.\n')
		commit(root, "'systems/old notes.md'", '2020-01-01T00:00:00')
		appendFileSync(join(root, 'README.md'), pad(60))
		appendFileSync(join(root, 'AGENTS.md'), pad(40))
		appendFileSync(join(root, 'flows/README.md'), pad(150))
		appendFileSync(join(root, 'systems/join.md'), 'example.com/acme/web:src/app/(auth)/gone.ts\n')
		appendFileSync(
			join(root, 'systems/design(v2).md'),
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
				'error flows/README.md', // a section README over 150
				'error systems/design(v2).md:8', // a link to a file that does not exist
				'error systems/design(v2).md:10', // and a reference-style one
				'error overview.md', // a page at the top, in no section
				'error flows/README.md:5', // a reference to a file not in the clone, a host with no dot
				'error systems/join.md', // listed in two section READMEs
				'error systems/join.md:2', // a reference to a missing file under (auth)/, on its line
				'error systems/lost.md', // listed in none: a definition no link uses renders nothing
				'note systems/old notes.md' // nobody links to it, untouched since 2020
			].sort()
		)
		// the archive command keeps a name with a space one word
		expect(r.stdout).toContain(
			`cd "$(ken path root)" && mkdir -p -- '.archive/systems' && git mv -- 'systems/old notes.md' '.archive/systems/old notes.md'`
		)
		// the uncloned repo is counted, not an error
		expect(r.stdout).toMatch(/^note: .*1 code reference.*example\.com\/acme\/api/m)
	})

	it('stops when the task folder is set to nothing, rather than guess it', () => {
		appendFileSync(join(root, '.ken'), 'task.folder= \n')
		const r = run('ken lint')
		expect(r.status).toBe(1)
		expect(r.stdout).toBe('')
		expect(r.stderr).toMatch(/\.ken line \d+, "task\.folder= ", sets task\.folder to nothing/)
	})
})
