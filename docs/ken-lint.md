# ken-lint — PRD

The knowledge-base lint of a ken root. Its own package, `@unclex/ken-lint`, installed beside
`ken` and reached as `ken lint` through `PATH` ([PRD](prd.md), decision 10). It is a package
and not a `.bin/` script because it parses Markdown as CommonMark
(`mdast-util-from-markdown`), so a link, a code span and a link's label are what a Markdown
reader sees, never a guess at where one ends. It reads `.ken` for the layers and the task
folder, and runs `ken path` for every code reference. The caps are constants at the top of
its source.

## What it checks

It walks the root's sections and each layer's, a layer's own layers too, through the layer
links as `find -L` does, each folder once, skipping hidden entries and the task folders: the
root's, and each layer's from its own `.ken`, compared by real path; an offline layer has
nothing to walk, and a `.ken` it cannot read stops it. Each problem names its file, its line
when it has one, and what to do.

**Errors, exit 1:**

- a page in no section `README.md`, or in more than one;
- a `.md` at the top of the root or a layer other than `README.md`, `AGENTS.md`, `CLAUDE.md`
  and `log.md`: a page in no section;
- a Markdown link or reference definition to a file that does not exist;
- a code reference, in prose or a code span, that `ken path` resolves to a file not in the
  clone;
- a direct layer with no line under `## Layers` in the front page, or a line there for no
  layer (the kernel does not edit Markdown; the agent writes the line, lint checks it);
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
