#!/bin/sh
# check.sh vX.Y.Z [COMMIT]: whether vX.Y.Z may be released, against origin as fetched now: a
# version tag, above every other, at a commit on main (COMMIT, or the tag's when it exists), and,
# when the tag exists, annotated with notes. The workflow runs it before it publishes anything,
# the agent before it makes the tag (docs/releasing.md).
set -eu

me="sh .agents/skills/release/check.sh"
refuse() {
	echo "check: $*" >&2
	exit 1
}
[ $# -ge 1 ] || refuse "takes vX.Y.Z and, before the tag exists, the COMMIT: \`$me v0.1.0 <commit>\`."
tag=$1 commit=${2:-$1}
git fetch -q --force origin '+refs/heads/main:refs/remotes/origin/main' '+refs/tags/*:refs/tags/*' ||
	refuse "could not fetch main and the tags from origin: a release is checked against GitHub, never this checkout alone. Fix the remote or the network, then run it again."

echo "$tag" | grep -Eq '^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$' ||
	refuse "$tag is not a version tag vX.Y.Z, such as v0.1.0: the tag is the version npm publishes."
last=$(git tag -l 'v*' | grep -E '^v[0-9]+\.[0-9]+\.[0-9]+$' | grep -vxF "$tag" |
	sed 's/^v//' | sort -t. -k1,1n -k2,2n -k3,3n | tail -1)
if [ -n "$last" ]; then
	top=$(printf '%s\n%s\n' "$last" "${tag#v}" | sort -t. -k1,1n -k2,2n -k3,3n | tail -1)
	[ "$top" = "${tag#v}" ] && [ "$last" != "${tag#v}" ] ||
		refuse "$tag is not above v$last, the last release: npm takes each version once. Release a version after v$last."
fi
git rev-parse -q --verify "$commit^{commit}" >/dev/null ||
	refuse "$commit names no commit, after a fetch of origin: name the commit of main the notes were written for."
git merge-base --is-ancestor "$commit^{commit}" refs/remotes/origin/main ||
	refuse "$commit is not on main on GitHub: a release is of what landed. Land it, then release main."
if git rev-parse -q --verify "refs/tags/$tag" >/dev/null; then
	[ "$(git rev-parse "$tag^{commit}")" = "$(git rev-parse "$commit^{commit}")" ] ||
		refuse "$tag exists already, at $(git rev-parse --short "$tag^{commit}"): npm never gives a version back, so a tag is never made again. Release a version after it."
	[ "$(git cat-file -t "refs/tags/$tag")" = tag ] && [ -n "$(git tag -l --format='%(contents)' "$tag" | tr -d '[:space:]')" ] ||
		refuse "$tag is not annotated with notes, which are the GitHub release's. A tag is never moved or made again: release the next PATCH, its tag made with -a -F NOTES."
fi
echo "check: $tag may be released."
