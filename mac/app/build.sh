#!/bin/zsh
set -eu
project="${0:A:h:h:h}"
output="$project/莱茵生命终端.app"
mkdir -p "$output/Contents/MacOS" "$output/Contents/Resources"
/usr/bin/xcrun clang "$project/mac/app/main.m" -o "$output/Contents/MacOS/RhineLab" -framework Cocoa -framework WebKit -fobjc-arc -O2 -target arm64-apple-macos14.0
/usr/bin/python3 - "$output" "$project" <<'PY'
import plistlib,sys,pathlib
p=pathlib.Path(sys.argv[1])
info=dict(CFBundleExecutable='RhineLab',CFBundleIdentifier='local.rhine-lab.terminal',CFBundleName='莱茵生命终端',CFBundleDisplayName='莱茵生命终端',CFBundlePackageType='APPL',CFBundleShortVersionString='1.0.0',CFBundleVersion='1',LSMinimumSystemVersion='14.0',NSHighResolutionCapable=True,CFBundleIconFile='AppIcon',NSPrincipalClass='NSApplication',RhineProjectPath=sys.argv[2],NSAppTransportSecurity={'NSAllowsLocalNetworking':True})
with (p/'Contents/Info.plist').open('wb') as f:plistlib.dump(info,f)
PY
iconset="$project/mac/app/AppIcon.iconset"
mkdir -p "$iconset"
for size in 16 32 128 256 512; do
 /usr/bin/sips -z "$size" "$size" "$project/RhineLabWallpaper/public/icons/icon-512.png" --out "$iconset/icon_${size}x${size}.png" >/dev/null
 if [[ "$size" -lt 512 ]]; then
  double=$((size*2))
  /usr/bin/sips -z "$double" "$double" "$project/RhineLabWallpaper/public/icons/icon-512.png" --out "$iconset/icon_${size}x${size}@2x.png" >/dev/null
 fi
done
/usr/bin/iconutil -c icns "$iconset" -o "$output/Contents/Resources/AppIcon.icns"
/usr/bin/codesign --force --sign - "$output"
/usr/bin/codesign --verify --strict "$output"
echo "$output"
