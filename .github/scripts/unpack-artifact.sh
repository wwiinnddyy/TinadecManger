#!/usr/bin/env bash
# Unpack an Electrobun `<app>.tar.zst` payload into a directory.
#
# The archives are zstd frames, not gzip, so GNU `tar --zstd` needs a `zstd`
# binary on PATH. Prefer the `zig-zstd` that Electrobun already ships in
# node_modules/electrobun/dist-<os>-<arch>/ so the step works on a Windows
# runner that has no zstd package.
#
# usage: unpack-artifact.sh <archive> <dest> [zig-zstd-dir]
set -euo pipefail

archive="$1"
dest="$2"
zstd_dir="${3:-}"

if [ ! -s "$archive" ]; then
	echo "::error::archive $archive is missing or empty"
	exit 1
fi

tmp_tar="$(mktemp).tar"
trap 'rm -f "$tmp_tar"' EXIT

if [ -n "$zstd_dir" ] && [ -x "$zstd_dir/zig-zstd" ]; then
	"$zstd_dir/zig-zstd" decompress -i "$archive" -o "$tmp_tar"
elif [ -n "$zstd_dir" ] && [ -x "$zstd_dir/zig-zstd.exe" ]; then
	"$zstd_dir/zig-zstd.exe" decompress -i "$archive" -o "$tmp_tar"
elif command -v zstd >/dev/null 2>&1; then
	zstd -d -c "$archive" >"$tmp_tar"
else
	echo "::error::no zstd decoder found (looked for $zstd_dir/zig-zstd and PATH zstd)"
	exit 1
fi

mkdir -p "$dest"
tar -xf "$tmp_tar" -C "$dest"
echo "unpacked $archive into $dest"
