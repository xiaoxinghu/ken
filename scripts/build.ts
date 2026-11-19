// The JavaScript a package ships, run by each package's `prepack`: Node strips no types from a
// file under node_modules, so the tarball holds dist/, each src/*.ts but the tests with its
// types erased and its `.ts` imports named `.js`, and the repository's LICENSE. A clone runs
// src/ and never needs this (docs/releasing.md).
import { copyFileSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import ts from 'typescript'

const compilerOptions = {
	module: ts.ModuleKind.Preserve,
	target: ts.ScriptTarget.ES2023,
	verbatimModuleSyntax: true,
	rewriteRelativeImportExtensions: true
}
rmSync('dist', { recursive: true, force: true })
mkdirSync('dist')
for (const file of readdirSync('src')) {
	if (!file.endsWith('.ts') || file.endsWith('.test.ts')) continue
	const { outputText } = ts.transpileModule(readFileSync(`src/${file}`, 'utf8'), {
		compilerOptions,
		fileName: file
	})
	writeFileSync(`dist/${file.replace(/\.ts$/, '.js')}`, outputText)
}
copyFileSync(new URL('../LICENSE', import.meta.url), 'LICENSE')
