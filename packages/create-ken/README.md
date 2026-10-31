# create-ken

`npm create ken [<dir>] [-- --template <name>]` makes a new ken root in `<dir>`, which
must be new or empty. It copies the template, runs `git init` and `ken init` (through its
own `@unclex/ken`), and prints the next commands: `cd`, `direnv allow`, the first commit,
`ken layer add <key>` to join a team, and the `KEN_ROOT` to export when `<dir>` is not
the configured root.

On a terminal it asks for what was not given: the directory, offering the configured root
(`~/ken` by default), and the template. Off a terminal `<dir>` is required and the
template is `minimal`.

```sh
npm create ken ~/ken
npm create ken ~/work -- --template minimal
```

Templates are in `templates/`, described in its README. See "create-ken" in `docs/prd.md`
at the repo root.
