/**
 * UI 设计系统一致性回归网（「温润玫瑰 · iOS 材质」v2，docs/07-UI设计系统.md）
 * 1. 旧版珊瑚色板全部颜色禁止残留（pages / components / pages.json / index.html / App.uvue）
 * 2. 旧几何禁用：width:700rpx、胶囊按钮旧圆角 44rpx
 * 3. 动效基线：每个页面必须内嵌 lb 动效标准块（进场/按压/脉冲），静态免责声明组件豁免
 * 4. 按压反馈：五个 tab 页必须存在 hover-class="lb-press"
 * 5. pages.json 与 uni.scss 令牌一致（导航/tabBar/页面底/主色）
 */
const test = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '../..')

/** 从 uni.scss 提取 $lb-xxx 编译期令牌值（大写 hex） */
function token(name) {
  const uniScss = fs.readFileSync(path.join(ROOT, 'uni.scss'), 'utf-8')
  const m = new RegExp(`\\$lb-${name}:\\s*(#[0-9A-Fa-f]{6})`).exec(uniScss)
  return m ? m[1].toUpperCase() : null
}

const OLD_COLORS = [
  '#FF7A6B', '#E85D4E', '#FFEFEA', '#6BA3FF', '#EAF2FF', '#4CAF7D', '#E8F5EE',
  '#F5A623', '#E5A023', '#FDF3E3', '#F7F6F4', '#1F2329', '#6B7280', '#A3AAB5',
  '#C9CDD4', '#EDEBE8', '#F2F1EF', '#E3E5E8', '#D8DCE1', '#F5F4F2', '#FAFAF8',
  '#FF9C90', '#F0B9B4', '#D8CFC4', '#3B72D8', '#A93A3E'
]

function walkUvue(dir, acc = []) {
  for (const f of fs.readdirSync(dir)) {
    const full = path.join(dir, f)
    if (fs.statSync(full).isDirectory()) walkUvue(full, acc)
    else if (f.endsWith('.uvue')) acc.push(full)
  }
  return acc
}

test('旧版色板零残留（重设计映射已完成）', () => {
  const targets = [...walkUvue(path.join(ROOT, 'pages')), ...walkUvue(path.join(ROOT, 'components')), path.join(ROOT, 'pages.json'), path.join(ROOT, 'index.html'), path.join(ROOT, 'App.uvue')]
  const offenders = []
  for (const file of targets) {
    const src = fs.readFileSync(file, 'utf-8').toUpperCase()
    for (const c of OLD_COLORS) {
      if (src.includes(c)) offenders.push(`${path.relative(ROOT, file)} 含旧色 ${c}`)
    }
  }
  assert.deepEqual(offenders, [], `以下文件仍使用旧版色板:\n${offenders.join('\n')}`)
})

test('旧几何禁用（700rpx 宽度 / 44rpx 按钮圆角）', () => {
  const offenders = []
  for (const file of [...walkUvue(path.join(ROOT, 'pages')), ...walkUvue(path.join(ROOT, 'components'))]) {
    const src = fs.readFileSync(file, 'utf-8')
    if (/width:\s*700rpx/.test(src)) offenders.push(`${path.relative(ROOT, file)}: width: 700rpx`)
    if (/border-radius:\s*44rpx/.test(src)) offenders.push(`${path.relative(ROOT, file)}: border-radius: 44rpx`)
  }
  assert.deepEqual(offenders, [], `以下文件仍使用旧几何:\n${offenders.join('\n')}`)
})

test('蒸汽模式：组件与页面一律组合式 script setup（选项式 script 编译失败）', () => {
  // 2026-10-31 云打包实测：vapor 模式下 <script> 选项式直接编译失败（lbc-redline/lbc-card/lbc-disclaimer）
  const offenders = []
  for (const file of [...walkUvue(path.join(ROOT, 'pages')), ...walkUvue(path.join(ROOT, 'components'))]) {
    const src = fs.readFileSync(file, 'utf-8')
    if (/<script>/.test(src)) offenders.push(path.relative(ROOT, file))
  }
  assert.deepEqual(offenders, [], `以下文件使用选项式 <script>，蒸汽模式编译失败:\n${offenders.join('\n')}`)
})

test('每个页面内嵌 lb 动效标准块（lbc-disclaimer 豁免）', () => {
  const missing = []
  for (const file of walkUvue(path.join(ROOT, 'pages'))) {
    const src = fs.readFileSync(file, 'utf-8')
    for (const token of ['@keyframes lb-rise', '@keyframes lb-pop', '@keyframes lb-fade', '@keyframes lb-pulse', '.lb-press']) {
      if (!src.includes(token)) missing.push(`${path.relative(ROOT, file)} 缺 ${token}`)
    }
  }
  const disclaimer = fs.readFileSync(path.join(ROOT, 'components/lbc-disclaimer/lbc-disclaimer.uvue'), 'utf-8')
  assert.ok(!missing.some(m => m.includes('lbc-disclaimer')))
  assert.deepEqual(missing, [], `以下页面缺少动效标准块:\n${missing.join('\n')}`)
})

