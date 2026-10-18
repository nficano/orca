#!/bin/sh
# Rasterizes the tray template icons (18×18 and @2x) from resources/*.svg.
# Needs rsvg-convert (brew install librsvg).
set -eu
cd "$(dirname "$0")/../resources"
for name in trayTemplate trayActiveTemplate; do
  rsvg-convert -w 18 -h 18 "$name.svg" -o "$name.png"
  rsvg-convert -w 36 -h 36 "$name.svg" -o "$name@2x.png"
done
