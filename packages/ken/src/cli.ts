#!/usr/bin/env node
// ken: the core, with the standard commands bundled, each run as an extension
// (docs/extensions.md).
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { main } from '@unclex/ken-core'

const { name, version } = JSON.parse(
	readFileSync(new URL('../package.json', import.meta.url), 'utf8')
)

/** The bundled commands, name to file: this package's own, src/ken-<name>.ts, and each other
 * package's entry, never an import of it. */
const own = (name: string) => fileURLToPath(new URL(`./ken-${name}.ts`, import.meta.url))
const entry = (pkg: string) => fileURLToPath(import.meta.resolve(`${pkg}/src/cli.ts`))
const bundled = {
	status: own('status'),
	log: own('log'),
	digest: own('digest'),
	session: own('session'),
	task: entry('@unclex/ken-task'),
	lint: entry('@unclex/ken-lint')
}

process.exitCode = main(process.argv.slice(2), { bundled, version: `${name} ${version}` })