test('可交互 tab 页均有按压反馈（hover-class lb-press）', () => {
  for (const p of ['pages/index/index.uvue', 'pages/record/record.uvue', 'pages/data/data.uvue', 'pages/me/me.uvue', 'pages/learn/learn.uvue']) {
    const src = fs.readFileSync(path.join(ROOT, p), 'utf-8')
    assert.ok(src.includes('hover-class="lb-press"'), `${p} 缺少按压反馈`)
  }
})

test('pages.json 与 uni.scss 设计令牌一致', () => {
  const pagesJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'pages.json'), 'utf-8'))
  assert.equal(pagesJson.globalStyle.navigationBarBackgroundColor.toUpperCase(), token('bg'), '导航栏底色须与 $lb-bg 一致')
  assert.equal(pagesJson.globalStyle.backgroundColor.toUpperCase(), token('bg'), '窗口底色须与 $lb-bg 一致')
  assert.equal(pagesJson.tabBar.color.toUpperCase(), token('text-3'), 'tabBar 未选中色须与 $lb-text-3 一致')
  assert.equal(pagesJson.tabBar.selectedColor.toUpperCase(), token('primary-deep'), 'tabBar 选中色须与 $lb-primary-deep 一致（文字对比度）')
  assert.equal(token('primary'), '#E4537F', 'v2 主色应为蔷薇玫瑰 #E4537F')
  for (const item of pagesJson.tabBar.list) {
    assert.ok(fs.existsSync(path.join(ROOT, item.iconPath)), `缺图标 ${item.iconPath}`)
    assert.ok(fs.existsSync(path.join(ROOT, item.selectedIconPath)), `缺图标 ${item.selectedIconPath}`)
  }
})

/* ---------------- 暗色模式令牌化（theme.scss + themeStore，安全计划 Task 13） ---------------- */

test('每个页面根节点绑定 themeClass 并引入 themeStore（暗色模式全覆盖）', () => {
  const missing = []
  for (const file of walkUvue(path.join(ROOT, 'pages'))) {
    const src = fs.readFileSync(file, 'utf-8')
    const tpl = src.match(/<template>[\s\S]*?<\/template>/)[0]
    if (!tpl.includes('<view class="page" :class="themeClass()">')) {
      missing.push(`${path.relative(ROOT, file)} 根节点缺 :class="themeClass()"`)
    }
    if (!/import\s*\{[^}]*themeClass[^}]*\}\s*from\s*'\.\.\/\.\.\/store\/themeStore\.uts'/.test(src)) {
      missing.push(`${path.relative(ROOT, file)} 未引入 themeStore 的 themeClass`)
    }
    if (!src.includes("@import '../../theme.scss';")) {
      missing.push(`${path.relative(ROOT, file)} style 未引入 theme.scss`)
    }
  }
  assert.deepEqual(missing, [], `暗色模式接入不完整:\n${missing.join('\n')}`)
})

test('theme.scss 双主题变量完整且 t-light 与 uni.scss 令牌一致', () => {
  const theme = fs.readFileSync(path.join(ROOT, 'theme.scss'), 'utf-8')
  const uniScss = fs.readFileSync(path.join(ROOT, 'uni.scss'), 'utf-8')
  const block = (name) => {
    const m = new RegExp(`\\.${name}\\s*\\{([\\s\\S]*?)\\n\\}`).exec(theme)
    assert.ok(m, `theme.scss 缺 .${name} 块`)
    return m[1]
  }
  const light = block('t-light')
  const dark = block('t-dark')
  const varsOf = (s) => new Set([...s.matchAll(/--lb-[\w-]+/g)].map(m => m[0]))
  const lv = varsOf(light), dv = varsOf(dark)
  const missingInDark = [...lv].filter(v => !dv.has(v))
  assert.deepEqual(missingInDark, [], `.t-dark 缺少变量: ${missingInDark.join(', ')}`)
  // t-light 必须与 uni.scss 编译期令牌同源（双事实源对齐）
  const PAIRS = [
    ['--lb-bg', 'bg'], ['--lb-card', 'card'], ['--lb-fill', 'fill'],
    ['--lb-text-1', 'text-1'], ['--lb-text-2', 'text-2'], ['--lb-text-3', 'text-3'],
    ['--lb-line', 'line'], ['--lb-arrow', 'arrow'],
    ['--lb-primary', 'primary'], ['--lb-primary-deep', 'primary-deep'], ['--lb-primary-soft', 'primary-soft'],
    ['--lb-primary-text', 'primary-text'], ['--lb-action', 'action'], ['--lb-secondary-action', 'secondary-action'],
    ['--lb-grad-1', 'grad-1'], ['--lb-grad-2', 'grad-2'],
    ['--lb-success-text', 'success-text'], ['--lb-warning-text', 'warning-text'], ['--lb-danger-text', 'danger-text'],
    ['--lb-secondary', 'secondary'], ['--lb-secondary-soft', 'secondary-soft'],
    ['--lb-success', 'success'], ['--lb-success-soft', 'success-soft'],
    ['--lb-warning', 'warning'], ['--lb-warning-soft', 'warning-soft'],
    ['--lb-danger', 'danger']
  ]
  for (const [cssVar, scssName] of PAIRS) {
    const m = new RegExp(`${cssVar}:\\s*(#[0-9A-Fa-f]{6})`).exec(light)
    assert.ok(m, `.t-light 缺 ${cssVar}`)
    assert.equal(m[1].toUpperCase(), token(scssName), `${cssVar} 应与 $lb-${scssName} 同源`)
  }
  // 主题存储存在且含三个关键导出
  const store = fs.readFileSync(path.join(ROOT, 'store/themeStore.uts'), 'utf-8')
  for (const fn of ['export function setThemeMode', 'export function initTheme', 'export function themeClass']) {
    assert.ok(store.includes(fn), `themeStore.uts 缺 ${fn}`)
  }
})

