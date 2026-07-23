#!/usr/bin/env bash
# Dogfood #3: put a known photo on the emulator's virtual-scene wall so the
# REAL camera pipeline (capture -> downscale -> recognize) runs against
# ground-truth images for free. Restart the emulator after swapping.
#
#   ./scripts/devtest/inject-camera-image.sh assets/demo/bin-handtools.jpg
#   ./scripts/devtest/inject-camera-image.sh --restore
set -euo pipefail

RES="${ANDROID_SDK_ROOT:-$HOME/Library/Android/sdk}/emulator/resources"
POSTER="$RES/poster.png"
BACKUP="$RES/poster.png.original"

if [[ "${1:-}" == "--restore" ]]; then
  if [[ -f "$BACKUP" ]]; then
    mv "$BACKUP" "$POSTER"
    echo "restored original virtual-scene poster"
  else
    echo "no backup found — nothing to restore"
  fi
  exit 0
fi

IMG="${1:?usage: inject-camera-image.sh <image.jpg|png> | --restore}"
[[ -f "$IMG" ]] || { echo "no such file: $IMG"; exit 1; }
[[ -f "$BACKUP" ]] || cp "$POSTER" "$BACKUP"

# The wall poster must be PNG; sips ships with macOS.
sips -s format png "$IMG" --out "$POSTER" >/dev/null
echo "wall poster replaced with $IMG"
echo "restart the emulator, open the app camera, and aim at the wall"
