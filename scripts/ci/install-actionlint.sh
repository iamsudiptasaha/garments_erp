#!/usr/bin/env bash
set -euo pipefail
version=1.7.12
case "$(uname -s)-$(uname -m)" in
  Linux-x86_64) platform=linux_amd64; checksum=8aca8db96f1b94770f1b0d72b6dddcb1ebb8123cb3712530b08cc387b349a3d8 ;;
  Darwin-arm64) platform=darwin_arm64; checksum=aba9ced2dee8d27fecca3dc7feb1a7f9a52caefa1eb46f3271ea66b6e0e6953f ;;
  *) echo 'Unsupported workflow-linter platform'; exit 1 ;;
esac
folder=$(mktemp -d)
trap 'rm -rf "$folder"' EXIT
archive="$folder/actionlint.tar.gz"
curl --fail --silent --show-error --location "https://github.com/rhysd/actionlint/releases/download/v${version}/actionlint_${version}_${platform}.tar.gz" --output "$archive"
actual=$(shasum -a 256 "$archive" | cut -d' ' -f1)
test "$actual" = "$checksum" || { echo 'Actionlint checksum mismatch'; exit 1; }
mkdir -p .ci-tools
tar -xzf "$archive" -C .ci-tools actionlint