test('lbc 组件颜色全部走主题令牌（暗色下不残留浅色字面量）', () => {
  const offenders = []
  for (const file of walkUvue(path.join(ROOT, 'components'))) {
    const src = fs.readFileSync(file, 'utf-8')
    const hex = src.match(/#[0-9A-Fa-f]{6}/g) || []
    if (hex.length > 0) offenders.push(`${path.relative(ROOT, file)}: ${hex.join(', ')}`)
  }
  assert.deepEqual(offenders, [], `以下组件仍使用颜色字面量（应改用 var(--lb-*)）：\n${offenders.join('\n')}`)
})

test('按钮文字统一居中（theme.scss 集中登记）', () => {
  const theme = fs.readFileSync(ROOT + '/theme.scss', 'utf-8')
  const offenders = []
  for (const file of walkUvue(path.join(ROOT, 'pages'))) {
    const src = fs.readFileSync(file, 'utf-8')
    for (const tag of src.match(/<button[^>]*>/g) || []) {
      // 只取 button 自身的 class（不能误匹配 hover-class）
      const cm = /\sclass="([^"]*)"/.exec(tag)
      if (!cm) continue
      const base = cm[1].trim().split(/\s+/)[0]
      const re = new RegExp(`\\.${base}[^{]*\\{[^}]*text-align:\\s*center`)
      if (!re.test(theme)) offenders.push(`${path.relative(ROOT, file)}: ${base}`)
    }
  }
  assert.deepEqual(offenders, [], `以下按钮类未在 theme.scss 中显式居中（文字会贴左/被圆角裁切）：\n${offenders.join('\n')}`)
})

