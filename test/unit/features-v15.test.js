/**
 * 后续规划功能回归网（2026-11-02）：里程碑 / 辅食 3 天观察 / 用药 / 饮水 / 儿保 / 周期·阶段·年度报告 / 新旅程
 */
const test = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '../..')
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf-8')
const obj = (name) => read(`uniCloud-aliyun/cloudfunctions/${name}/index.obj.js`)

test('规划功能页面均已注册且文件存在', () => {
  const declared = JSON.parse(read('pages.json')).pages.map(p => p.path)
  const pages = [
    'pages/baby/milestones', 'pages/tools/solid-food-log', 'pages/record/medication',
    'pages/record/water', 'pages/care/child-health', 'pages/data/report'
  ]
  for (const p of pages) {
    assert.ok(declared.includes(p), `未注册页面 ${p}`)
    assert.ok(fs.existsSync(path.join(ROOT, p + '.uvue')), `缺少页面文件 ${p}.uvue`)
  }
})

test('后端能力齐备：里程碑 / 辅食 / 用药 / 儿保 / 报告', () => {
  const baby = obj('lucky-baby')
  for (const m of ['addMilestone', 'listMilestones', 'addFood', 'logFoodReaction', 'foodDashboard', 'addMedication', 'listMedications']) {
    assert.ok(baby.includes(`async ${m}(`), `lucky-baby 缺少方法 ${m}`)
  }
  const care = obj('lucky-care')
  for (const m of ['addChildHealth', 'listChildHealth']) {
    assert.ok(care.includes(`async ${m}(`), `lucky-care 缺少方法 ${m}`)
  }
  const data = obj('lucky-data')
  assert.ok(data.includes('async report('), 'lucky-data 缺少 report 方法')
  for (const t of ["'cycle'", "'stage'", "'annual'"]) {
    assert.ok(data.includes(t), `report 未覆盖类型 ${t}`)
  }
  assert.ok(data.includes("type: 'medication'"), '时间线未聚合用药记录')
  assert.ok(data.includes("'lb-child-health'"), '全量导出未包含儿保记录')
  const schema = JSON.parse(read('uniCloud-aliyun/database/lb-child-health.schema.json'))
  assert.equal(schema.permission.create, false, 'lb-child-health 必须关闭 clientDB 写入')
  assert.equal(schema.permission.read, false, 'lb-child-health 必须关闭 clientDB 读取')
})

test('前端入口接线：里程碑 / 辅食 / 用药 / 饮水 / 儿保 / 报告 / 新旅程', () => {
  const checks = [
    ['pages/baby/baby-home.uvue', '/pages/baby/milestones'],
    ['pages/baby/baby-home.uvue', '/pages/tools/solid-food-log'],
    ['pages/baby/baby-home.uvue', '/pages/care/child-health'],
    ['pages/record/record.uvue', '/pages/record/medication'],
    ['pages/record/record.uvue', '/pages/record/water'],
    ['pages/data/data.uvue', '/pages/data/report'],
    ['pages/me/settings.uvue', 'startNewJourney'],
    ['pages/index/index.uvue', 'devFocus']
  ]
  for (const [file, token] of checks) {
    assert.ok(read(file).includes(token), `${file} 缺少入口 ${token}`)
  }
  const solid = read('pages/tools/solid-food.uvue')
  assert.ok(solid.includes('/pages/tools/solid-food-log'), '辅食科普页缺少记录入口')
  const report = read('pages/data/report.uvue')
  for (const t of ["'cycle'", "'stage'", "'annual'"]) {
    assert.ok(report.includes(t), `报告页缺少类型 ${t}`)
  }
})

test('饮水复用 water 指标白名单（不新增重复存储）', () => {
  const record = obj('lucky-record')
  assert.ok(record.includes("water: { label: '饮水'"), 'lucky-record 缺少 water 指标定义')
  assert.ok(read('pages/record/water.uvue').includes("code: 'water'"), '饮水页未使用 water 指标')
})

test('新旅程入口仅在产后阶段出现，并刷新旅程状态', () => {
  const settings = read('pages/me/settings.uvue')
  for (const s of ['POSTPARTUM', 'RECOVERY', 'PARENTING']) {
    assert.ok(settings.includes(s), `新旅程入口未覆盖阶段 ${s}`)
  }
  assert.ok(settings.includes('loadCurrentJourney'), '开始新旅程后未刷新旅程状态')
})
