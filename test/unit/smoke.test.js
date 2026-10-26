/** 冒烟测试：注册 → 登录 → 建档(备孕) → 好孕确认 → B超校正 → 分娩 → 哀伤模式（固定时钟，确定性） */
const test = require('node:test')
const assert = require('node:assert')
const { createRuntime, withFixedClock } = require('../harness/unicloud-mock')

const NOW = Date.UTC(2026, 9, 26, 14, 0, 0) // 2026-10-26T14:00Z

test('核心链路冒烟：账户 + 阶段引擎', async () => {
  const rt = createRuntime()

  // 注册
  const reg = await withFixedClock(NOW, () => rt.callObject('lucky-id', 'register', { username: 'xiaoya', password: 'password123', nickname: '小雅' }))
  assert.equal(reg.errCode, 0, '注册应成功: ' + JSON.stringify(reg))

  // 重复注册被拒
  const reg2 = await withFixedClock(NOW, () => rt.callObject('lucky-id', 'register', { username: 'xiaoya', password: 'password123' }))
  assert.equal(reg2.errCode, 'USERNAME_EXISTS')

  // 登录 + 错误密码
  const login = await withFixedClock(NOW, () => rt.callObject('lucky-id', 'login', { username: 'xiaoya', password: 'password123' }))
  assert.equal(login.errCode, 0)
  assert.ok(login.token.startsWith('lb.'))
  const badLogin = await withFixedClock(NOW, () => rt.callObject('lucky-id', 'login', { username: 'xiaoya', password: 'wrong-password' }))
  assert.equal(badLogin.errCode, 'PASSWORD_ERROR')
  const token = login.token

  // token 校验
  const chk = await withFixedClock(NOW, () => rt.callObject('lucky-id', 'checkToken', {}, { token }))
  assert.equal(chk.errCode, 0)

  // 建档（备孕）
  const mk = await withFixedClock(NOW, () => rt.callObject('lucky-journey', 'createJourney', { mode: 'ttc', title: '备孕第一程' }, { token }))
  assert.equal(mk.errCode, 0)
  assert.equal(mk.view.stage, 'PRECONCEPTION')
  const journeyId = mk.journeyId

  // 好孕确认：LMP=2026-07-18（NOW 前 100 天）→ 孕 14 周 + 2 天 → T2
  const confirm = await withFixedClock(NOW, () => rt.callObject('lucky-journey', 'confirmPregnancy', { journeyId, eddSource: 'lmp', lmpDate: '2026-07-18' }, { token }))
  assert.equal(confirm.errCode, 0, JSON.stringify(confirm))
  assert.equal(confirm.view.stage, 'T2')
  assert.equal(confirm.view.weeks, 14)
  assert.equal(confirm.view.days, 2)
  assert.equal(confirm.view.daysToEdd, 180)

  // 孕早期 B 超校正（8+3 @ 2026-08-17，即孕 70 天）→ 以超声为准，孕周变 18+3
  const us = await withFixedClock(NOW, () => rt.callObject('lucky-journey', 'updateDates', {
    journeyId, eddSource: 'ultrasound', ultrasoundDate: '2026-08-17', ultrasoundWeekDays: '8+3'
  }, { token }))
  assert.equal(us.errCode, 0, JSON.stringify(us))
  assert.equal(us.view.eddSource, 'ULTRASOUND')
  assert.equal(us.view.weeks, 18)
  assert.equal(us.view.days, 3)

  // 分娩登记（2026-10-16，产后第 10 天）→ 产褥期 + 宝宝档案
  const del = await withFixedClock(NOW, () => rt.callObject('lucky-journey', 'registerDelivery', {
    journeyId, deliveryDate: '2026-10-16', deliveryMode: 'vaginal', hospital: '市妇幼',
    babies: [{ nickname: '小糯米', sex: 'female', weightG: 3200, lengthCm: 50 }]
  }, { token }))
  assert.equal(del.errCode, 0, JSON.stringify(del))
  assert.equal(del.view.stage, 'POSTPARTUM')
  assert.equal(del.view.postpartumDays, 10)
  assert.equal(del.babyIds.length, 1)

  // 哀伤模式 + 撤销（另一旅程）
  const mk2 = await withFixedClock(NOW, () => rt.callObject('lucky-journey', 'createJourney', { mode: 'ttc' }, { token }))
  const m = await withFixedClock(NOW, () => rt.callObject('lucky-journey', 'registerMourning', { journeyId: mk2.journeyId, reason: 'biochemical' }, { token }))
  assert.equal(m.errCode, 0)
  const undone = await withFixedClock(NOW, () => rt.callObject('lucky-journey', 'undoMourning', { journeyId: mk2.journeyId }, { token }))
  assert.equal(undone.errCode, 0)

  // 未登录访问被拒
  const anon = await withFixedClock(NOW, () => rt.callObject('lucky-journey', 'listJourneys', {}))
  assert.equal(anon.errCode, 'TOKEN_INVALID')
})
