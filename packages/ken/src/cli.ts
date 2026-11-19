#!/usr/bin/env node
// ken: the core, with the standard commands bundled, each run as an extension
// (docs/extensions.md).
import { readFileSync } from 'node:fs'
import { dirname, extname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { main } from '@unclex/ken-core'

const { name, version } = JSON.parse(
	readFileSync(new URL('../package.json', import.meta.url), 'utf8')
)

/** The bundled commands, name to file: this package's own, ken-<name> beside this file, `.ts` in a
 * clone and `.js` in a package (docs/releasing.md), and each other package's bin, never an
 * import of it. */
const own = (name: string) =>
	fileURLToPath(new URL(`./ken-${name}${extname(import.meta.url)}`, import.meta.url))
const entry = (pkg: string) => {
	const manifest = fileURLToPath(import.meta.resolve(`${pkg}/package.json`))
	const { bin } = JSON.parse(readFileSync(manifest, 'utf8'))
	return resolve(dirname(manifest), Object.values<string>(bin)[0] ?? '')
}
const bundled = {
	status: own('status'),
	log: own('log'),
	digest: own('digest'),
	session: own('session'),
	task: entry('@unclex/ken-task'),
	lint: entry('@unclex/ken-lint')
}

process.exitCode = main(process.argv.slice(2), { bundled, version: `${name} ${version}` })
