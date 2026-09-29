#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
mkdir -p mac/bin
xcrun clang mac/choose-folder.m -o mac/bin/choose-folder -framework Cocoa -fobjc-arc -O2 -arch arm64 -arch x86_64 -mmacosx-version-min=12.0
codesign --force --sign - mac/bin/choose-folder
