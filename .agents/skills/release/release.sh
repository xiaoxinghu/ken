#!/bin/sh
# The mechanical parts of a release of ken (docs/releasing.md), against `origin` as fetched now:
#   release.sh notes                       the last tag and what main gained since, to write notes from
#   release.sh check vX.Y.Z [COMMIT]       what the workflow refuses before it publishes anything
#   release.sh publish vX.Y.Z NOTES COMMIT the tag, annotated with NOTES, at COMMIT, pushed alone
# Every refusal says what is the case and what to run; nothing is pushed before `publish` has
# checked all of it.
set -eu

me="sh .agents/skills/release/release.sh"
refuse() {
	echo "release: $*" >&2
	exit 1
}
fetch() {
	git fetch -q --force origin '+refs/heads/main:refs/remotes/origin/main' '+refs/tags/*:refs/tags/*' ||
		refuse "could not fetch main and the tags from origin, $(git remote get-url origin 2>/dev/null || echo 'which is not set'): the release is read from GitHub, never from this checkout. Fix the remote or the network and run it again."
}
# The highest vX.Y.Z tag but $1, or nothing.
last() {
	git tag -l 'v*' | grep -E '^v[0-9]+\.[0-9]+\.[0-9]+$' | grep -vxF "${1:-}" |
		sed 's/^v//' | sort -t. -k1,1n -k2,2n -k3,3n | tail -1 | sed 's/^./v&/'
}

check() {
	tag=$1 commit=${2:-$1}
	echo "$tag" | grep -Eq '^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$' ||
		refuse "$tag is not a version tag vX.Y.Z, such as v0.1.0: the tag is the version npm publishes, so it is nothing else."
	before=$(last "$tag")
	if [ -n "$before" ]; then
		top=$(printf '%s\n%s\n' "${before#v}" "${tag#v}" | sort -t. -k1,1n -k2,2n -k3,3n | tail -1)
		[ "$top" = "${tag#v}" ] && [ "$before" != "$tag" ] ||
			refuse "$tag is not above $before, the last release: npm takes each version once and in order. Release the version after $before."
	fi
	git rev-parse -q --verify "$commit^{commit}" >/dev/null ||
		refuse "$commit names no commit here, after a fetch of origin: run \`$me notes\` and use the commit it prints."
	git merge-base --is-ancestor "$commit^{commit}" refs/remotes/origin/main ||
		refuse "$commit is not on main on GitHub: a release is of what landed. Land it on main, then run \`$me notes\` again."
	if git rev-parse -q --verify "refs/tags/$tag" >/dev/null; then
		[ "$(git cat-file -t "refs/tags/$tag")" = tag ] && [ -n "$(git tag -l --format='%(contents)' "$tag" | tr -d '[:space:]')" ] ||
			refuse "$tag is not annotated with notes: its message is the release's notes on GitHub. A tag is never moved or made again, so release the next PATCH with \`$me publish\`, which annotates it."
	fi
}

case ${1:-} in
notes)
	fetch
	tag=$(last)
	commit=$(git rev-parse refs/remotes/origin/main)
	if [ -n "$tag" ]; then
		echo "Last release: $tag. Its notes: git tag -l --format='%(contents)' $tag"
		range=$tag..$commit
	else
		echo "No release yet: everything on main is new."
		range=$commit
	fi
	echo "main on GitHub: $commit, the COMMIT to publish."
	echo "What landed since, first-parent, newest first, one line each with the files it changed:"
	git log --first-parent --format='%n%h %s' --name-only "$range" | sed '/^[0-9a-f]\{7,\} /!s/^./  &/'
	;;
check)
	[ $# -ge 2 ] || refuse "check takes vX.Y.Z and, unless the tag exists, the COMMIT: \`$me check v0.1.0 <commit>\`."
	fetch
	check "$2" "${3:-$2}"
	echo "release: $2 may be released."
	;;
publish)
	[ $# -eq 4 ] || refuse "publish takes vX.Y.Z, the notes' file and the COMMIT \`$me notes\` printed: \`$me publish v0.1.0 NOTES <commit>\`."
	tag=$2 notes=$3 commit=$4
	[ -n "$(tr -d '[:space:]' <"$notes" 2>/dev/null)" ] ||
		refuse "$notes is missing or empty: the notes are the tag's message and the GitHub release's. Write them first (docs/releasing.md)."
	fetch
	check "$tag" "$commit"
	! git rev-parse -q --verify "refs/tags/$tag" >/dev/null ||
		refuse "$tag exists already: npm never gives a version back, so a tag is never made again. Release the version after it."
	# --cleanup=whitespace: the default drops every line starting with #, the notes' headings
	git tag -a --cleanup=whitespace -F "$notes" "$tag" "$commit"
	git push -q origin "refs/tags/$tag" || {
		git tag -d "$tag" >/dev/null
		refuse "the push of $tag failed, so nothing was published and the tag is deleted here. Fix what git said, then run the same publish again."
	}
	echo "release: pushed $tag at $commit. The Release workflow publishes it: \`gh run list --workflow release.yml --branch $tag\`, then \`gh run watch <run> --exit-status\`; then \`gh release view $tag --json url\`."
	;;
*)
	refuse "run \`$me notes\`, \`$me check vX.Y.Z [COMMIT]\` or \`$me publish vX.Y.Z NOTES COMMIT\`; docs/releasing.md says what each is for."
	;;
esac
