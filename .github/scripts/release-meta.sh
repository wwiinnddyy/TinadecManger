#!/usr/bin/env bash
# Resolve the release version and tag, and refuse a tag that does not match
# package.json. Runs on every release job so the number embedded in the app,
# the tag, and the asset names cannot drift apart.
set -euo pipefail

version="$(node -p "require('./package.json').version")"

case "${GITHUB_REF:-}" in
	refs/tags/v*)
		tag="${GITHUB_REF#refs/tags/}"
		tag_version="${GITHUB_REF#refs/tags/v}"
		if [ "$tag_version" != "$version" ]; then
			echo "::error::tag '$tag' does not match package.json version '$version'. Bump package.json, then tag."
			exit 1
		fi
		is_tag=true
		;;
	*)
		tag="v$version-manual"
		is_tag=false
		;;
esac

printf 'version=%s\n' "$version" >>"$GITHUB_OUTPUT"
printf 'tag=%s\n' "$tag" >>"$GITHUB_OUTPUT"
printf 'is_tag=%s\n' "$is_tag" >>"$GITHUB_OUTPUT"
echo "version=$version tag=$tag is_tag=$is_tag"