test('页面显示生命周期使用组合式 onPageShow（禁止选项式 onShow）', () => {
  const offenders = []
  for (const file of walkUvue(path.join(ROOT, 'pages'))) {
    const src = fs.readFileSync(file, 'utf-8')
    // 只匹配真正的调用/导入，忽略注释中的说明文字
    const lines = src.split('\n')
    lines.forEach((line, i) => {
      if (line.trim().startsWith('//')) return
      if (/import[^\n]*\bonShow\b/.test(line) || /\bonShow\s*\(/.test(line)) {
        offenders.push(`${path.relative(ROOT, file)}:${i + 1}`)
      }
    })
  }
  assert.deepEqual(offenders, [], `uni-app x 组合式页面应使用 onPageShow：\n${offenders.join('\n')}`)
})

/* ---------------- 加载失败可重试（禁止静默空态） ---------------- */

test('数据主视图加载失败必须显式可重试（禁止静默空态）', () => {
  // 这些页面的空态与"加载失败"在视觉上完全一致，静默 catch 会让用户误以为数据丢失
  const PAGES = [
    'pages/index/index.uvue',
    'pages/data/charts.uvue',
    'pages/data/timeline.uvue',
    'pages/care/schedule.uvue',
    'pages/me/family.uvue',
    'pages/baby/baby-home.uvue',
    'pages/baby/growth.uvue',
    'pages/baby/feeding.uvue',
    'pages/record/cycle.uvue'
  ]
  const offenders = []
  for (const p of PAGES) {
    const src = fs.readFileSync(path.join(ROOT, p), 'utf-8')
    if (!src.includes('<lbc-error')) offenders.push(`${p} 未使用 lbc-error 错误块`)
    if (!/Failed\.value\s*=\s*true/.test(src)) offenders.push(`${p} 未在 catch 中置失败标记`)
    if (!src.includes('@retry="load"')) offenders.push(`${p} 错误块未绑定重试`)
  }
  assert.deepEqual(offenders, [], `以下页面缺少可重试错误态:\n${offenders.join('\n')}`)

  const comp = fs.readFileSync(path.join(ROOT, 'components/lbc-error/lbc-error.uvue'), 'utf-8')
  assert.ok(comp.includes("defineEmits(['retry'])"), 'lbc-error 必须抛出 retry 事件（vapor 不支持选项式 methods）')
  assert.ok(comp.includes('var(--lb-'), 'lbc-error 颜色须走主题令牌')
})

test('记录宫格按最近使用排序（本地记忆，不上云）', () => {
  const util = fs.readFileSync(path.join(ROOT, 'utils/recentGrid.uts'), 'utf-8')
  assert.ok(util.includes("'lb_recent_grid'"), '缺少最近使用存储键')
  assert.ok(util.includes('rememberRecent'), '缺少打开记录时的记忆逻辑')
  const pages = ['pages/record/record.uvue', 'pages/index/index.uvue']
  for (const p of pages) {
    const src = fs.readFileSync(path.join(ROOT, p), 'utf-8')
    assert.ok(/orderByRecent\(/.test(src), `${p} 缺少最近使用排序`)
    assert.ok(/rememberRecent\(/.test(src), `${p} 未记忆点击`)
  }
})

test('低频指标支持补录日期（体重/血压/血糖）', () => {
  const pages = ['pages/record/weight.uvue', 'pages/record/blood-pressure.uvue', 'pages/record/blood-glucose.uvue']
  for (const p of pages) {
    const src = fs.readFileSync(path.join(ROOT, p), 'utf-8')
    assert.ok(src.includes('<lbc-date-field'), `${p} 缺少跨端日期选择（Web 端原生 picker 失效）`)
    assert.ok(src.includes('dateToTs('), `${p} 未把日期转为 ts 传给服务端`)
    assert.ok(src.includes('recordDate.value'), `${p} 未使用所选日期`)
  }
})

test('经期管理具备日历补记、经量与异常提示', () => {
  const src = fs.readFileSync(path.join(ROOT, 'pages/record/cycle.uvue'), 'utf-8')
  assert.ok(src.includes('cal-grid'), '缺少日历网格')
  assert.ok(src.includes('pickDate('), '日历不可点选补记')
  assert.ok(src.includes('date: selectedDate.value'), '补记未携带所选日期')
  assert.ok(src.includes("flow: flow.value"), '经期开始未记录经量')
  assert.ok(src.includes('abnormalTips'), '缺少周期异常提示')
  assert.ok(src.includes('不构成诊断'), '异常提示缺少免责说明')
  assert.ok(src.includes('deleteCycleEvent'), '缺少经期记录删除（纠错）')
  assert.ok(src.includes('askDelete'), '缺少删除确认入口')
  assert.ok(src.includes('pickedSymptoms'), '缺少经期伴随症状')
})

test('知识板块具备本周要点、搜索、收藏与工具速查', () => {
  const util = fs.readFileSync(path.join(ROOT, 'utils/knowledge.uts'), 'utf-8')
  assert.ok(util.includes('weeklyFocus'), '缺少本周要点')
  assert.ok(util.includes('searchTools'), '缺少工具速查')
  assert.ok(util.includes('stageArticles'), '缺少按阶段取内容')
  assert.ok(util.includes('source'), '条目缺少来源标注')
  const count = (util.match(/id: '/g) || []).length
  assert.ok(count >= 30, `知识条目偏少（${count}），至少 30 条`)

  const page = fs.readFileSync(path.join(ROOT, 'pages/learn/learn.uvue'), 'utf-8')
  assert.ok(page.includes('本周要点'), '页面缺少本周要点')
  assert.ok(page.includes('能不能吃'), '页面缺少工具速查')
  assert.ok(page.includes('lb_knowledge_favs'), '缺少收藏存储')
  assert.ok(page.includes('search-input'), '缺少搜索框')
})

test('工具页：待产包清单可勾选持久化，辅食计划含安全红线', () => {
  const bag = fs.readFileSync(path.join(ROOT, 'pages/tools/hospital-bag.uvue'), 'utf-8')
  assert.ok(bag.includes('lb_bag_checked'), '待产包缺少本地进度存储')
  assert.ok(bag.includes('progressPct'), '缺少完成进度')
  assert.ok(bag.includes('toggle('), '清单不可勾选')

  const food = fs.readFileSync(path.join(ROOT, 'pages/tools/solid-food.uvue'), 'utf-8')
  assert.ok(food.includes('1 岁前不加盐'), '辅食页缺少 1 岁前不加盐糖蜂蜜提示')
  assert.ok(food.includes('窒息风险'), '辅食页缺少窒息风险提示')
  assert.ok(food.includes('不提供诊断'), '缺少免责说明')

  const pagesJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'pages.json'), 'utf-8'))
  const paths = pagesJson.pages.map(p => p.path)
  assert.ok(paths.includes('pages/tools/hospital-bag'), 'pages.json 未注册待产包页')
  assert.ok(paths.includes('pages/tools/solid-food'), 'pages.json 未注册辅食计划页')
})

test('数据出口：打印/PDF 报告页已注册并提供打印入口', () => {
  const src = fs.readFileSync(path.join(ROOT, 'pages/data/export-report.uvue'), 'utf-8')
  assert.ok(src.includes('exportSummary'), '缺少摘要数据来源')
  assert.ok(src.includes('g.print()'), '缺少打印调用')
  assert.ok(src.includes('<lbc-error'), '加载失败不可重试')
  assert.ok(src.includes('buildCsv'), '缺少 CSV 生成')
  assert.ok(src.includes('csvCell'), 'CSV 未做转义')
  assert.ok(src.includes('.csv'), '缺少 CSV 下载文件名')
  const pagesJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'pages.json'), 'utf-8'))
  assert.ok(pagesJson.pages.some(p => p.path == 'pages/data/export-report'), 'pages.json 未注册打印报告页')
})

