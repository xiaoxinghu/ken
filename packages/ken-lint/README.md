# @unclex/ken-lint

The knowledge-base lint of a ken root. Bundled in `@unclex/ken`, which runs it as `ken
lint`, with `KEN_ROOT` set to the root.

It walks the root's sections and each layer's and reports, each with its file and what to
do: a page in no section README or in two, a page at the top outside any section, a link to
a file that does not exist, a code reference `<key>:<path>` whose file is not in the clone,
and the caps (front page 60 lines, section README 150, `AGENTS.md` 40). It exits 1 on any
of those. References into repos not cloned, and old pages nobody links to, are notes.
Markdown is parsed as CommonMark, so links and references in code blocks are examples.

```sh
ken lint
ken lint --help
```

The caps are constants at the top of `src/lint.ts`. See "`ken-lint`" in `docs/prd.md` at
the repo root.
