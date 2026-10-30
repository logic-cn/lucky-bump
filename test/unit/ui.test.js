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

test('可交互 tab 页均有按压反馈（hover-class lb-press；learn 为纯静态知识页豁免）', () => {
  for (const p of ['pages/index/index.uvue', 'pages/record/record.uvue', 'pages/data/data.uvue', 'pages/me/me.uvue']) {
    const src = fs.readFileSync(path.join(ROOT, p), 'utf-8')
    assert.ok(src.includes('hover-class="lb-press"'), `${p} 缺少按压反馈`)
  }
  const learn = fs.readFileSync(path.join(ROOT, 'pages/learn/learn.uvue'), 'utf-8')
  assert.ok(!/@click/.test(learn.match(/<template>[\s\S]*<\/template>/)[0]), 'learn 页应保持纯静态（若新增可点元素请同步加 hover-class 并纳入本测试）')
})

test('pages.json 与 uni.scss 设计令牌一致', () => {
  const pagesJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'pages.json'), 'utf-8'))
  assert.equal(pagesJson.globalStyle.navigationBarBackgroundColor.toUpperCase(), token('bg'), '导航栏底色须与 $lb-bg 一致')
  assert.equal(pagesJson.globalStyle.backgroundColor.toUpperCase(), token('bg'), '窗口底色须与 $lb-bg 一致')
  assert.equal(pagesJson.tabBar.color.toUpperCase(), token('text-3'), 'tabBar 未选中色须与 $lb-text-3 一致')
  assert.equal(pagesJson.tabBar.selectedColor.toUpperCase(), token('primary'), 'tabBar 选中色须与 $lb-primary 一致')
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
