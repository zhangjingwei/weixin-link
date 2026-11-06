#!/bin/bash
# Download Weixin Link into a persistent directory, then run its installer.
set -euo pipefail
umask 077
case "$(uname -s):$(uname -m)" in
  Linux:aarch64|Linux:x86_64|Darwin:arm64|Darwin:x86_64) ;;
  *) echo 'Supported: Linux/macOS arm64/x64. Windows: use install.ps1.' >&2; exit 1 ;;
esac
for bootstrap_cmd in curl tar mktemp; do
  command -v "$bootstrap_cmd" >/dev/null 2>&1 || { echo "Missing prerequisite: $bootstrap_cmd" >&2; exit 1; }
done
bootstrap_ref="${WEIXIN_LINK_REF:-${ZERO_LINK_REF:-main}}"
bootstrap_dest="${WEIXIN_LINK_DIR:-${ZERO_LINK_DIR:-$HOME/.local/share/weixin-link/source}}"
# Existing installations stay in place; do not silently create a parallel source tree.
if [[ -z "${WEIXIN_LINK_DIR:-}" && -z "${ZERO_LINK_DIR:-}" && ( -e "$HOME/.local/share/zero-link/source" || -L "$HOME/.local/share/zero-link/source" ) ]]; then
  echo 'An earlier installation exists at ~/.local/share/zero-link/source; inspect it before installing again.' >&2
  exit 1
fi
if [[ -e "$bootstrap_dest" || -L "$bootstrap_dest" ]]; then
  echo "Installation directory already exists: $bootstrap_dest" >&2
  echo 'To reinstall, inspect the existing installation or choose another WEIXIN_LINK_DIR.' >&2
  exit 1
fi
mkdir -p "$(dirname -- "$bootstrap_dest")"
bootstrap_tmp=$(mktemp -d "$(dirname -- "$bootstrap_dest")/.weixin-link-download.XXXXXX")
trap 'rm -rf -- "$bootstrap_tmp"' EXIT
curl -fSL --proto '=https' --tlsv1.2 \
  "https://api.github.com/repos/zhangjingwei/weixin-link/tarball/$bootstrap_ref" -o "$bootstrap_tmp/source.tar.gz"
mkdir "$bootstrap_tmp/source"
tar -xzf "$bootstrap_tmp/source.tar.gz" -C "$bootstrap_tmp/source" --strip-components=1
[[ -f "$bootstrap_tmp/source/install.sh" && -f "$bootstrap_tmp/source/package.json" ]] || {
  echo 'Downloaded archive is missing installation files.' >&2; exit 1;
}
# Reserve destination without overwriting another installation.
mkdir "$bootstrap_dest"
cp -R "$bootstrap_tmp/source/." "$bootstrap_dest/"
cd "$bootstrap_dest"
/bin/sh ./install.sh
