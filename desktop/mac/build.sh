#!/bin/bash
set -eu
cd "$(dirname "$0")"
app="${1:-$PWD/build/Weixin Link.app}"
mkdir -p "$app/Contents/MacOS"
arch=$(uname -m)
xcrun swiftc -parse-as-library -O -target "$arch-apple-macos13.0" Companion.swift ConversationView.swift AttachmentPreview.swift ReplyBlocks.swift -o "$app/Contents/MacOS/WeixinLink"
cp Info.plist "$app/Contents/Info.plist"
codesign --force --sign - "$app"
echo "$app"
