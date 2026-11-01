import { spawnSync } from 'node:child_process'
import {
	chmodSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	realpathSync,
	symlinkSync,
	utimesSync,
	writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { localDate } from './list.ts'

let dir: string
let bin: string

// `ken` and `ken-task` on PATH as a user installs them, so `ken task` goes through dispatch
beforeAll(() => {
	dir = realpathSync.native(mkdtempSync(join(tmpdir(), 'ken-task-')))
	bin = join(dir, 'bin')
	mkdirSync(bin)
	symlinkSync(join(import.meta.dirname, '../../ken/src/cli.ts'), join(bin, 'ken'))
	symlinkSync(join(import.meta.dirname, 'cli.ts'), join(bin, 'ken-task'))
})

const kenTask = (root: string, ...args: string[]) => {
	const r = spawnSync(
		process.execPath,
		[join(import.meta.dirname, '../../ken/src/cli.ts'), 'task', ...args],
		{
			encoding: 'utf8',
			env: {
				...process.env,
				KEN_ROOT: root,
				PATH: `${bin}:${dirname(process.execPath)}:${process.env.PATH}`
			}
		}
	)
	return { status: r.status, stdout: r.stdout, stderr: r.stderr }
}

const write = (file: string, text: string) => {
	mkdirSync(dirname(file), { recursive: true })
	writeFileSync(file, text)
}

const newRoot = (kenYaml = '') => {
	const root = mkdtempSync(join(dir, 'root-'))
	writeFileSync(join(root, '.ken.yaml'), kenYaml)
	return root
}

const day = (offset: number) => localDate(new Date(Date.now() + offset * 864e5))

type Row = {
	path: string
	title: string
	status: string
	'blocked-by': string[]
	state: string
	unmet: { ref: string; path?: string; reason: string }[]
	notes: string[]
	[field: string]: unknown
}

describe('ken task list', () => {
	let root: string
	let folder: string
	let rows: Map<string, Row>
	const row = (rel: string): Row => {
		const r = rows.get(join(folder, rel))
		if (!r) throw new Error(`no row for ${rel}`)
		return r
	}
	const front = (text: string) => `---\n${text}\n---\n`

	beforeAll(() => {
		root = newRoot('task:\n  folder: work\n')
		folder = join(root, 'work')
		const task = (rel: string, text: string) => write(join(folder, rel), text)
		task('remember-the-milk.md', 'Before Friday.\n')
		task('typo.md', '---\nstatus: tdo\n---\n# Typo\n')
		task('finished.md', '---\nstatus: done\nclosed: 2026-10-01\n---\n# Finished\n')
		task('a.md', '# A\n')
		task('on-open.md', front('blocked-by: [a.md]'))
		task('portal/on-archived.md', front('blocked-by: [a.md]'))
		write(join(folder, '.archive/portal/a.md'), '---\nstatus: done\n---\n')
		task('portal/on-suffixed.md', front('blocked-by: [b.md]'))
		write(join(folder, '.archive/portal/b-2.md'), '---\nstatus: done\n---\n')
		task('on-missing.md', front('blocked-by: [nowhere.md]'))
		task('alias.md', front('depends_on: a.md'))
		task('scalar.md', front('blocked-by: a.md'))
		task('quoted-scalar.md', front('depends_on: "a.md"'))
		task('block-list.md', front('blocked-by:\n  - a.md'))
		task('unclosed.md', '---\nstatus: done\n# Unclosed\n')
		task('x/y.md', '# Y\n')
		task('z/up.md', front('blocked-by: [../x/y.md]'))
		task('z/from-root.md', front('blocked-by: [work/x/y.md]'))
		task('later.md', front(`scheduled: ${day(1)}`))
		task('overdue.md', front(`due: ${day(-1)}`))
		task('bad-date.md', front('scheduled: next week'))
		task('not-yaml.md', `${front('status: done\ntitle: Issue: 12')}# Not YAML\n`)
		task('twice.md', front('blocked-by: [a.md]\ndepends_on: [a.md]'))
		symlinkSync('x', join(folder, 'linked-folder'))
		task('notes.txt', '---\nstatus: done\n---\n')
		task('quoted.md', front('  # metadata\nstatus: "done" # finished\nrepo: \'github.com/a/b\''))
		task('into-archive.md', front('blocked-by: [.archive/portal/b.md]'))
		task('bad-month.md', `${front('due: 2026-13-01')}# Bad month\n`)
		task('locked/hidden-inside.md', '# Locked\n')
		chmodSync(join(folder, 'locked'), 0)
		task('unsearchable/inside.md', '# Inside\n')
		chmodSync(join(folder, 'unsearchable'), 0o400)
		mkdirSync(join(folder, '.archive/c.md'), { recursive: true })
		task('on-archive-folder.md', front('blocked-by: [c.md]'))
		task('a,b.md', front('status: done'))
		task('on-comma.md', front('blocked-by: ["a,b.md", x/y.md]'))
		task('a # b.md', front('status: done'))
		task('on-hash.md', front('blocked-by: ["a # b.md"] # the hash is the name\'s'))
		task('Upper.md', '# Upper\n')
		task('on-case.md', front('blocked-by: [upper.md]'))
		symlinkSync('loop.md', join(folder, 'loop.md'))
		symlinkSync('gone.md', join(folder, 'dangling.md'))
		task(
			'all.md',
			`${front(
				[
					'status: todo',
					`created: ${day(-3)}`,
					'closed: 2026-10-02',
					'repo: github.com/acme/portal',
					'blocked-by: [finished.md]',
					`scheduled: ${day(-1)}`,
					`due: ${day(5)}`,
					'owner: someone # kept',
					'log: |',
					'  first',
					'',
					'    indented'
				].join('\n')
			)}# All the fields\n`
		)
		task('README.md', '# Conventions\n')
		task('.hidden.md', '# Hidden\n')
		const r = kenTask(root, 'list', '--json')
		chmodSync(join(folder, 'locked'), 0o755)
		chmodSync(join(folder, 'unsearchable'), 0o755)
		expect(r).toMatchObject({ status: 0, stderr: '' })
		rows = new Map((JSON.parse(r.stdout) as Row[]).map((t) => [t.path, t]))
	})

	it('lists every file at any depth by absolute path, except README.md and dot entries', () => {
		expect([...rows.keys()]).toEqual([...rows.keys()].sort())
		expect(rows.has(join(folder, 'x/y.md'))).toBe(true)
		expect([...rows.keys()].some((p) => /README|hidden|\.archive/.test(p))).toBe(false)
	})

	it('reads a bare file as a ready task titled from its name', () => {
		expect(row('remember-the-milk.md')).toMatchObject({
			title: 'remember the milk',
			status: 'todo',
			state: 'ready',
			notes: []
		})
	})

	it('reads a status outside the three as open and flags it; done as done', () => {
		expect(row('typo.md')).toMatchObject({ status: 'tdo', state: 'ready', title: 'Typo' })
		expect(row('typo.md').notes.join()).toMatch(/flagged: status "tdo".*ken task lint/)
		expect(row('finished.md').state).toBe('done')
	})

	it('blocks on an open blocker, not on an archived one at any suffix, and on a missing one', () => {
		expect(row('on-open.md')).toMatchObject({
			state: 'blocked',
			unmet: [{ ref: 'a.md', path: join(folder, 'a.md'), reason: 'open' }]
		})
		expect(row('portal/on-archived.md')).toMatchObject({ state: 'ready', unmet: [] })
		expect(row('portal/on-suffixed.md')).toMatchObject({ state: 'ready', unmet: [] })
		expect(row('on-missing.md')).toMatchObject({
			state: 'blocked',
			unmet: [{ ref: 'nowhere.md', reason: 'missing' }]
		})
	})

	it('reads an alias, a scalar and a block list as one blocked-by, flagged', () => {
		for (const rel of ['alias.md', 'scalar.md', 'quoted-scalar.md', 'block-list.md']) {
			expect(row(rel)).toMatchObject({ 'blocked-by': ['a.md'], state: 'blocked' })
			expect(row(rel).notes.every((n) => n.startsWith('flagged: '))).toBe(true)
		}
	})

	it('lists unclosed front matter as a flagged open task, not an abort', () => {
		expect(row('unclosed.md')).toMatchObject({ status: 'todo', state: 'ready', title: 'Unclosed' })
		expect(row('unclosed.md').notes.join()).toContain('no closing `---`')
	})

	it('resolves a reference from the file, and accepts one that resolves only from the root, flagged', () => {
		const y = { ref: '../x/y.md', path: join(folder, 'x/y.md'), reason: 'open' }
		expect(row('z/up.md')).toMatchObject({ state: 'blocked', unmet: [y], notes: [] })
		expect(row('z/from-root.md')).toMatchObject({
			state: 'blocked',
			unmet: [{ ...y, ref: 'work/x/y.md' }]
		})
		expect(row('z/from-root.md').notes.join()).toContain('write it as ../x/y.md')
	})

	it('is later when scheduled after today, and notes a due date passed', () => {
		expect(row('later.md').state).toBe('later')
		expect(row('overdue.md')).toMatchObject({ state: 'ready', notes: [`overdue: due ${day(-1)}`] })
	})

	it('lists a file it cannot fully read as a problem with the fix', () => {
		expect(row('bad-date.md').state).toBe('problem')
		expect(row('bad-date.md').notes.join()).toContain('`scheduled: YYYY-MM-DD`')
	})

	it('reads a quoted value with a comment after it, and a comment before the first field', () => {
		expect(row('quoted.md')).toMatchObject({
			status: 'done',
			repo: 'github.com/a/b',
			state: 'done'
		})
	})

	it('takes a reference into the archive as closed, at any suffix', () => {
		expect(row('into-archive.md')).toMatchObject({ state: 'ready', unmet: [], notes: [] })
	})

	it('takes only a file in the archive as the archived task, not a folder of its name', () => {
		expect(row('on-archive-folder.md')).toMatchObject({
			state: 'blocked',
			unmet: [{ ref: 'c.md', reason: 'missing' }]
		})
	})

	it('keeps a hash inside a quoted blocked-by item, and drops the comment after it', () => {
		expect(row('on-hash.md')).toMatchObject({ 'blocked-by': ['a # b.md'], state: 'ready' })
	})

	it('finds a live blocker whose name differs in case on a case-insensitive disk', (ctx) => {
		if (!existsSync(join(folder, 'upper.md'))) ctx.skip()
		expect(row('on-case.md')).toMatchObject({
			state: 'blocked',
			unmet: [{ ref: 'upper.md', path: join(folder, 'Upper.md'), reason: 'open' }]
		})
	})

	it('keeps a comma inside a quoted blocked-by item', () => {
		expect(row('on-comma.md')).toMatchObject({
			'blocked-by': ['a,b.md', 'x/y.md'],
			unmet: [{ ref: 'x/y.md', reason: 'open' }]
		})
	})

	it('lists front matter that is not YAML as a problem naming the line, keeping the title', () => {
		expect(row('not-yaml.md')).toMatchObject({ title: 'Not YAML', state: 'problem' })
		expect(row('not-yaml.md').notes.join()).toContain('its front matter is not YAML (line 3: ')
	})

	it('lists blocked-by written twice, under an alias, as a problem', () => {
		expect(row('twice.md').state).toBe('problem')
		expect(row('twice.md').notes.join()).toContain('as blocked-by and as depends_on')
	})

	it('keeps the title of a file with an impossible date, and names the field to fix', () => {
		expect(row('bad-month.md')).toMatchObject({ title: 'Bad month', state: 'problem' })
		expect(row('bad-month.md').notes.join()).toContain('`due: YYYY-MM-DD`')
	})

	it.skipIf(process.getuid?.() === 0)(
		'lists a folder it cannot open, a file it cannot stat, a symlink loop and a dangling one as problems, and goes on',
		() => {
			for (const rel of [
				'locked',
				'loop.md',
				'dangling.md',
				'linked-folder',
				'unsearchable/inside.md'
			]) {
				expect(row(rel).state).toBe('problem')
				expect(row(rel).notes.join()).toContain(`\`ls -ld ${join(folder, rel)}\``)
			}
		}
	)

	it('gives a file that is not Markdown every default', () => {
		expect(row('notes.txt')).toMatchObject({ title: 'notes', status: 'todo', state: 'ready' })
	})

	it('carries every field in --json', () => {
		expect(row('all.md')).toEqual({
			path: join(folder, 'all.md'),
			title: 'All the fields',
			status: 'todo',
			created: day(-3),
			closed: '2026-10-02',
			repo: 'github.com/acme/portal',
			'blocked-by': ['finished.md'],
			scheduled: day(-1),
			due: day(5),
			other: { owner: 'someone', log: 'first\n\n  indented\n' },
			state: 'ready',
			unmet: [],
			notes: []
		})
	})

	it('prints one row per task: state, path, unmet blockers, then its notes', () => {
		const r = kenTask(root, 'list')
		expect(r).toMatchObject({ status: 0, stderr: '' })
		expect(r.stdout).toContain(
			`blocked  ${join(folder, 'on-missing.md')}  blocked by nowhere.md (missing: no such file in the folder or its archive)\n`
		)
		expect(r.stdout).toContain(`ready    ${join(folder, 'overdue.md')}\n         overdue: due`)
	})
})

describe('ken task list: age', () => {
	it('notes a task open more than 90 days, by created, else the git add date, else mtime', () => {
		const root = newRoot()
		const tasks = join(root, 'tasks')
		write(join(tasks, 'created.md'), `---\ncreated: ${day(-100)}\n---\n`)
		write(join(tasks, 'young.md'), `---\ncreated: ${day(-10)}\n---\n`)
		write(join(tasks, 'committed.md'), '# Committed\n')
		write(join(tasks, 'touched.md'), '# Touched\n')
		write(join(tasks, 'closed.md'), '---\nstatus: done\n---\n')
		const old = new Date(Date.now() - 200 * 864e5)
		utimesSync(join(tasks, 'touched.md'), old, old)
		utimesSync(join(tasks, 'closed.md'), old, old)
		const git = (...args: string[]) =>
			spawnSync('git', args, {
				cwd: root,
				env: {
					...process.env,
					GIT_AUTHOR_DATE: '2020-01-01T12:00:00',
					GIT_COMMITTER_DATE: '2020-01-01T12:00:00'
				}
			})
		git('init', '-q')
		git('add', 'tasks/committed.md')
		git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'add')
		const rows = JSON.parse(kenTask(root, 'list', '--json').stdout) as Row[]
		const notes = Object.fromEntries(rows.map((r) => [r.path.slice(tasks.length + 1), r.notes]))
		expect(notes['created.md']).toEqual([
			`open 100 days, since ${day(-100)} by created: finish it, or close it`
		])
		expect(notes['young.md']).toEqual([])
		expect(notes['committed.md']?.join()).toContain('since 2020-01-01 by the date git added it')
		expect(notes['touched.md']?.join()).toContain(`open 200 days, since ${day(-200)} by its mtime`)
		expect(notes['closed.md']).toEqual([])
	})
})

