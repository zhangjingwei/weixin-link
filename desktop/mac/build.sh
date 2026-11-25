#!/bin/bash
set -eu
cd "$(dirname "$0")"
app="${1:-$PWD/build/Weixin Link.app}"
mkdir -p "$app/Contents/MacOS"
arch=$(uname -m)
xcrun swiftc -parse-as-library -O -target "$arch-apple-macos13.0" Companion.swift FirstSetup.swift ConversationView.swift AttachmentPreview.swift ReplyBlocks.swift -o "$app/Contents/MacOS/WeixinLink"
cp Info.plist "$app/Contents/Info.plist"
mkdir -p "$app/Contents/Resources"
cp first-install.sh setup-bridge.mjs "$app/Contents/Resources/"
git -C ../.. archive --format=tar.gz -o "$app/Contents/Resources/service.tar.gz" HEAD -- . ':!desktop' ':!tests'
codesign --force --sign - "$app"
echo "$app"
