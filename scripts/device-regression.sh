#!/bin/bash
# 真机回归一键脚本（docs/DEV-PROGRESS「上线前最后一轮验证」配套）
# 用法：Android 手机开启 USB 调试并连接后，运行 bash scripts/device-regression.sh
# 自动完成：安装调试基座 → 启动 App → 采集通知/日志证据 → 关键页面截图
# 其中 ①经期/产检提醒的锁屏弹达 ②试纸拍照选图 ③暗色开关切换 仍需在手机上手动点按；
# 脚本会在各阶段暂停等待（回车继续），并自动留存证据到 .screenshots/device-regression/
set -euo pipefail
cd "$(dirname "$0")/.."

ADB="/Applications/HBuilderX.app/Contents/HBuilderX/plugins/launcher-tools/tools/adbs/adb"
APK="unpackage/debug/android_debug_vapor.apk"
OUT=".screenshots/device-regression"
PKG="com.luckybump.app"
mkdir -p "$OUT"

echo "== 1/6 设备检测 =="
if [ -z "$($ADB devices | grep -w device || true)" ]; then
  echo "❌ 未检测到设备：请插上手机并在手机上允许 USB 调试，然后重跑本脚本。"
  echo "   （无线调试可用：$ADB connect <手机IP:端口> 后重跑）"
  exit 1
fi
$ADB devices -l | grep -w device

echo "== 2/6 安装调试基座 =="
$ADB install -r "$APK"
echo "✅ APK 安装完成：$APK"

echo "== 3/6 启动 App =="
$ADB shell monkey -p "$PKG" -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1 || \
  $ADB shell am start -n "$PKG/UniAppXActivity" 2>/dev/null || true
sleep 6
$ADB exec-out screencap -p > "$OUT/01-launch.png"
echo "✅ 已启动并截图 01-launch.png（请目视：登录页/首页是否正常渲染）"

echo "== 4/6 手动回归段（在手机上按 DEV-PROGRESS 清单操作）=="
read -r -p "  依次完成：登录/注册 → 首页渲染 → 喂养页直输保存 → 曲线页 → 时间线故事流 → 设置页切暗色。完成后回车..."
$ADB exec-out screencap -p > "$OUT/02-dark-or-page.png"
read -r -p "  记录页：拍一张排卵试纸照片并保存。完成后回车..."
$ADB exec-out screencap -p > "$OUT/03-photo.png"
read -r -p "  经期页：设置一条 1-2 分钟后的经期提醒，然后锁屏等待通知弹出。完成后回车..."
$ADB exec-out screencap -p > "$OUT/04-notification.png"

echo "== 5/6 通知证据（系统层核验，不依赖目视）=="
$ADB shell dumpsys notification --noredact 2>/dev/null | grep -iE "luckybump|幸孕记" | head -5 > "$OUT/notifications.txt" || true
[ -s "$OUT/notifications.txt" ] && echo "✅ 已捕获系统通知记录（notifications.txt）" || echo "⚠️ 未捕获通知记录，请确认步骤 4 的提醒是否到点弹出"

echo "== 6/6 运行日志快照 =="
$ADB logcat -d 2>/dev/null | grep -iE "createPushMessage|clearPushMessage|UniAppX.*(error|exception)" | tail -20 > "$OUT/logcat.txt" || true
echo "✅ 证据目录：$OUT/（01-04 截图 + notifications.txt + logcat.txt）"
echo "回归完成后请把结果反馈到会话，由助手更新 DEV-PROGRESS 勾选项。"
