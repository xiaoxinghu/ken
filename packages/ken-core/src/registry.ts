// The index, `.repos.index`, as the layout commands read and write it (PRD 7): written by `get`
// and `index set` only, under `.repos.index.lock`, so writers at once lose nothing.
import { lstatSync, readFileSync, readlinkSync, rmSync, symlinkSync } from 'node:fs'
import { join } from 'node:path'
import { die, q } from './die.ts'
import { parseIndex, setFields, writeAtomic } from './files.ts'
import { alive, sleep } from './git.ts'
import { parseKey, redact } from './keys.ts'
import { findRoot } from './root.ts'

/** Whether `value` holds no line break, of any kind the index's reader would stop on. */
export const oneLine = (value: string) => !/[\n\r\u2028\u2029]/.test(value)

/** The text of the index `file`, empty when there is none. */
const readText = (file: string) => {
	const stat = lstatSync(file, { throwIfNoEntry: false })
	if (!stat) return ''
	if (!stat.isFile())
		die(
			`${file} is not a file, so ken cannot read or write the index there. Move it aside,`,
			`e.g. \`mv ${q(file)} ${q(`${file}.old`)}\`, then rerun.`
		)
	return readFileSync(file, 'utf8')
}

/** The repo stanzas of the index of `root`. */
export const readIndex = (root: string) => {
	const file = join(root, '.repos.index')
	return parseIndex(readText(file), file).filter((s) => s.kind === 'repo')
}

/** Rewrite the index of `root` by `edit`, which gets its text and whether `key` has an entry and
 * returns the new text, or undefined to leave it. Writers take turns: the lock is a symlink to
 * the holder's PID, made in one step, and only its holder removes it. */
export const editIndex = (
	root: string,
	key: string,
	edit: (text: string, listed: boolean) => string | undefined
) => {
	const file = join(root, '.repos.index')
	const lock = `${file}.lock`
	for (;;) {
		const there = lstatSync(lock, { throwIfNoEntry: false })
		if (there && !there.isSymbolicLink())
			die(
				`${lock} is in the way of the lock on ${file}, a symlink to its writer's PID, so no write`,
				`could take turns there. Move it aside, e.g. \`mv ${q(lock)} ${q(`${lock}.old`)}\`, then rerun.`
			)
		try {
			symlinkSync(String(process.pid), lock)
			break
		} catch (e) {
			if ((e as NodeJS.ErrnoException).code !== 'EEXIST')
				die(`could not take the lock ${lock}: ${(e as Error).message}. Fix that, then rerun.`)
		}
		let holder: string
		try {
			holder = readlinkSync(lock)
		} catch {
			continue
		}
		if (alive(Number(holder))) {
			sleep(100)
			continue
		}
		let still: string | undefined
		try {
			still = readlinkSync(lock)
		} catch {}
		if (still === holder)
			die(
				`${lock} is the lock on ${file}, left by process ${holder}, which ended before releasing it,`,
				'so no write waiting on it would ever start. Check that no ken is running, then run',
				`\`rm ${q(lock)}\` and rerun.`
			)
	}
	try {
		const text = readText(file)
		const listed = parseIndex(text, file).some((s) => s.kind === 'repo' && s.key === key)
		const out = edit(text, listed)
		if (out !== undefined) writeAtomic(file, out)
	} finally {
		rmSync(lock, { force: true })
	}
}

/** `ken index set <key> <field>=<value>...`. */
export const indexSet = (args: string[]) => {
	const [sub, asked, ...pairs] = args
	if (sub !== 'set')
		die(
			`ken index takes set, then a repo key, got ${sub === undefined ? 'nothing' : q(redact(sub))}.`,
			'Run e.g. `ken index set github.com/acme/join-web desc="Front end for the join funnel."`,',
			'or `ken index --help` for the form. To remove a field or an entry, edit .repos.index.'
		)
	if (asked === undefined)
		die('ken index set needs a repo key. Run `ken index --help` for the form.')
	const { key } = parseKey(asked)
	const root = findRoot()
	const file = join(root, '.repos.index')
	if (!pairs.length)
		die(
			`ken index set ${key} needs at least one <field>=<value> to write.`,
			`Run e.g. \`ken index set ${key} desc="What it is, in a line."\`.`
		)
	const fields = pairs.map((arg): [string, string] => {
		const eq = arg.indexOf('=')
		const name = eq < 0 ? '' : arg.slice(0, eq)
		const value = arg.slice(eq + 1)
		if (!/^[A-Za-z0-9_-]+$/.test(name) || name === 'repo')
			die(
				`${q(redact(arg))} is not a <field>=<value> ken index set can write: a field name is`,
				"letters, digits, _ and -, and repo is the entry's key line, not a field.",
				`Run e.g. \`ken index set ${key} kind=frontend\`.`
			)
		if (!oneLine(value))
			die(
				`the value of ${name} has a line break, and an index value is one line. Write longer text`,
				`in a page, then run \`ken index set ${key} doc=<path>\`.`
			)
		if (value.trim() === '')
			die(
				`the value of ${name} is empty, and an empty field says nothing. Run`,
				`\`ken index set ${key} ${name}=<value>\` with a value, or delete its line from ${file} to remove it.`
			)
		return [name, value]
	})
	let entry = 'a new entry'
	editIndex(root, key, (text, listed) => {
		if (listed) entry = 'the entry'
		return setFields(text, key, fields)
	})
	const names = [...new Set(fields.map(([name]) => name))].join(', ')
	return `Set ${names} in ${entry} for ${key}, in ${file}.\n`
}
