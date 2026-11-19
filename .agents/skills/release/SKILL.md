---
name: release
description: Release ken - the notes and version approved by the owner, then a tag vX.Y.Z pushed, which the workflow publishes to npm.
disable-model-invocation: true
---

# Release ken

[Releasing ken](../../../docs/releasing.md) says what a release is, the shape of its notes,
and what cannot be undone; read it first. `release.sh`, beside this file, does the mechanical
parts against `origin` as fetched now, so the branch you are on never matters. Yours are the
parts that need judgment: the notes, the version, the owner's answer, a red run.

1. **Base.** `gh run list --workflow release.yml --branch main --limit 1`. A failed run on
   `main` goes to the owner before anything else.
2. **Input.** `sh .agents/skills/release/release.sh notes` prints the last release, the
   COMMIT of `main` to release, and each merge since with the files it changed. Read a
   merge's diff, `git show --first-parent <hash>`, when its line does not say what a user
   sees.
3. **Notes.** Write them to a file, in the shape `docs/releasing.md` gives: what changed in
   what ken does, by command, and what to do when upgrading. Nothing a user cannot see, and
   never a task file's name or words: the notes are public.
4. **Version.** Propose one from the notes: under 1.0, MINOR when a root or a script has to
   change, PATCH otherwise. The owner may name another.
5. **Approval.** Show the owner the notes and the version. Without a yes the release ends,
   and nothing was pushed.
6. **Publish.** `sh .agents/skills/release/release.sh publish vX.Y.Z NOTES COMMIT`. Then
   watch the run it names with `gh run watch <run> --exit-status`. Done when the run is green
   and `gh release view vX.Y.Z --json url` gives the release: report that URL. Red: report the
   failed step and the run's URL. A publish that stopped halfway is finished by
   `gh run rerun <run> --failed`, never by a new tag.

When `release.sh` refuses, report what it said: nothing was pushed. Never make, move or
delete a tag by hand: npm takes each version once.
