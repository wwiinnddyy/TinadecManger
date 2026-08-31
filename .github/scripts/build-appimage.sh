#!/usr/bin/env bash
# Turn Electrobun's Linux directory bundle into a real AppImage.
#
# Electrobun 1.16.0 removed AppImage support on purpose ("This replaces the
# AppImage-based installer to avoid libfuse2 dependency") and instead ships a
# directory bundle plus a self-extracting installer. The bundle is close to an
# AppDir already, but three things are wrong for AppImage: the launcher has to
# run with cwd=bin, the .desktop the CLI writes uses Exec=launcher, and the
# desktop/icon files have to sit at the AppDir root.
#
# usage: build-appimage.sh <electrobun-arch>   # x64 | arm64
# Required environment: VERSION, APPIMAGE_ARCH # x86_64 | aarch64
set -euo pipefail

: "${VERSION:?VERSION must be set}"
: "${APPIMAGE_ARCH:?APPIMAGE_ARCH must be set}"

arch="${1:-}"
if [ -z "$arch" ]; then
	echo "::error::usage: build-appimage.sh <x64|arm64>"
	exit 1
fi

APP="TinadecManger"
prefix="stable-linux-$arch"

archive="$(ls "in/$prefix-$APP"*.tar.zst | head -1)"
echo "unpacking $archive"

rm -rf AppDir unpacked out
mkdir -p unpacked out
# No zig-zstd directory: this job never installs electrobun, so the unpack
# helper falls back to the zstd binary from the runner image.
bash .github/scripts/unpack-artifact.sh "$archive" unpacked

if [ ! -d "unpacked/$APP" ]; then
	echo "::error::expected unpacked/$APP; found: $(ls unpacked)"
	exit 1
fi
mv "unpacked/$APP" AppDir

# bin/launcher resolves ../Resources relative to its own working directory, so
# it is only correct when started from inside bin/.
cat >AppDir/AppRun <<'RUN'
#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$(readlink -f "$0")")/bin"
exec ./launcher "$@"
RUN

# Replace the desktop entry the CLI writes, which points at a bare `launcher`.
rm -f "AppDir/$APP.desktop"
cat >"AppDir/$APP.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=Tinadec Manager
GenericName=Software manager
Comment=Tinadec 生态桌面软件管理器
Exec=$APP
Icon=$APP
Terminal=false
Categories=Utility;Application;
StartupWMClass=$APP
EOF

cp assets/logo-white.png "AppDir/$APP.png"

chmod +x AppDir/AppRun
for executable in launcher bun process_helper zig-zstd; do
	if [ -e "AppDir/bin/$executable" ]; then
		chmod +x "AppDir/bin/$executable"
	fi
done

# A bundle whose native runtime is not executable yields an AppImage that opens
# and immediately dies, so assert rather than assume.
if [ ! -x "AppDir/bin/launcher" ]; then
	echo "::error::AppDir/bin/launcher is not executable"
	exit 1
fi
if [ ! -e "AppDir/bin/libNativeWrapper.so" ]; then
	echo "::error::AppDir/bin/libNativeWrapper.so is missing from the bundle"
	exit 1
fi
if [ ! -e "AppDir/Resources/app/views/mainview/index.html" ]; then
	echo "::error::the AppDir has no packaged renderer"
	exit 1
fi

tool="appimagetool-$APPIMAGE_ARCH.AppImage"
if ! curl -fsSL --retry 3 -o "$tool" \
	"https://github.com/AppImage/appimagetool/releases/download/continuous/$tool"; then
	curl -fsSL --retry 3 -o "$tool" \
		"https://github.com/AppImage/appimagetool/releases/latest/download/$tool"
fi
chmod +x "$tool"

# GitHub runners have no FUSE, so appimagetool cannot mount its own runtime.
(
	cd out
	ARCH="$APPIMAGE_ARCH" "../$tool" --appimage-extract-and-run "../AppDir"
)

produced="$(find out -maxdepth 1 -name '*.AppImage' | head -1)"
if [ -z "$produced" ]; then
	echo "::error::appimagetool produced no AppImage"
	exit 1
fi

final="out/$APP-$VERSION-linux-$arch.AppImage"
mv "$produced" "$final"
chmod +x "$final"
test -s "$final"
ls -l "$final"
echo "built $final"
