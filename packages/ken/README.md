# @unclex/ken

ken, the CLI of a root, a folder that is a knowledge base: what a person installs. It is
`@unclex/ken-core` plus the standard commands, bundled, each in the form of an extension
(`docs/extensions.md` at the repo root): a file this package maps a name to, run as
`ken <name>` by the runtime that runs ken. A root's `.bin/` can replace any of them.

```sh
npm install -g @unclex/ken
npm create ken ~/ken
```

From a clone, with no build:

```sh
node packages/ken/src/cli.ts help
bun packages/ken/src/cli.ts version
```

The map in `src/cli.ts` holds `status`, `log`, `digest` and `session`, a file each,
`src/ken-<name>.ts`, `dist/ken-<name>.js` in the package, and `task` (`@unclex/ken-task`) and
`lint` (`@unclex/ken-lint`), each by the `bin` of its manifest.
