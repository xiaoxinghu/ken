// A bundled command for the tests: says what runs it and what it got, each argument ended by
// |, and exits with the status its first argument names.
const runtime = process.versions.bun ? 'bun' : 'node'
const args = process.argv.slice(2)
console.log(
	`bundled fixture under ${runtime}, KEN_ROOT=${process.env.KEN_ROOT ?? 'unset'}, args: ${args.map((a) => `${a}|`).join('')}`
)
process.exitCode = Number(args[0]) || 0
