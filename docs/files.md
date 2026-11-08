# ken — file formats

The files `ken` reads and writes, and their grammar. Two files, two formats, both one line
per fact, chosen so a shell script reads and edits them with `awk` and `sed` and nothing
else. This document is the spec; `docs/prd.md` says what the files mean.

| File            | Format    | Holds                                                                            |
| --------------- | --------- | -------------------------------------------------------------------------------- |
| `<root>/.ken`   | key=value | the root's settings, and other tools' keys; its presence makes the folder a root |
| `<root>/.repos` | stanzas   | the index: one record per repo, cloned or not                                    |

## Rules for both

1. UTF-8, lines end in `\n`, one fact per line. There are no continuation lines: a value
   that needs a newline is a page the value points at.
2. A line whose first character is `#` is a comment. Comments are whole lines, never after
   a value, so a value may contain `#`.
3. A value is the rest of the line, with the whitespace at either end dropped. There is no
   quoting, no escaping and no expansion: what is written is what is read.
4. A writer changes only the lines it means to change and keeps every other line, comment
   and order as it is. It writes the whole file beside the old one and renames it over.
5. A reader that cannot read a file stops, naming the file, the line and what it expected.

## key=value

```
# This root's settings. <key>=<value>, one per line; the first segment of a key names its tool.
clone.blobless=false
org.me=github.com/xiaoxinghu
layer.sales-atlas=github.com/acme/sales-atlas
layer.handbook=github.com/acme/handbook
task.folder=tasks
```

- A line is `<key>=<value>`, split at the first `=`. A key is `[A-Za-z0-9_.-]+`. No space
  around the `=`.
- A key's first dot-separated segment is the tool that owns it: `clone`, `org`, `layer` and
  `root` are `ken`'s; any other prefix is another tool's, kept and printed by `ken config`.
- A name that would be a list element goes into the key, not into the value:
  `layer.<name>=<repo key>`, `org.<name>=<host>/<owner>`. Order in the file is the order
  that matters, so layers are in file order.
- A key is a scalar. A repeated key reads as its last line.
- Read: `sed -n 's/^task\.folder=//p' .ken`. Set: replace the line, or append it when
  missing. Unset: delete the line.

Keys `ken` owns: `clone.blobless` (`true` or `false`, default `true`); `org.<name>`, a
lowercase `<host>/<owner>`; `layer.<name>`, a lowercase `<host>/<owner>/<repo>`, `<name>` a
folder name at the root. `root` is refused: the root is per machine, as is the folder of the
checkouts, `KEN_SRC`, which is no key either. No other file is
configuration: a `.ken` is only ever at the top of a root, so finding one while walking up
from a folder finds the root.

## Stanzas

```
# .repos: what each repo is. Whether it exists is the remote's business.

owner: github.com/acme
desc: acme's GitHub org. Sales tribe repos are tagged sales.

repo: github.com/acme/join-web
desc: Front end for the direct-to-consumer join funnel.
kind: frontend
tags: sales join
depends_on: join-api
doc: systems/join.md
```

- A stanza is a run of field lines; one or more blank lines end it. Its first line is
  `repo: <host>/<owner>/<repo>` or `owner: <host>/<owner>`, lowercase, and that key appears
  in one stanza per file.
- A field line is `<name>: <value>`: a name `[A-Za-z0-9_-]+`, a colon, a space, the value.
  A name appears once per stanza. `desc`, when present, is not empty.
- A list is one line, its items separated by spaces, so an item has no space in it:
  `tags: sales join`. The fields `ken` knows as lists are `tags` and `depends_on`.
- Unknown fields are kept and shown as written.
- Read, with awk's paragraph mode: `awk -v RS= -F'\n' '$1=="repo: <key>"' .repos`
  prints a stanza. Set: rewrite that one stanza, replacing the field's line or appending
  it; a key with no stanza gets a new one at the end. Remove: drop the stanza and the blank
  line after it. A stanza with only its first line is an entry with no fields.

## Not in these formats

Continuation lines, quoting, escapes, inline comments, nesting, includes, anchors and
aliases, and any value longer than a line. Prior art: `/etc/os-release` for key=value, and
Debian's `deb822` control files, RFC 822 stanzas, for the index.
