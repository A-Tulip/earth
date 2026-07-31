#!/usr/bin/env bash
# 下载太阳系真实纹理（Solar System Scope, CC BY 4.0）
# 数据源：https://www.solarsystemscope.com/textures/
# 用途：替换程序化纹理，提升太阳系视图真实感
# 许可：CC BY 4.0 International（可商用、可修改、可分发，需署名）

set -e

TARGET_DIR="$(dirname "$0")/../public/textures/planets"
mkdir -p "$TARGET_DIR"
cd "$TARGET_DIR"

BASE="https://www.solarsystemscope.com/textures/download"

FILES=(
  "2k_sun.jpg"
  "2k_mercury.jpg"
  "2k_venus_surface.jpg"
  "2k_earth_daymap.jpg"
  "2k_mars.jpg"
  "2k_jupiter.jpg"
  "2k_saturn.jpg"
  "2k_uranus.jpg"
  "2k_neptune.jpg"
  "2k_saturn_ring_alpha.png"
  "2k_stars.jpg"
  "2k_moon.jpg"
)

echo "下载太阳系纹理到 $TARGET_DIR ..."
for f in "${FILES[@]}"; do
  if [ -f "$f" ]; then
    echo "  [跳过] $f 已存在"
  else
    echo "  [下载] $f"
    curl -sL -o "$f" "$BASE/$f"
  fi
done

echo "完成。纹理许可证：CC BY 4.0（https://creativecommons.org/licenses/by/4.0/）"
echo "署名：Solar System Scope（https://www.solarsystemscope.com/textures/）"
