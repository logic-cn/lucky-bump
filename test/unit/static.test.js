/**
 * 静态一致性回归网（上线前门禁，巡检轮次 4 固化）
 * 1. pages.json 每个页面都有对应 .uvue，且无多余页面文件（防编译期 404）
 * 2. tabBar 图标文件存在
 * 3. 前端 .uvue 中所有 luckyX('method') 云调用，在对应云对象中存在同名可调用方法（防白名单/拼写遗漏）
 */
const test = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '../..')
const PAGES_JSON = JSON.parse(fs.readFileSync(path.join(ROOT, 'pages.json'), 'utf-8'))
const { CLOUD_ROOT } = require('../harness/cloud-dir')
const OBJ_DIR = path.join(CLOUD_ROOT, 'cloudfunctions')

const OBJ_ALIAS = {
  luckyId: 'lucky-id', luckyJourney: 'lucky-journey', luckyRecord: 'lucky-record',
  luckyBaby: 'lucky-baby', luckyCare: 'lucky-care', luckyFamily: 'lucky-family',
  luckyReminder: 'lucky-reminder', luckyData: 'lucky-data'
}

test('pages.json ↔ .uvue 文件双向一致', () => {
  const declared = PAGES_JSON.pages.map(p => p.path)
  for (const p of declared) {
    assert.ok(fs.existsSync(path.join(ROOT, p + '.uvue')), `缺少页面文件: ${p}.uvue`)
  }
  const actual = []
  const walk = (dir) => {
    for (const f of fs.readdirSync(dir)) {
      const full = path.join(dir, f)
      if (fs.statSync(full).isDirectory()) walk(full)
      else if (f.endsWith('.uvue')) actual.push(path.relative(ROOT, full).replace(/\.uvue$/, '').split(path.sep).join('/'))
    }
  }
  walk(path.join(ROOT, 'pages'))
  for (const a of actual) {
    assert.ok(declared.includes(a), `页面文件未注册到 pages.json: ${a}`)
  }
})

test('tabBar 图标文件齐全', () => {
  for (const item of PAGES_JSON.tabBar.list) {
    assert.ok(fs.existsSync(path.join(ROOT, item.iconPath)), `缺图标 ${item.iconPath}`)
    assert.ok(fs.existsSync(path.join(ROOT, item.selectedIconPath)), `缺图标 ${item.selectedIconPath}`)
  }
})

