---
name: release
description: Release ken - the notes and version approved by the owner, then a tag vX.Y.Z pushed, which the workflow publishes to npm.
disable-model-invocation: true
---

# Release ken

[Releasing ken](../../../docs/releasing.md) says what a release is, the shape of its notes,
and what cannot be undone; read it first. You run git against `origin` as fetched, so the
branch you are on never matters; `check.sh`, beside this file, holds the refusals the workflow
makes too. Yours are the parts that need judgment: the notes, the version, the owner's answer,
a red run.

1. **Base.** `git fetch origin main --tags`, then
   `gh run list --workflow release.yml --branch main --limit 1`. A failed run on `main` goes
   to the owner before anything else.
2. **Input.** The last release, `git describe --tags --abbrev=0 --match 'v[0-9]*' origin/main`,
   none before the first; COMMIT, `git rev-parse origin/main`; and what landed since, one line
   per merge with the files it changed:
   `git log --first-parent --format='%n%h %s' --name-only LAST..origin/main`, or
   `origin/main` alone before the first release. Read a merge's diff,
   `git show --first-parent <hash>`, when its line does not say what a user sees.
3. **Notes.** Write them to a file, in the shape `docs/releasing.md` gives: what changed in
   what ken does, by command, and what to do when upgrading. Nothing a user cannot see, and
   never a task file's name or words: the notes are public.
4. **Version.** Propose one from the notes: under 1.0, MINOR when a root or a script has to
   change, PATCH otherwise. The owner may name another.
5. **Approval.** Show the owner the notes and the version. Without a yes the release ends,
   and nothing was pushed.
6. **Publish.** `sh .agents/skills/release/check.sh vX.Y.Z COMMIT`; when it passes,
   `git tag -a --cleanup=whitespace -F NOTES vX.Y.Z COMMIT` (without `--cleanup=whitespace`
   git drops every line starting with `#`, the headings) and `git push origin refs/tags/vX.Y.Z`,
   the tag alone. A push that fails published nothing: `git tag -d vX.Y.Z` and try again.
7. **Watch.** `gh run list --workflow release.yml --branch vX.Y.Z`, then
   `gh run watch <run> --exit-status`. Done when the run is green and
   `gh release view vX.Y.Z --json url` gives the release: report that URL. Red: report the
   failed step and the run's URL. A publish that stopped halfway is finished by
   `gh run rerun <run> --failed`, never by a new tag.

When `check.sh` refuses, report what it said, and push nothing. Never move or delete a tag
that was pushed: npm takes each version once.
