#!/bin/bash
# 重新 vendor 公共模块：把 fortune-common/uni-config-center 复制进每个云对象。
# 目的：让云对象自包含，避免 HBuilderX CLI 上传时缺少公共模块。
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT=uniCloud-aliyun/cloudfunctions

vendor() {
  obj="$1"; shift
  dest="$ROOT/$obj/common"
  mkdir -p "$dest"
  for mod in "$@"; do
    rm -rf "$dest/$mod"
    cp -R "$ROOT/common/$mod" "$dest/$mod"
  done
  # vendor 副本内 auth-common 改用相对路径引用 uni-config-center
  sed -i '' "s|require('uni-config-center')|require('./uni-config-center')|" "$dest/lucky-auth-common/index.js"
}

for obj in lucky-id lucky-journey lucky-data lucky-reminder lucky-family lucky-analytics; do
  vendor "$obj" lucky-auth-common uni-config-center
done
for obj in lucky-baby lucky-care lucky-record lucky-seed; do
  vendor "$obj" lucky-auth-common lucky-templates uni-config-center
done

echo "公共模块已 vendor 进 10 个云对象"
