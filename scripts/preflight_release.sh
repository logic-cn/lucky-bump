#!/bin/bash
# 发布前本地自检：不依赖云空间额度，可在任意机器执行。
# 用法：bash scripts/preflight_release.sh  （npm run release:check）
set -uo pipefail
cd "$(dirname "$0")/.."
fail=0
warn=0

ok()   { printf '  OK   %s\n' "$1"; }
bad()  { printf '  FAIL %s\n' "$1"; fail=$((fail+1)); }
note() { printf '  WARN %s\n' "$1"; warn=$((warn+1)); }

echo "[1/7] 测试"
if npm test >/tmp/lb-preflight-test.log 2>&1; then ok "npm test 全绿"; else bad "npm test 失败（见 /tmp/lb-preflight-test.log）"; fi

echo "[2/7] 安装包图标与启动图"
for f in static/app-icons/android-hdpi.png static/app-icons/android-xhdpi.png \
         static/app-icons/android-xxhdpi.png static/app-icons/android-xxxhdpi.png \
         static/app-icons/ios-appstore-1024.png static/splash/android-480x800.png \
         static/splash/android-720x1280.png static/splash/android-1080x1920.png; do
  [ -f "$f" ] && ok "$f" || bad "缺少 $f"
done

echo "[3/7] iOS 隐私清单"
if [ -f nativeResources/ios/PrivacyInfo.xcprivacy ] && plutil -lint nativeResources/ios/PrivacyInfo.xcprivacy >/dev/null 2>&1; then
  ok "PrivacyInfo.xcprivacy 格式正确"
else
  bad "iOS 隐私清单缺失或格式错误"
fi

echo "[4/7] 数据库索引文件"
idx=$(ls uniCloud-aliyun/database/*.index.json 2>/dev/null | wc -l | tr -d ' ')
[ "$idx" -ge 20 ] && ok "索引文件 $idx 个" || bad "索引文件过少（$idx）"

echo "[5/7] 云端配置模板"
for f in uniCloud-aliyun/cloudfunctions/common/uni-config-center/lucky-sms/config.json \
         uniCloud-aliyun/cloudfunctions/common/uni-config-center/lucky-ops/config.json; do
  [ -f "$f" ] && ok "$f 已配置" || note "$f 未创建（短信/看板将不可用）"
done

echo "[6/7] 用户可见文案"
if grep -q "上线前需法务复核" pages/me/agreement.uvue pages/me/privacy-policy.uvue 2>/dev/null; then
  bad "协议/隐私政策仍含草案标记"
else
  ok "协议/隐私政策无草案标记"
fi

echo "[7/7] 版本信息"
python3 - <<'PY' || bad "manifest 版本读取失败"
import json
d=json.load(open('manifest.json'))
print(f"  OK   versionName={d['versionName']} versionCode={d['versionCode']} appid={d['appid']}")
PY

echo
echo "结果：FAIL=$fail  WARN=$warn"
[ "$fail" -eq 0 ] || exit 1