test('找回密码：恢复凭证入口与重置页连通', () => {
  const login = fs.readFileSync(path.join(ROOT, 'pages/account/login.uvue'), 'utf-8')
  assert.ok(login.includes('/pages/account/recover'), '登录页缺少忘记密码入口')
  const recover = fs.readFileSync(path.join(ROOT, 'pages/account/recover.uvue'), 'utf-8')
  assert.ok(recover.includes('resetPasswordByRecovery'), '重置页未调用恢复接口')
  const settings = fs.readFileSync(path.join(ROOT, 'pages/me/settings.uvue'), 'utf-8')
  assert.ok(settings.includes('createRecoveryCode'), '设置页缺少生成恢复凭证入口')
})

test('离线队列：四类低频写接入且复用 clientId', () => {
  const util = fs.readFileSync(path.join(ROOT, 'utils/offlineQueue.uts'), 'utf-8')
  assert.ok(util.includes('capabilities'), '缺少服务端能力探测（未部署时不得重放）')
  assert.ok(util.includes('clientId'), '缺少幂等标识')
  assert.ok(util.includes('flushOffline'), '缺少补写入口')
  for (const p of ['pages/record/weight.uvue', 'pages/record/blood-pressure.uvue', 'pages/record/blood-glucose.uvue', 'pages/record/diary.uvue']) {
    const src = fs.readFileSync(path.join(ROOT, p), 'utf-8')
    assert.ok(src.includes('enqueueRecord('), `${p} 未接入离线队列`)
    assert.ok(src.includes('clientId: cid'), `${p} 未携带 clientId`)
  }
  const home = fs.readFileSync(path.join(ROOT, 'pages/index/index.uvue'), 'utf-8')
  assert.ok(home.includes('flushOffline'), '首页未触发离线补写')
})

test('宝宝相册：路由与入口已接通', () => {
  const pagesJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'pages.json'), 'utf-8'))
  assert.ok(pagesJson.pages.some(p => p.path == 'pages/baby/album'), 'pages.json 未注册相册页')
  const home = fs.readFileSync(path.join(ROOT, 'pages/baby/baby-home.uvue'), 'utf-8')
  assert.ok(home.includes('/pages/baby/album'), '宝宝首页缺少相册入口')
  const record = fs.readFileSync(path.join(ROOT, 'pages/record/record.uvue'), 'utf-8')
  assert.ok(record.includes('/pages/baby/album'), '记录宫格缺少相册入口')
  const album = fs.readFileSync(path.join(ROOT, 'pages/baby/album.uvue'), 'utf-8')
  assert.ok(album.includes('uploadFile'), '相册未接上传')
  assert.ok(album.includes('removePhoto'), '相册未接删除')
})

test('系统触达（Web）：通知开关与每日待办推送', () => {
  const util = fs.readFileSync(path.join(ROOT, 'utils/webNotify.uts'), 'utf-8')
  assert.ok(util.includes('requestPermission'), '缺少通知授权')
  assert.ok(util.includes('lb_web_notify_date'), '缺少每日去重')
  const settings = fs.readFileSync(path.join(ROOT, 'pages/me/settings.uvue'), 'utf-8')
  assert.ok(settings.includes('onWebNotify'), '设置页缺少通知开关')
  const index = fs.readFileSync(path.join(ROOT, 'pages/index/index.uvue'), 'utf-8')
  assert.ok(index.includes('notifyToday'), '首页未触发待办通知')
  assert.ok(index.includes('isQuietNow'), '通知未遵守免打扰')
})

test('系统触达（App）：本地通知注册、去重与完成清除', () => {
  const util = fs.readFileSync(path.join(ROOT, 'utils/notify.uts'), 'utf-8')
  assert.ok(util.includes('createPushMessage'), '缺少 App 本地通知注册')
  assert.ok(util.includes('clearPushMessage'), '缺少完成后的通知清除')
  assert.ok(util.includes('lb_app_notify_day'), '缺少每日去重')
  assert.ok(util.includes('lb_app_notify_sig'), '缺少内容签名去重')
  assert.ok(util.includes('HORIZON_DAYS'), '缺少时间窗限制')
  const index = fs.readFileSync(path.join(ROOT, 'pages/index/index.uvue'), 'utf-8')
  assert.ok(index.includes('syncLocalNotifications'), '首页未同步本地通知')
  assert.ok(index.includes('cancelScheduledNotifications'), '完成待办后未清除系统通知')
})

test('提醒完成闭环：首页打勾回写', () => {
  const index = fs.readFileSync(path.join(ROOT, 'pages/index/index.uvue'), 'utf-8')
  assert.ok(index.includes('completeTodo'), '首页缺少完成回写')
  assert.ok(index.includes("luckyReminder('completeTodo'"), '未调用完成接口')
  assert.ok(index.includes('todo-check'), '缺少待办打勾入口')
  const server = fs.readFileSync(path.join(ROOT, 'uniCloud-aliyun/cloudfunctions/lucky-reminder/index.obj.js'), 'utf-8')
  assert.ok(server.includes('lb-reminder-done'), '服务端未记录完成状态')
  const settings = fs.readFileSync(path.join(ROOT, 'pages/me/settings.uvue'), 'utf-8')
  assert.ok(settings.includes('askRemoveRule'), '设置页缺少删除提醒入口')
  assert.ok(settings.includes("luckyReminder('removeRule'"), '未调用删除提醒接口')
})

