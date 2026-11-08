#!/usr/bin/env node
// The knowledge-base lint, an external subcommand of ken: see "`ken-lint`" in docs/prd.md.
import { AGENTS_MAX, FRONT_PAGE_MAX, lint, SECTION_README_MAX, STALE_DAYS } from './lint.ts'

const HELP = `ken lint

Check the knowledge base of the ken root, and each layer's, so it stays safe to read top
down: front page, section README, page. Hidden entries and the task folder are skipped.

Errors, exit 1:
  a page in no section README.md, or in more than one; a page at the top, outside a section
  a Markdown link to a file that does not exist
  a code reference <key>:<path> whose file is not in the clone (ken path resolves it)
  the front page over ${FRONT_PAGE_MAX} lines, a section README.md over ${SECTION_README_MAX}, AGENTS.md over ${AGENTS_MAX}
Notes, exit 0:
  code references into repos not cloned here, counted
  links into a layer not cloned here (not pushed yet, or private), or not linked yet, per layer
  pages nobody links to and nobody has changed in ${STALE_DAYS} days, proposed for .archive/

Links and references in code blocks are examples and not checked.

Examples:
  ken lint
  ken lint && git commit -am "systems: the join flow"`

const args = process.argv.slice(2)
if (args.includes('--help') || args.includes('-h')) {
	console.log(HELP)
	process.exit(0)
}
if (args.length) {
	console.error(
		`ken lint takes no arguments, got ${JSON.stringify(args.join(' '))}: it checks the whole root. Run \`ken lint\`; \`ken lint --help\` says what it checks.`
	)
	process.exit(1)
}
const root = process.env.KEN_ROOT
if (!root) {
	console.error(
		'ken-lint: KEN_ROOT is not set, so there is no root to check. Run it as `ken lint`, which sets it.'
	)
	process.exit(1)
}
try {
	const { lines, errors } = lint(root)
	for (const line of lines) console.log(line)
	process.exit(errors ? 1 : 0)
} catch (e) {
	console.error(`ken lint: ${(e as Error).message}`)
	process.exit(1)
}
