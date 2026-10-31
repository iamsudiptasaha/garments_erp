#!/usr/bin/env bash
set -euo pipefail
version=8.30.1
case "$(uname -s)-$(uname -m)" in
  Linux-x86_64) platform=linux_x64; checksum=551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb ;;
  Darwin-arm64) platform=darwin_arm64; checksum=b40ab0ae55c505963e365f271a8d3846efbc170aa17f2607f13df610a9aeb6a5 ;;
  *) echo 'Unsupported secret-scanner platform'; exit 1 ;;
esac
folder=$(mktemp -d)
trap 'rm -rf "$folder"' EXIT
archive="$folder/gitleaks.tar.gz"
curl --connect-timeout 10 --max-time 60 --retry 2 --fail --silent --show-error --location "https://github.com/gitleaks/gitleaks/releases/download/v${version}/gitleaks_${version}_${platform}.tar.gz" --output "$archive"
actual=$(shasum -a 256 "$archive" | cut -d' ' -f1)
test "$actual" = "$checksum" || { echo 'Gitleaks checksum mismatch'; exit 1; }
mkdir -p .ci-tools
tar -xzf "$archive" -C .ci-tools gitleaks