test('生长曲线与经期提醒：页面能力已接入', () => {
  const growth = fs.readFileSync(path.join(ROOT, 'pages/baby/growth.uvue'), 'utf-8')
  assert.ok(growth.includes('chartRows'), '缺少体重趋势数据')
  assert.ok(growth.includes('kgBar'), '缺少趋势柱高计算')
  const cycle = fs.readFileSync(path.join(ROOT, 'pages/record/cycle.uvue'), 'utf-8')
  assert.ok(cycle.includes('setPeriodReminder'), '经期页缺少一键提醒')
  assert.ok(cycle.includes("luckyReminder('addRule'"), '未调用提醒创建接口')
  assert.ok(cycle.includes('recentCycleText'), '缺少最近周期长度明细')
  const babyHome = fs.readFileSync(path.join(ROOT, 'pages/baby/baby-home.uvue'), 'utf-8')
  assert.ok(babyHome.includes('feedingGuide'), '宝宝首页缺少月龄喂养参考')
  assert.ok(babyHome.includes('按需喂养'), '喂养参考缺少按需喂养提示')
})

test('差异化能力：故事流/家人视角/白带/试纸拍照/用药模板/承诺屏', () => {
  const timeline = fs.readFileSync(path.join(ROOT, 'pages/data/timeline.uvue'), 'utf-8')
  assert.ok(timeline.includes('chapter-row'), '时间线缺少故事章节头')
  assert.ok(timeline.includes('story-title'), '时间线缺少生命故事卡')
  const index = fs.readFileSync(path.join(ROOT, 'pages/index/index.uvue'), 'utf-8')
  assert.ok(index.includes('isFamilyView'), '首页缺少家人视角卡（爸爸端）')
  assert.ok(index.includes('goStory'), '英雄卡未接生命故事入口')
  const cycle = fs.readFileSync(path.join(ROOT, 'pages/record/cycle.uvue'), 'utf-8')
  assert.ok(cycle.includes('saveMucus'), '经期页缺少白带记录')
  assert.ok(cycle.includes('nextPeriodRange'), '周期概览未透出预测区间')
  const ovu = fs.readFileSync(path.join(ROOT, 'pages/record/ovulation-test.uvue'), 'utf-8')
  assert.ok(ovu.includes('choosePhoto'), '试纸页缺少拍照上传')
  const settings = fs.readFileSync(path.join(ROOT, 'pages/me/settings.uvue'), 'utf-8')
  assert.ok(settings.includes('applyMedTemplate'), '设置页缺少用药提醒模板')
  const onboarding = fs.readFileSync(path.join(ROOT, 'pages/onboarding/onboarding.uvue'), 'utf-8')
  // 引导页黄金位只放"帮用户开始"的功能内容：宣传性/自我表彰文案属于宣发物料（2026-10-31 用户裁定）
  assert.ok(!onboarding.includes('三个承诺'), '引导页黄金位不得放置承诺/宣言类卡片')
})

