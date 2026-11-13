#!/usr/bin/env node
// ken: the core, with the standard commands bundled, each run as an extension
// (docs/extensions.md).
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { main } from '@unclex/ken-core'

const { name, version } = JSON.parse(
	readFileSync(new URL('../package.json', import.meta.url), 'utf8')
)

/** The bundled commands, name to file. `fixture` stands in for the standard ones until they
 * come, so the tests can reach the bundled place. */
const bundled = {
	fixture: fileURLToPath(new URL('./ken-fixture.ts', import.meta.url))
}

process.exitCode = main(process.argv.slice(2), { bundled, version: `${name} ${version}` })
