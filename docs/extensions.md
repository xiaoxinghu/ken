# Extensions

Every `ken` command that is not a core primitive is an extension: the standard commands
bundled in `@unclex/ken`, a root's own tools in its `.bin/`, and any package that puts a
`ken-<name>` on `PATH`. This is the contract between them and the core
([PRD](prd.md), decisions 11 to 13). Bundled or not, it is the same, so a standard command
is written as any extension is, and a root can replace one.

## What an extension is

An executable named `ken-<name>`, in any language, run as `ken <name> [<args>]`. `<name>` is
letters, digits and `-`. A bundled one is a TypeScript file in `@unclex/ken`'s map of
bundled commands, run by the runtime that runs `ken`, so it needs no executable bit and no
link of its own.

## Where `ken` finds it

The first match, in this order:

1. **A core command**: `init`, `path`, `which`, `get`, `repos`, `index`, `help`, `version`.
   Never shadowed.
2. **The root's `.bin/`**: an executable file `ken-<name>`. A file of that name that is not
   executable is not skipped: `ken` stops, naming it and the `chmod +x` to run.
3. **The bundled commands**: `status`, `log`, `digest`, `session`, `task`, `lint`.
4. **`PATH`**: the first executable `ken-<name>`.

The root's `.bin/` is ahead of the bundled commands on purpose: a root replaces a standard
command by writing its own, and `ken help` lists each command under where it was found,
saying when one shadows another. Outside any root, step 2 is skipped. Not found, `ken`
names the places it looked, in order, and says to add an executable `ken-<name>` to the
root's `.bin/`.

## What it gets

- **`KEN_ROOT`**: the root, a real path, when `ken` found one; unset outside any root. An
  extension that needs a root and has none says so and how to get one (`cd` into a root,
  or `ken init`).
- **`PATH`**, with a folder first whose `ken` is this same ken, run by the same runtime, so
  the extension calls `ken` back whether or not one is installed, and never reaches a
  different version.
- **Its arguments**, everything after `<name>`, as given.
- **Stdin, stdout and stderr**, inherited untouched, and **its exit status**, which is
  `ken`'s.

Nothing else is set or promised: the rest of the environment is the caller's.

## What it may rely on

- **The core's commands**, called as `ken <command>`: their stdout, one record per line,
  tab-separated under `--porcelain`, `get` printing only the path; and their exit status,
  0 when done and non-zero when refused, the message on stderr. These change only with a major
  version of ken.
- **The two files**, by [`files.md`](files.md): `.ken` and `.repos.index`, at `KEN_ROOT`.
  Read either directly. Write `.repos.index` only through `ken index set`, and in `.ken`
  only keys whose first segment is the extension's own, by the rules of `files.md`: the
  line replaced or appended, every other line kept, the file written beside and renamed
  over.
- **`ken.format`** in `.ken`, the format of all of the above (PRD, decision 4).

Where a checkout is comes from `ken path`, `ken which` and `ken get`, never from a path
built by hand: the layout is the core's, and a format bump may move it.

## What it must not do

- **Import the core.** Not `@unclex/ken-core`, not a file of it: the process boundary is
  the contract, so the core and a command release apart and a command can be any
  language. A bundled command is held to this as any other.
- **Shadow by accident.** A `ken-<name>` in `.bin/` named for a standard command replaces
  it; a copy of a standard command there goes stale against the installed one.
- **Expect to be installed by `ken`.** `ken` never fetches, pins or declares an extension.
  A root that relies on one beyond the bundled names it, and how to install it, in its
  `AGENTS.md`.

## Conventions

The core's own rules, which an extension keeps so the whole CLI reads as one:

- Every message is a next step: what is the case, why it matters, what to run, with real
  paths and keys filled in (PRD, decision 24).
- `ken <name> --help` prints the usage with examples, as the core's commands do.
- A listing prints one record per line; `--porcelain`, where there is one, is tab-separated.
- Settings live in `.ken` under the extension's name, `<name>.<key>=<value>`, read with a
  default when absent.

## An example

```sh
#!/bin/sh
# .bin/ken-hello: the root's own command, run as `ken hello`.
set -eu
printf 'root %s, %s repos listed\n' "$KEN_ROOT" \
	"$(ken repos --porcelain | awk -F'\t' '$3 == "true"' | wc -l | tr -d ' ')"
```
