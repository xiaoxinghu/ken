#!/bin/sh
# The check that the published thing runs: the five packages packed as `pnpm publish` packs them,
# the tarballs installed into a temp folder, their other dependencies from npm, and ken and
# create-ken run from there under Node and, when it is on PATH, Bun. It catches what the clone
# never shows, such as Node refusing to strip types under node_modules. Run from the
# repository's top: sh scripts/check-packed.sh
set -eu

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

pnpm --filter './packages/*' -r pack --pack-destination "$tmp/tarballs" >/dev/null
for tarball in "$tmp"/tarballs/*.tgz; do
	if tar -xzOf "$tarball" package/package.json | grep -q '"workspace:'; then
		echo "check-packed: $(basename "$tarball") still says workspace: in its package.json: pack with pnpm, which replaces it with the version, never npm." >&2
		exit 1
	fi
done

mkdir "$tmp/install"
npm install --prefix "$tmp/install" --no-audit --no-fund --loglevel=error "$tmp"/tarballs/*.tgz
bin=$tmp/install/node_modules/.bin

runtimes=node
if command -v bun >/dev/null; then runtimes='node bun'; else echo 'check-packed: bun is not on PATH, so only Node is checked.'; fi
for runtime in $runtimes; do
	echo "== $runtime"
	# the installed ken first on PATH, as `npm install -g` puts it, over any linked one
	PATH=$bin:$PATH "$runtime" "$bin/ken" version
	PATH=$bin:$PATH "$runtime" "$bin/ken" init "$tmp/$runtime-init"
	(cd "$tmp/$runtime-init" && PATH=$bin:$PATH "$runtime" "$bin/ken" status)
	PATH=$bin:$PATH "$runtime" "$bin/create-ken" "$tmp/$runtime-create"
	(cd "$tmp/$runtime-create" && PATH=$bin:$PATH "$runtime" "$bin/ken" lint)
done
echo 'check-packed: the packed packages install and run.'
