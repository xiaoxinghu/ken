# create-ken

Make a folder a ken root for an agent harness: `ken init`, then the template's files,
`AGENTS.md`, `README.md`, the session-start hook of Claude Code, Codex and pi, and the env
files, adding only what is missing. A rerun in a root adds the files a newer template has and
names each file that differs from it, with the `diff` to run.

```sh
npm create ken ~/ken
cd ~/ken && npm create ken   # a rerun
```

From a clone, with no build: `node packages/create-ken/src/cli.ts <dir>`. The template is
`template/`, plain files, `gitignore` written as `.gitignore`, since npm leaves a file of that
name out of a package; `CLAUDE.md` and `.codex/hooks.json` are links, made at run time. What
each file is for: `docs/templates.md` at the repo root.
