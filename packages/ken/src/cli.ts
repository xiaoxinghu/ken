#!/usr/bin/env node
// ken: the core, with the standard commands bundled, each run as an extension
// (docs/extensions.md).
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { main } from '@unclex/ken-core'

const { name, version } = JSON.parse(
	readFileSync(new URL('../package.json', import.meta.url), 'utf8')
)

/** The bundled commands, name to file: each package's own entry, never an import of it. */
const entry = (pkg: string) => fileURLToPath(import.meta.resolve(`${pkg}/src/cli.ts`))
const bundled = {
	task: entry('@unclex/ken-task'),
	lint: entry('@unclex/ken-lint')
}

process.exitCode = main(process.argv.slice(2), { bundled, version: `${name} ${version}` })
