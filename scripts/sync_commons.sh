#!/bin/bash
# 将公共模块 vendor 进各云对象目录，使云对象自包含。
# 背景：HBuilderX CLI 上传云函数不解析 package.json 的 file: 依赖（GUI 专属行为），
# 云端运行时找不到 ../common/*（MODULE_NOT_FOUND）。同步后各对象以 require('./common/...')
# 引用，随对象自身代码一并上传。测试与部署前请先运行本脚本。
set -euo pipefail
cd "$(dirname "$0")/.."
CLOUD_DIR=uniCloud-alipay
[ -d "$CLOUD_DIR" ] || CLOUD_DIR=uniCloud-aliyun
ROOT="$CLOUD_DIR/cloudfunctions"

sync_one() {
  obj="$1"; shift
  dest="$ROOT/$obj/common"
  rm -rf "$dest"
  mkdir -p "$dest"
  for mod in "$@"; do
    cp -R "$ROOT/common/$mod" "$dest/$mod"
  done
  # vendor 副本内的 auth-common 改用相对路径引用 uni-config-center（canonical 保持裸模块名，供本地测试无密钥回退）
  sed -i '' "s|require('uni-config-center')|require('./uni-config-center')|" "$dest/lucky-auth-common/index.js"
}

for obj in lucky-id lucky-journey lucky-data lucky-reminder lucky-family lucky-analytics; do
  sync_one "$obj" lucky-auth-common uni-config-center
done
for obj in lucky-baby lucky-care lucky-record lucky-seed; do
  sync_one "$obj" lucky-auth-common lucky-templates uni-config-center
done
echo "公共模块已 vendor 进 10 个云对象（含 uni-config-center 密钥配置，注意该目录不入 git）"
