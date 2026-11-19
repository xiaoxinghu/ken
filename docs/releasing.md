# Releasing ken

A release is a tag `vX.Y.Z` on `main`, annotated with the release's notes. The tag is the
version: the five packages, `@unclex/ken-core`, `@unclex/ken`, `@unclex/ken-task`,
`@unclex/ken-lint` and `create-ken`, share it, and nothing else holds it. Their manifests in
git say `0.0.0`, so a ken run from a clone says `@unclex/ken 0.0.0`, "from the source"; the
workflow writes the tag's version into them before it packs. No changelog file, no bump
commit: the notes are the tag's message and the GitHub release's, and earlier ones are read
from the tags, `git tag -l --format='%(contents)' vX.Y.Z` or `gh release view vX.Y.Z`.

## What a package holds

A clone runs the TypeScript source with no build. Node refuses to strip types from a file
under `node_modules`, so a package carries JavaScript: each package's `prepack` runs `tsc -p
tsconfig.build.json`, which writes `dist/`, every `src/*.ts` but the tests with its types
erased and its imports named `.js`, and copies the repository's `LICENSE` in. `publishConfig`
points `bin` and `exports` at `dist/` in the packed manifest only; the manifest in git names
`src/`. What finds a file at run time works in both: the bundled commands are found beside
`ken`'s entry with its own extension, and a dependency's entry is its manifest's `bin`.

Pack and publish with pnpm, never npm: the packages depend on each other as `workspace:*`,
which only pnpm replaces with the version. `sh scripts/check-packed.sh` packs the five,
installs the tarballs into a temp folder and runs `ken version`, `ken init`, `ken status`,
`create-ken` and `ken lint` from there under Node and Bun: the check that what is published
runs, which nothing in a clone can show.

## The workflow

`.github/workflows/release.yml`, on a tag `v*`:

1. **Test** on Linux x86-64 and aarch64 and on macOS, under Node 24 and 26, with Bun:
   `pnpm typecheck`, `pnpm lint`, `pnpm test` and the packed check.
2. **Refuse**, before publishing anything, a tag that is not `vX.Y.Z`, not above every
   other version tag, not on `main`, or not annotated with notes:
   `check.sh vX.Y.Z`, the same check the agent makes before it makes the tag.
3. **Publish** the five at the tag's version, with provenance, `pnpm -r publish`. It can stop
   halfway; a rerun of the run publishes what is missing and passes over what npm has.
4. **Release** on GitHub, its notes the tag's message, `gh release create --notes-from-tag`.

On a push to a branch, or run by hand even on a tag, it does everything but steps 2 to 4,
and publishes with `--dry-run`: the dry run of a release.

It publishes with the repository's secret `NPM_TOKEN`, an npm token that may publish the
five. npm's trusted publishing is set per package once the package exists, so from the
second release on the token can give way to it.

## Making a release

An agent makes it, with the [release skill](../.agents/skills/release/SKILL.md): ask it to
release ken. It works with git against `origin` as fetched:

- It reads the last release's tag, the commit of `main` on GitHub, and what landed since,
  `git log --first-parent`, one line per merge with the files it changed; before the first
  release, everything.
- It writes the notes from that, proposes the version, and shows both to the owner. The
  owner may name another version. Without a yes the release ends; nothing was pushed.
- It runs `sh .agents/skills/release/check.sh vX.Y.Z COMMIT`, which refuses what the workflow
  would, then makes the tag at COMMIT, annotated with the notes, `git tag -a
  --cleanup=whitespace -F NOTES` (by default git drops the lines starting with `#`, the
  headings), and pushes that tag alone. The workflow does the rest; the agent watches the run
  and reports the release's URL.

## The notes

They are for someone who runs ken, not someone who reads its code, and they are public. Two
releases read alike:

```markdown
## What changed

### ken task

- `ken task list` shows what each task waits on.

### create-ken

- The template's AGENTS.md says where a skill goes.

## Upgrading

- `npm install -g @unclex/ken@X.Y.Z`.
- Run `npm create ken` in each root for the newer template: it adds what is missing and
  names each file that differs.
```

- **What changed** in what ken does, by command, a heading per command or package. Nothing
  for a change no user can see: a refactor, a test, CI.
- **Upgrading**: what to do beyond the install. A `ken.format` change, and what to run in a
  root; a newer template to take with `npm create ken`; a script of a root's `.bin/` that has
  to change. When there is nothing, the install line alone.
- Never a task file's name, path or words: tasks are private, the notes are not.

## Versions

Until 1.0.0, MINOR when a root or a script built on ken has to change: a new `ken.format`, a
command or an option that changed or went, a newer template. PATCH otherwise. The agent
proposes; the owner decides.

## What cannot be undone

npm never gives a version number back, even after an unpublish. So a tag is never moved,
deleted or made again, and a bad release is followed by the next PATCH. `check.sh` refuses a
version that exists at another commit, or that is not above the last.