describe('ken task list: no tasks', () => {
	it('exits 0 with an empty list on a missing folder and on an empty one, saying how to add one', () => {
		const root = newRoot()
		for (const make of [false, true]) {
			if (make) mkdirSync(join(root, 'tasks'))
			const r = kenTask(root, 'list', '--json')
			expect(r).toMatchObject({ status: 0, stdout: '[]\n' })
			expect(r.stderr).toContain(`${join(root, 'tasks')}/do-the-thing.md`)
		}
	})

	it('lists a task folder it cannot look at as a problem row, and exits 0', () => {
		const root = newRoot('task:\n  folder: loop\n')
		symlinkSync('loop', join(root, 'loop'))
		const r = kenTask(root, 'list', '--json')
		expect(r).toMatchObject({ status: 0, stderr: '' })
		expect(JSON.parse(r.stdout)).toMatchObject([{ path: join(root, 'loop'), state: 'problem' }])
	})

	it('reads an absolute task.folder', () => {
		const tasks = mkdtempSync(join(dir, 'elsewhere-'))
		write(join(tasks, 'far.md'), '# Far\n')
		const r = kenTask(newRoot(`task:\n  folder: ${tasks}\n`), 'list')
		expect(r).toMatchObject({ status: 0, stdout: `ready  ${join(tasks, 'far.md')}\n` })
	})
})

describe('ken task --help', () => {
	it.each([[], ['--help'], ['list', '--help']])('%j carries examples', (...args) => {
		const r = kenTask(newRoot(), ...args)
		expect(r).toMatchObject({ status: 0, stderr: '' })
		expect(r.stdout).toContain('Examples:\n  ken task list')
	})

	it('names the help for a command it does not have', () => {
		const r = kenTask(newRoot(), 'lsit')
		expect(r).toMatchObject({ status: 1, stdout: '' })
		expect(r.stderr).toContain('Run `ken task --help`')
	})
})
