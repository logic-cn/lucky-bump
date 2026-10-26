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
const OBJ_DIR = path.join(ROOT, 'uniCloud-aliyun/cloudfunctions')

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
