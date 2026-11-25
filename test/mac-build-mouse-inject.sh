#!/bin/sh
# Builds KccMouseInject.app from mac-mouse-inject.m, for mac-raw-input-test.js.
#
#   sh mac-build-mouse-inject.sh <dir>      (writes <dir>/KccMouseInject.app)
#
# The app is ad-hoc signed and background-only (LSBackgroundOnly: no Dock icon,
# never the active app). macOS keys the Accessibility permission to the code
# signature, so a rebuild needs the permission granted again: build it once,
# then grant it.
set -eu
here=$(cd "$(dirname "$0")" && pwd)
dir=${1:?usage: mac-build-mouse-inject.sh <dir>}
app=$dir/KccMouseInject.app
mkdir -p "$app/Contents/MacOS"
clang -fobjc-arc -O2 -Wall -Wextra -mmacosx-version-min=11.0 \
  -framework AppKit -framework ApplicationServices \
  -o "$app/Contents/MacOS/KccMouseInject" "$here/mac-mouse-inject.m"
cat > "$app/Contents/Info.plist" <<'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleIdentifier</key><string>local.kcc-test.mouse-inject</string>
  <key>CFBundleName</key><string>KccMouseInject</string>
  <key>CFBundleExecutable</key><string>KccMouseInject</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleVersion</key><string>1</string>
  <key>CFBundleShortVersionString</key><string>1.0</string>
  <key>LSBackgroundOnly</key><true/>
  <key>LSMinimumSystemVersion</key><string>11.0</string>
</dict>
</plist>
EOF
codesign --force --sign - "$app"
codesign --verify --verbose=1 "$app"
echo "$app"
