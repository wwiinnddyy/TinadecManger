#!/usr/bin/env bash
# Assert an unpacked Electrobun payload is actually complete.
#
# Every failure mode here is one the CLI reports only as a warning, or not at
# all: a missing `build.copy` source, an unmatched `views://` mapping, or a
# native runtime file that was never copied.
#
# usage: assert-payload.sh <unpacked-dir> <app-name>
set -euo pipefail

unpacked="$1"
app="$2"

bundle="$unpacked/$app"
view_root="$bundle/Resources/app/views/mainview"

if [ ! -d "$bundle" ]; then
	echo "::error::expected the archive to contain a top-level '$app' directory; found: $(ls "$unpacked")"
	exit 1
fi

# A blank window is the failure this exists to catch: the CLI only warns when a
# build.copy source is absent.
if [ ! -s "$view_root/index.html" ]; then
	echo "::error::$view_root/index.html is missing — the packaged window would load a blank page."
	exit 1
fi
echo "ok $view_root/index.html"

if [ -z "$(find "$view_root/assets" -type f -size +1c 2>/dev/null)" ]; then
	echo "::error::$view_root/assets has no non-empty files — dist/ did not survive the copy."
	exit 1
fi
echo "ok $(find "$view_root/assets" -type f | wc -l) asset files"

# The launcher dlopens the native wrapper from its own directory and loads the
# app code as a Worker from ../Resources, so these must be siblings.
if [ ! -e "$bundle/bin/launcher" ] && [ ! -e "$bundle/bin/launcher.exe" ]; then
	echo "::error::$bundle/bin/launcher is missing."
	exit 1
fi
for required in Resources/version.json Resources/build.json; do
	if [ ! -e "$bundle/$required" ]; then
		echo "::error::$app/$required is missing from the payload."
		exit 1
	fi
done
if ! grep -q '"channel"' "$bundle/Resources/version.json"; then
	echo "::error::version.json has no channel field."
	exit 1
fi
echo "ok launcher, version.json, build.json"
