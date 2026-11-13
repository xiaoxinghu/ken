# ken-lint — PRD

The knowledge-base lint of a ken root. Its own package, `@unclex/ken-lint`, bundled in
`@unclex/ken` and reached as `ken lint` ([PRD](prd.md), decision 12). It is a package
and not a `.bin/` script because it parses Markdown as CommonMark
(`mdast-util-from-markdown`), so a link, a code span and a link's label are what a Markdown
reader sees, never a guess at where one ends. It reads `.ken` for the task folder, and runs
`ken path` for every code reference. The caps are constants at the top of its source.

## What it checks

It walks the root's sections through their links as `find -L` does, each folder once,
skipping hidden entries, the root's `.repos/` and the task folder, compared by real path; a
`.ken` it cannot read stops it. Each problem names its file, its line when it has one, and
what to do.

**Errors, exit 1:**

- a page in no section `README.md`, or in more than one;
- a `.md` at the top of the root other than `README.md`, `AGENTS.md`, `CLAUDE.md` and
  `log.md`: a page in no section (`.repos.index` and `.repos/` are not pages either);
- a Markdown link or reference definition to a file that does not exist;
- a code reference, in prose or a code span, that `ken path` resolves to a file not in the
  clone;
- the front page over 60 lines, a section README over 150, the root `AGENTS.md` over 40.

**Notes, exit 0:**

- references into repos not cloned, counted with the `ken get` to run;
- a page nobody links to (a section README's listing does not count) and unchanged in a year
  by `git log -1`, with the `git mv` into `.archive/`.

Links and references in code blocks are examples and are not checked.

```sh
ken lint
ken lint --help
```
