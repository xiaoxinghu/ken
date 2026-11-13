#!/usr/bin/env node
// ken with only the core commands; the `ken` package calls `main` with its bundled ones.
import { main } from './main.ts'

process.exitCode = main(process.argv.slice(2))
