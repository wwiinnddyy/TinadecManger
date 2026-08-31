#!/usr/bin/env bash
# Check that `bun run build` emitted a renderer bundle whose every referenced
# asset actually exists on disk.
#
# Electrobun treats a missing `build.copy` source as a console.error and keeps
# going, so a broken renderer build would otherwise ship an empty window and a
# green CI run.
set -euo pipefail

html="dist/index.html"

if [ ! -s "$html" ]; then
	echo "::error::$html is missing or empty. A missing copy source is only a warning to the Electrobun CLI."
	exit 1
fi

refs="$(grep -oE '(src|href)="\.\/[^"]+"' "$html" | sed -E 's/.*="\.\/(.*)"/\1/' | sort -u)"

if [ -z "$refs" ]; then
	echo "::error::$html references no local assets — the Vite build did not emit a bundle."
	exit 1
fi

for ref in $refs; do
	if [ ! -s "dist/$ref" ]; then
		echo "::error::$html loads ./dist/$ref, which is missing or empty."
		exit 1
	fi
	echo "ok dist/$ref"
done
