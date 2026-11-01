# create-ken

`npm create ken [<dir>] [-- --template <name>]` makes a new ken root in `<dir>`, which
must be new or empty. It copies the template, runs `git init` and `ken init` (through its
own `@unclex/ken`), links `CLAUDE.md -> AGENTS.md`, and prints the next commands: `cd`,
the first commit, starting an agent there, `ken layer add <key>` to join a team, and the
`KEN_ROOT` to export when `<dir>` is not the configured root. The `minimal` template adds
nothing to what `ken init` makes: the agent grows the root from there. The `agents` template
adds the hook that prints `ken status` at session start, for Claude Code, Codex and pi,
Claude Code's deny rules, and `ken lint`, which checks the knowledge base.

On a terminal it asks for what was not given: the directory, offering the configured root
(`~/ken` by default), and the template. Off a terminal `<dir>` is required and the
template is `minimal`.

```sh
npm create ken ~/ken
npm create ken ~/work -- --template minimal
npm create ken ~/ken -- --template agents
```

Templates are in `templates/`, described in its README. See "create-ken" in `docs/prd.md`
at the repo root.
