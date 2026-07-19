#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REPO_ROOT="$(cd "$ROOT/.." && pwd)"
DEST="$ROOT/frontend/public/assets"
KERNEL="$REPO_ROOT/zig-out/bin/kernel"
DISK="$REPO_ROOT/disk.img"
GRANITE2_ROOT="$(cd "$REPO_ROOT/../GraniteOS-2" && pwd)"
GRANITE2_DEST="$DEST/gos2"
GRANITE2_KERNEL="$GRANITE2_ROOT/zig-out/bin/granite-kernel.bin"
GRANITE2_BUNDLE="$GRANITE2_ROOT/zig-out/bin/bundle.img"
GRANITE2_DISK="$GRANITE2_ROOT/disk.img"

if [[ ! -f "$KERNEL" ]]; then

  echo "error: kernel not found at $KERNEL - run 'zig build' first" >&2
  exit 1

fi

if [[ ! -f "$DISK" ]]; then

  echo "error: disk.img not found at $DISK" >&2
  exit 1

fi

for path in "$GRANITE2_KERNEL" "$GRANITE2_BUNDLE" "$GRANITE2_DISK"; do

  if [[ ! -f "$path" ]]; then

    echo "error: GraniteOS 2 asset not found at $path" >&2
    exit 1

  fi

done

mkdir -p "$DEST" "$GRANITE2_DEST"

cp -f "$KERNEL" "$DEST/kernel"
cp -f "$DISK"   "$DEST/disk.img"
cp -f "$GRANITE2_KERNEL" "$GRANITE2_DEST/granite-kernel.bin"
cp -f "$GRANITE2_BUNDLE" "$GRANITE2_DEST/bundle.img"
cp -f "$GRANITE2_DISK" "$GRANITE2_DEST/disk.img"

echo "Assets copied to $DEST"