test('前端云调用 ↔ 后端云对象方法逐一存在', () => {
  // 收集前端调用：request.uts 的便捷函数名 → 云对象；页面中的 luckyX('method', ...)
  const aliasDefs = fs.readFileSync(path.join(ROOT, 'utils/request.uts'), 'utf-8')
  for (const [alias, obj] of Object.entries(OBJ_ALIAS)) {
    assert.ok(aliasDefs.includes(`export function ${alias}`), `request.uts 缺少便捷函数 ${alias}（对应 ${obj}）`)
  }
  const missing = []
  const walk = (dir) => {
    for (const f of fs.readdirSync(dir)) {
      const full = path.join(dir, f)
      if (fs.statSync(full).isDirectory()) { walk(full); continue }
      if (!f.endsWith('.uvue')) continue
      const src = fs.readFileSync(full, 'utf-8')
      for (const m of src.matchAll(/lucky(Id|Journey|Record|Baby|Care|Family|Reminder|Data)\('([A-Za-z0-9]+)'/g)) {
        const objName = OBJ_ALIAS['lucky' + m[1]]
        const method = m[2]
        const objPath = path.join(OBJ_DIR, objName, 'index.obj.js')
        assert.ok(fs.existsSync(objPath), `云对象不存在: ${objName}`)
        const objSrc = fs.readFileSync(objPath, 'utf-8')
        // 方法需以 async name( 或 name: 形式导出且不以 _ 开头（_ 前缀为私有，不可 RPC）
        const re = new RegExp(`async ${method}\\s*\\(`)
        if (!re.test(objSrc)) missing.push(`${path.relative(ROOT, full)} → ${objName}.${method}`)
      }
    }
  }
  walk(path.join(ROOT, 'pages'))
  assert.deepEqual(missing, [], `前端调用了后端不存在的方法:\n${missing.join('\n')}`)
})

test('云对象导出方法均有函数定义（防 RPC 运行时 404）', () => {
  const problems = []
  for (const obj of fs.readdirSync(OBJ_DIR)) {
    const objPath = path.join(OBJ_DIR, obj, 'index.obj.js')
    if (!fs.existsSync(objPath)) continue
    const src = fs.readFileSync(objPath, 'utf-8')
    const start = src.indexOf('module.exports')
    if (start < 0) { problems.push(`${obj}: 未找到 module.exports`); continue }
    // 大括号配对提取 exports 对象块
    let depth = 0, end = -1
    for (let i = src.indexOf('{', start); i < src.length; i++) {
      if (src[i] === '{') depth++
      else if (src[i] === '}') { depth--; if (depth === 0) { end = i; break } }
    }
    if (end < 0) { problems.push(`${obj}: exports 块未闭合`); continue }
    const block = src.slice(start, end)
    for (const m of block.matchAll(/^\s{2}(?:async\s+)?([A-Za-z0-9_]+)\s*[(:]/gm)) {
      const key = m[1]
      if (key === 'async') continue
      const direct = new RegExp(`async ${key}\\s*\\(`).test(src)
      const aliasMatch = new RegExp(`${key}\\s*:\\s*([A-Za-z0-9_]+),`).exec(block)
      const aliasOk = aliasMatch != null && new RegExp(`(async )?function ${aliasMatch[1]}\\s*\\(`).test(src)
      if (!direct && !aliasOk) problems.push(`${obj}.${key} 缺少函数定义`)
    }
  }
  assert.deepEqual(problems, [], `导出方法缺失定义:\n${problems.join('\n')}`)
})

/** 提取云对象中某个方法的函数体源码（大括号配对；跳过参数列表中的默认值对象） */
function methodBody(src, method) {
  const m = new RegExp(`async ${method}\\s*\\(`).exec(src)
  if (!m) return null
  // 先扫描参数列表：括号深度归零后遇到的第一个 { 才是函数体开始
  let paren = 0, braceStart = -1
  for (let i = src.indexOf('(', m.index); i < src.length; i++) {
    const c = src[i]
    if (c === '(') paren++
    else if (c === ')') { paren--; if (paren === 0) continue }
    else if (c === '{' && paren === 0) { braceStart = i; break }
  }
  if (braceStart < 0) return null
  let depth = 0
  for (let i = braceStart; i < src.length; i++) {
    if (src[i] === '{') depth++
    else if (src[i] === '}') { depth--; if (depth === 0) return src.slice(braceStart, i + 1) }
  }
  return null
}

test('安全：云对象不得直接调用 auth.verifyToken（必须走 auth.requireUser）', () => {
  // 白名单：logout 必须在吊销前拿到 jti，是唯一合法的直接调用点
  const ALLOWED = { 'lucky-id:logout': true }
  const offenders = []
  for (const obj of fs.readdirSync(OBJ_DIR)) {
    const objPath = path.join(OBJ_DIR, obj, 'index.obj.js')
    if (!fs.existsSync(objPath)) continue
    const src = fs.readFileSync(objPath, 'utf-8')
    if (!/auth\.verifyToken\s*\(/.test(src)) continue
    // 找出直接调用所在的方法名
    const hits = []
    for (const m of src.matchAll(/async\s+([A-Za-z0-9_]+)\s*\(/g)) hits.push({ name: m[1], idx: m.index })
    for (const m of src.matchAll(/auth\.verifyToken\s*\(/g)) {
      let owner = null
      for (const h of hits) { if (h.idx < m.index) owner = h.name; else break }
      const key = `${obj}:${owner}`
      if (!ALLOWED[key]) offenders.push(key)
    }
  }
  assert.deepEqual(offenders, [], `以下位置绕过了统一鉴权守卫（吊销校验会失效）：\n${offenders.join('\n')}`)
})

test('安全：接收 journeyId 的读方法必须调用 accessibleJourney', () => {
  // 这些方法一旦新增，必须同时调用 accessibleJourney 做归属校验
  const REQUIRED = {
    'lucky-record': ['listMetrics', 'latestMetrics', 'listCycleEvents', 'listTrackers', 'contractionAdvice', 'listDiaries'],
    'lucky-reminder': ['listRules', 'listDue'],
    'lucky-data': ['today', 'timeline', 'series', 'exportAll'],
    'lucky-care': ['listVisits'],
    'lucky-family': ['getFamily']
  }
  const problems = []
  for (const [obj, methods] of Object.entries(REQUIRED)) {
    const src = fs.readFileSync(path.join(OBJ_DIR, obj, 'index.obj.js'), 'utf-8')
    for (const method of methods) {
      const body = methodBody(src, method)
      if (body == null) { problems.push(`${obj}.${method} 未找到函数定义`); continue }
      if (!/accessibleJourney\s*\.\s*call|journeyAccess\s*\.\s*call|ownedJourney\s*\.\s*call|auth\.resolveJourneyAccess\s*\(/.test(body)) {
        problems.push(`${obj}.${method} 缺少旅程归属校验`)
      }
    }
  }
  assert.deepEqual(problems, [], `归属校验缺失：\n${problems.join('\n')}`)
})
