/**
 * 发布配置回归网：安装包图标/启动图、iOS 隐私清单、权限说明、通知权限申请、发布自检入口。
 */
const test = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '../..')
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf-8')

test('安装包图标与启动图文件存在且在 manifest 中登记', () => {
  const m = JSON.parse(read('manifest.json'))
  const android = m['app-android'].distribute
  for (const p of Object.values(android.icons)) {
    assert.ok(fs.existsSync(path.join(ROOT, p)), `缺少 Android 图标 ${p}`)
  }
  for (const p of Object.values(android.splashScreens.default)) {
    assert.ok(fs.existsSync(path.join(ROOT, p)), `缺少启动图 ${p}`)
  }
  for (const p of Object.values(android.splashScreens.icon)) {
    assert.ok(fs.existsSync(path.join(ROOT, p)), `缺少 Android12 Logo ${p}`)
  }
  const ios = m['app-ios'].distribute.icons.appstore
  assert.ok(fs.existsSync(path.join(ROOT, ios)), `缺少 iOS 图标 ${ios}`)
})

test('iOS 隐私清单与相册/相机用途说明齐备', () => {
  assert.ok(fs.existsSync(path.join(ROOT, 'nativeResources/ios/PrivacyInfo.xcprivacy')), '缺少 iOS 隐私清单')
  const plist = read('nativeResources/ios/PrivacyInfo.xcprivacy')
  assert.ok(plist.includes('NSPrivacyCollectedDataTypeHealth'), '隐私清单需声明健康数据')
  assert.ok(plist.includes('NSPrivacyTracking'), '隐私清单需声明是否跟踪')
  const m = JSON.parse(read('manifest.json'))
  const pd = m['app-ios'].distribute.privacyDescription
  assert.ok(pd.NSPhotoLibraryUsageDescription && pd.NSCameraUsageDescription, '缺少相册/相机用途说明')
})

test('Android 通知与相机权限已声明，通知权限有运行时申请', () => {
  const m = JSON.parse(read('manifest.json'))
  const perms = m['app-android'].permissions
  for (const p of ['android.permission.POST_NOTIFICATIONS', 'android.permission.CAMERA']) {
    assert.ok(perms.includes(p), `缺少 Android 权限 ${p}`)
  }
  const notify = read('utils/notify.uts')
  assert.ok(notify.includes('requestSystemPermission'), '通知权限需运行时主动申请（HBuilderX 5.25+ 不再自动申请）')
  assert.ok(notify.includes('POST_NOTIFICATIONS'), '通知权限申请需指定 POST_NOTIFICATIONS')
})

test('发布自检脚本存在并登记为 npm 命令', () => {
  assert.ok(fs.existsSync(path.join(ROOT, 'scripts/preflight_release.sh')), '缺少发布自检脚本')
  const pkg = JSON.parse(read('package.json'))
  assert.equal(pkg.scripts['release:check'], 'bash scripts/preflight_release.sh')
})

test('模板标签行引号配对且属性未嵌套（防止 WEB 分支运行时解析错误）', () => {
  const fs = require('fs')
  const path = require('path')
  const root = path.resolve(__dirname, '../..')
  const walk = (dir, acc = []) => {
    for (const f of fs.readdirSync(dir)) {
      const full = path.join(dir, f)
      if (fs.statSync(full).isDirectory()) walk(full, acc)
      else if (f.endsWith('.uvue')) acc.push(full)
    }
    return acc
  }
  const offenders = []
  for (const file of [...walk(path.join(root, 'pages')), ...walk(path.join(root, 'components'))]) {
    const src = fs.readFileSync(file, 'utf-8')
    const m = /<template>([\s\S]*?)<\/template>/.exec(src)
    if (!m) continue
    m[1].split('\n').forEach((line, i) => {
      const t = line.trim()
      if (!t.startsWith('<')) return
      if ((line.match(/"/g) || []).length % 2 === 1) {
        offenders.push(`${path.relative(root, file)}:${i + 1} 引号未配对`)
      }
      if (/:[a-zA-Z-]+="[^"]*(hover-class|@click|@change)=/.test(line)) {
        offenders.push(`${path.relative(root, file)}:${i + 1} 属性嵌套损坏`)
      }
    })
  }
  assert.deepEqual(offenders, [], `模板属性损坏:\n${offenders.join('\n')}`)
})

test('Web 选择器使用页面内浮层，且页面无 pickDate 命名冲突', () => {
  const util = read('utils/pickDate.uts')
  assert.ok(util.includes('function webPick('), 'Web 端需使用页面内浮层（避免返回重建页面丢失表单状态）')
  assert.ok(util.includes("return webPick('date'"), 'pickDate 的 WEB 分支应调用 webPick')
  const fs2 = require('fs')
  const path2 = require('path')
  const root = path2.resolve(__dirname, '../..')
  const walk = (dir, acc = []) => {
    for (const f of fs2.readdirSync(dir)) {
      const full = path2.join(dir, f)
      if (fs2.statSync(full).isDirectory()) walk(full, acc)
      else if (f.endsWith('.uvue')) acc.push(full)
    }
    return acc
  }
  const offenders = []
  for (const file of walk(path2.join(root, 'pages'))) {
    const src = fs2.readFileSync(file, 'utf-8')
    if (!src.includes("from '../../utils/pickDate.uts'")) continue
    const importedPlain = /import\s*\{\s*pickDate\s*\}\s*from\s*'\.\.\/\.\.\/utils\/pickDate\.uts'/.test(src)
    if (importedPlain && /function\s+pickDate\s*\(/.test(src)) offenders.push(path2.relative(root, file))
  }
  assert.deepEqual(offenders, [], `以下页面同时导入并声明了 pickDate，导入会被遮蔽:\n${offenders.join('\n')}`)
})