test('Web 可安装：PWA manifest 与主屏幕图标', () => {
  const manifestPath = path.join(ROOT, 'static/manifest.webmanifest')
  assert.ok(fs.existsSync(manifestPath), '缺少 manifest.webmanifest')
  const m = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'))
  assert.equal(m.display, 'standalone', 'manifest 应为独立窗口模式')
  assert.ok(m.icons.length > 0, 'manifest 缺少图标')
  for (const icon of m.icons) {
    const p = path.join(ROOT, icon.src.replace(/^\//, ''))
    assert.ok(fs.existsSync(p), `manifest 图标不存在: ${icon.src}`)
  }
  assert.ok(Array.isArray(m.shortcuts) && m.shortcuts.length >= 3, '缺少桌面快捷入口')
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf-8')
  assert.ok(html.includes('rel="manifest"'), 'index.html 未引用 manifest')
})

test('语音输入：日记页支持浏览器语音转文字', () => {
  const src = fs.readFileSync(path.join(ROOT, 'pages/record/diary.uvue'), 'utf-8')
  assert.ok(src.includes('SpeechRecognition'), '缺少语音识别接入')
  assert.ok(src.includes('toggleVoice'), '缺少语音开关')
  assert.ok(src.includes('voice-btn'), '缺少语音按钮')
})


test('Web 端选择器绕过：独立选择器页与存储轮询回传接线完整', () => {
  // Web 端 vapor picker 平台缺陷（docs/10）的绕过方案门禁：
  // 页面触发器（#ifdef WEB）→ pickDate/pickTime → 独立选择器页 → 存储轮询回传
  const pickerPage = fs.readFileSync(path.join(ROOT, 'pages/util/date-picker.uvue'), 'utf-8')
  assert.ok(pickerPage.includes("uni.setStorageSync(`lb_pick_${pickId.value}`, v)"), '选择器页缺少存储回传')
  assert.ok(pickerPage.includes('uni.navigateBack({ delta: 1 })'), '选择器页返回缺 delta（Web 端无参返回静默失效）')
  assert.ok(pickerPage.includes('emitBack(c.date)'), '日期模式缺点日即回传')
  assert.ok(pickerPage.includes('pickMinute(m)'), '时间模式缺点分钟即完成')
  const util = fs.readFileSync(path.join(ROOT, 'utils/pickDate.uts'), 'utf-8')
  assert.ok(util.includes('lb_pick_'), 'pickDate.uts 缺存储轮询键')
  assert.ok(util.includes('POLL_MAX'), 'pickDate.uts 缺轮询上限')
  const pages = ['pages/record/weight.uvue', 'pages/record/blood-pressure.uvue', 'pages/record/cycle.uvue', 'pages/me/settings.uvue', 'pages/baby/feeding.uvue']
  for (const p of pages) {
    const src = fs.readFileSync(path.join(ROOT, p), 'utf-8')
    assert.ok(/#ifdef WEB[\s\S]*?onPick\w+/.test(src) || src.includes('pickDate.uts'), `${p} 缺少 Web 分支触发器接线`)
  }
})

test('docs 索引：同类产品对标与平台缺陷报告已登记', () => {
  const readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf-8')
  assert.ok(readme.includes('09-同类产品对标同类产品报告'), 'README 缺 docs/09 链接')
  assert.ok(readme.includes('10-HBuilderX平台缺陷报告'), 'README 缺 docs/10 链接')
})

/* ---------------- 可读性下限（小字号不得回流） ---------------- */

test('最小字号不低于 24rpx（正文与辅助文案一致）', () => {
  const offenders = []
  for (const file of [...walkUvue(path.join(ROOT, 'pages')), ...walkUvue(path.join(ROOT, 'components'))]) {
    const src = fs.readFileSync(file, 'utf-8')
    for (const m of src.matchAll(/font-size:\s*(\d+)rpx/g)) {
      if (Number(m[1]) < 24) offenders.push(`${path.relative(ROOT, file)}: font-size ${m[1]}rpx`)
    }
  }
  assert.deepEqual(offenders, [], `以下位置字号过小:\n${offenders.join('\n')}`)
})

test('web 端 showToast 有可用兜底（内置 Toast 在 vapor 下渲染失败）', () => {
  const src = fs.readFileSync(path.join(ROOT, 'main.uts'), 'utf-8')
  assert.ok(src.includes('installWebToast'), '缺少 web toast 安装入口')
  assert.ok(src.includes('uniAny.showToast ='), '未覆写 uni.showToast')
  assert.ok(src.includes('lb-web-toast'), '缺少 toast 容器标记')
})

/* ---------------- v4 精装余项：fill-mode 适配 / 图标化 / 插画空态 ---------------- */

test('动效 fill-mode 仅用 forwards（uvue 不支持 both），延迟类带基态', () => {
  const offenders = []
  for (const file of [...walkUvue(path.join(ROOT, 'pages')), ...walkUvue(path.join(ROOT, 'components'))]) {
    const rel = path.relative(ROOT, file)
    const src = fs.readFileSync(file, 'utf-8')
    if (/animation:[^;{}]*\bboth\b/.test(src)) offenders.push(`${rel}: animation 仍使用 both`)
    for (const cls of ['lb-rise-1', 'lb-rise-2', 'lb-rise-3']) {
      const m = new RegExp(`\\.${cls} \\{([^}]*)\\}`).exec(src)
      if (m && m[1].includes('animation:')) {
        if (!/opacity:\s*0/.test(m[1]) || !/translateY\(28rpx\)/.test(m[1])) {
          offenders.push(`${rel}: .${cls} 缺起始帧基态（opacity/translateY）`)
        }
      }
    }
  }
  assert.deepEqual(offenders, [], `fill-mode 适配不完整:\n${offenders.join('\n')}`)
})

test('功能位 emoji 已替换为自绘图标（仅允许单色印刷符号）', () => {
  // 允许：✓ ✔ ✕ ★ ☆ › ‹（单色 dingbat，各端渲染一致）；其余彩色 emoji 一律禁止
  const ALLOWED = new Set(['✓', '✔', '✕', '★', '☆', '›', '‹'])
  const EMOJI_RE = /[\u{1F000}-\u{1FAFF}\u{2300}-\u{23FF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}]/gu
  const offenders = []
  for (const file of [...walkUvue(path.join(ROOT, 'pages')), ...walkUvue(path.join(ROOT, 'components'))]) {
    const src = fs.readFileSync(file, 'utf-8')
    src.split('\n').forEach((line, i) => {
      for (const m of line.matchAll(EMOJI_RE)) {
        if (!ALLOWED.has(m[0])) offenders.push(`${path.relative(ROOT, file)}:${i + 1} ${m[0]}`)
      }
    })
  }
  assert.deepEqual(offenders, [], `以下位置仍有 emoji 字形:\n${offenders.join('\n')}`)
})

test('自绘图标资产齐备（引用文件存在 + 关键图标与空态插画）', () => {
  const iconDir = path.join(ROOT, 'static/icons')
  assert.ok(fs.existsSync(iconDir), '缺少 static/icons 目录')
  const referenced = new Set()
  for (const file of [...walkUvue(path.join(ROOT, 'pages')), ...walkUvue(path.join(ROOT, 'components'))]) {
    const src = fs.readFileSync(file, 'utf-8')
    // 静态引用：src="/static/icons/xxx.png"
    for (const m of src.matchAll(/\/static\/icons\/([a-z0-9-]+)\.png/g)) referenced.add(m[1])
    // 数据引用：icon: 'xxx'（宫格/选项/红线图标名；排除 uni.showToast 的 icon 取值）
    const TOAST_ICONS = new Set(['none', 'success', 'error', 'info', 'loading', 'warn'])
    for (const m of src.matchAll(/\bicon:\s*'([a-z][a-z0-9-]*)'/g)) {
      if (!TOAST_ICONS.has(m[1])) referenced.add(m[1])
    }
    // 模板拼接引用中的心情图标
    for (const m of src.matchAll(/'(mood-(?:great|good|normal|low|bad))'/g)) referenced.add(m[1])
  }
  const missing = []
  for (const name of referenced) {
    if (!fs.existsSync(path.join(iconDir, name + '.png'))) missing.push(name)
  }
  assert.deepEqual(missing, [], `缺少图标文件:\n${missing.join('\n')}`)
  assert.ok(fs.existsSync(path.join(ROOT, 'static/empty-scene.png')), '缺少空态插画 empty-scene.png')
  const empty = fs.readFileSync(path.join(ROOT, 'components/lbc-empty/lbc-empty.uvue'), 'utf-8')
  assert.ok(empty.includes('/static/empty-scene.png'), 'lbc-empty 未接入空态插画')
})

/* ---------------- 可访问性：文字/关键底色对比度门禁（WCAG AA） ---------------- */

test('文字与关键底色对比度 ≥ 4.5:1（浅色与暗色主题）', () => {
  const theme = fs.readFileSync(path.join(ROOT, 'theme.scss'), 'utf-8')
  const block = (name) => {
    const m = new RegExp(`\\.${name}\\s*\\{([\\s\\S]*?)\\}`).exec(theme)
    assert.ok(m, `theme.scss 缺少 .${name}`)
    return m[1]
  }
  const vars = (name) => {
    const out = {}
    for (const m of block(name).matchAll(/(--lb-[\w-]+):\s*(#[0-9A-Fa-f]{6})/g)) out[m[1]] = m[2]
    return out
  }
  const lum = (hex) => {
    const c = hex.replace('#', '')
    const ch = [0, 2, 4].map(i => parseInt(c.slice(i, i + 2), 16) / 255)
      .map(v => v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4))
    return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2]
  }
  const ratio = (a, b) => {
    const x = lum(a), y = lum(b)
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)
  }
  const offenders = []
  const check = (themeName, fg, bg, min = 4.5) => {
    const r = ratio(fg, bg)
    if (r < min) offenders.push(`${themeName}: ${fg} on ${bg} = ${r.toFixed(2)}:1`)
  }
  const light = vars('t-light')
  const dark = vars('t-dark')
  for (const bg of ['--lb-card', '--lb-bg', '--lb-fill']) {
    check('t-light text-2', light['--lb-text-2'], light[bg])
    check('t-light text-3', light['--lb-text-3'], light[bg])
  }
  check('t-light primary-text/card', light['--lb-primary-text'], light['--lb-card'])
  check('t-light primary-text/soft', light['--lb-primary-text'], light['--lb-primary-soft'])
  check('t-light success-text/card', light['--lb-success-text'], light['--lb-card'])
  check('t-light success-text/soft', light['--lb-success-text'], light['--lb-success-soft'])
  check('t-light warning-text/card', light['--lb-warning-text'], light['--lb-card'])
  check('t-light warning-text/soft', light['--lb-warning-text'], light['--lb-warning-soft'])
  check('t-light danger-text/card', light['--lb-danger-text'], light['--lb-card'])
  check('t-light danger-text/soft', light['--lb-danger-text'], light['--lb-danger-soft'])
  for (const t of ['light', 'dark']) {
    const v = t === 'light' ? light : dark
    check(`t-${t} white/grad-1`, '#FFFFFF', v['--lb-grad-1'])
    check(`t-${t} white/grad-2`, '#FFFFFF', v['--lb-grad-2'])
    check(`t-${t} white/action`, '#FFFFFF', v['--lb-action'])
    check(`t-${t} white/secondary-action`, '#FFFFFF', v['--lb-secondary-action'])
  }
  check('t-dark primary-text/soft', dark['--lb-primary-text'], dark['--lb-primary-soft'])
  check('t-dark success-text/soft', dark['--lb-success-text'], dark['--lb-success-soft'])
  check('t-dark warning-text/soft', dark['--lb-warning-text'], dark['--lb-warning-soft'])
  check('t-dark danger-text/soft', dark['--lb-danger-text'], dark['--lb-danger-soft'])
  check('t-dark text-3/card', dark['--lb-text-3'], dark['--lb-card'])
  check('t-dark text-3/bg', dark['--lb-text-3'], dark['--lb-bg'])
  check('t-dark text-2/card', dark['--lb-text-2'], dark['--lb-card'])
  assert.deepEqual(offenders, [], `以下组合低于 4.5:1:\n${offenders.join('\n')}`)
})
