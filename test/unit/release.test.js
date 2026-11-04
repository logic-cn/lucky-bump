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

test('Web 页面可滚动、引导页返回可恢复状态、隐私页不重复要求同意', () => {
  const theme = read('theme.scss')
  assert.ok(theme.includes('overflow-y: auto'), 'Web 端 .page 需要 overflow-y: auto，否则长页面无法滚动')
  const onb = read('pages/onboarding/onboarding.uvue')
  assert.ok(onb.includes('lb_onboarding_state'), '引导页需持久化状态以应对 Web 返回重建页面')
  assert.ok(onb.includes('function restoreState') && onb.includes('restoreState()'), '引导页需恢复状态')
  assert.ok(onb.includes('function goPrivacy') && onb.includes('saveState()'), '跳转隐私政策前需保存引导状态')
  const privacy = read('pages/me/privacy.uvue')
  assert.ok(!privacy.includes('agreeConsent'), '隐私页不应再次要求同意（同意只在注册/首次引导一次）')
})

test('隐私同意只在注册时进行一次，引导页不再二次确认', () => {
  const reg = read('pages/account/register.uvue')
  assert.ok(reg.includes('PRIVACY_VERSION'), '注册页需使用统一的隐私条款版本号')
  assert.ok(reg.includes('recordConsent'), '注册成功后应立即落库同意记录')
  assert.ok(reg.includes('请先阅读并同意隐私政策'), '注册页需有显式同意门禁')
  assert.ok(reg.includes('consent-row'), '注册页需展示同意勾选')
  assert.ok(/\.consent-box[^}]*border-style:\s*solid/.test(reg), '勾选框需设置 border-style，否则 Web 端不可见')
  const onb = read('pages/onboarding/onboarding.uvue')
  assert.ok(!onb.includes('consent-row'), '引导页不应再展示同意勾选')
  assert.ok(!onb.includes('请先阅读并同意隐私政策'), '引导页不应再次拦截同意')
})

test('时间线按旅程阶段分章，指标显示中文', () => {
  const tl = read('pages/data/timeline.uvue')
  assert.ok(tl.includes("'water', '饮水'"), '饮水记录应显示中文，不能露出 water 原始码')
  assert.ok(tl.includes("journeyState.stage == 'T1'"), '孕期章节需判断阶段，不能只因存在末次月经就判定为孕期')
  assert.ok(!/const lmp = journeyState\.lmpDate[\s\S]{0,200}return \{ title: '孕期'/.test(tl), '备孕旅程不能误标孕期')
  assert.ok(tl.includes('DayGroup') && tl.includes('showChapter'), '时间线需按天分组，日期只出现一次')
})

test('分娩登记性别选择可点击且映射完整', () => {
  const br = read('pages/baby/birth-register.uvue')
  assert.ok(!br.includes('babies.value[i].sex'), 'v-for 项应直接赋值 b.sex，babies.value[i] 在模板中不存在')
  for (const n of ['0', '1', '2']) assert.ok(br.includes(`@click="b.sex = ${n}"`), `缺少性别选项 ${n}`)
  assert.ok(br.includes("['male', 'female', 'unknown'][b.sex]"), '性别需映射为 male/female/unknown')
})

test('家人可跳过建档用邀请码加入家庭', () => {
  const onb = read('pages/onboarding/onboarding.uvue')
  assert.ok(onb.includes('goJoinFamily'), '引导页需提供家人加入入口')
  assert.ok(onb.includes('lb_family_join_mode'), '家人加入模式需持久化')
  const fam = read('pages/me/family.uvue')
  assert.ok(fam.includes("getStorageSync('lb_family_join_mode')"), '家庭页需识别家人加入模式')
  assert.ok(fam.includes('cancelJoin'), '加入页需能返回建档')
})

test('提醒模板点击即创建，不是只填表单', () => {
  const st = read('pages/me/settings.uvue')
  assert.ok(/function applyMedTemplate[\s\S]{0,320}add\(\)/.test(st), '模板文案承诺一键创建，点击需直接落库')
})

test('家人视角快捷记录按角色收敛', () => {
  const idx = read('pages/index/index.uvue')
  assert.ok(idx.includes('isFamilyView.value'), '快捷记录需区分家人视角')
  assert.ok(idx.includes("journeyState.myRole == 'viewer'"), '只读成员不应出现写入口')
  assert.ok(idx.includes('v-if="quickItems.length > 0"'), '无可记录项时应隐藏快捷记录卡片')
})

test('Web 图表高度使用 px，不依赖内联 rpx', () => {
  const charts = read('pages/data/charts.uvue')
  assert.ok(charts.includes('barPx') && !charts.includes("barHeight(p.y) + 'rpx'"), '指标曲线柱高需转 px 后绑定')
  const growth = read('pages/baby/growth.uvue')
  assert.ok(growth.includes('kgBarPx') && !growth.includes("kgBar(s.kg) + 'rpx'"), '成长趋势柱高需转 px 后绑定')
})

test('列表页避免主按钮过载与单条目空卡', () => {
  const vac = read('pages/baby/vaccines.uvue')
  assert.ok(vac.includes('btn-record-due'), '疫苗页仅“该接种”使用主按钮，其余用弱按钮')
  const rec = read('pages/record/record.uvue')
  assert.ok(rec.includes('single-row'), '单条目分组应使用横向行卡片')
})
