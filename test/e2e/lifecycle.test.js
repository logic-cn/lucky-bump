/**
 * 端到端全生命周期测试（docs/05 §Phase5 验收）
 * 用户旅程：注册 → 备孕（周期/试纸/同房/BBT）→ 验孕阳性 → 好孕确认 → 孕期记录（体重/血压/血糖/症状/胎动）
 *   → 产检（排程/记录）→ 分娩登记 → 产褥期（恶露/EPDS）→ 育儿（喂养/尿布/睡眠/成长/疫苗/里程碑/辅食）
 *   → 家庭共享（邀请/授权）→ 数据中心（today/曲线/时间线/导出）→ 提醒 → 二宝再备孕回流
 * 运行：npm run test:e2e
 */
const test = require('node:test')
const assert = require('node:assert')
const { createRuntime, withFixedClock } = require('../harness/unicloud-mock')

const NOW = Date.UTC(2026, 10, 26, 14, 0, 0) // 2026-11-26T14:00Z（整个旅程的"今天"）
const DAY = 24 * 3600 * 1000

test('E2E 全生命周期：从两道杠到二宝', async () => {
  const rt = createRuntime()
  const at = (ms) => withFixedClock(NOW, () => rt)

  /* ---------- 1. 注册登录 ---------- */
  const reg = await withFixedClock(NOW, () => rt.callObject('lucky-id', 'register', { username: 'lily2026', password: 'iamamother8', nickname: '丽丽' }))
  assert.equal(reg.errCode, 0, JSON.stringify(reg))
  const login = await withFixedClock(NOW, () => rt.callObject('lucky-id', 'login', { username: 'lily2026', password: 'iamamother8' }))
  const token = login.token
  assert.equal(login.userInfo.nickname, '丽丽')

  /* ---------- 2. 备孕期 ---------- */
  const mk = await withFixedClock(NOW, () => rt.callObject('lucky-journey', 'createJourney', { mode: 'ttc', title: '第一程' }, { token }))
  assert.equal(mk.errCode, 0)
  assert.equal(mk.view.stage, 'PRECONCEPTION')
  const jid = mk.journeyId
  // 三个 30 天周期 + 强阳试纸 + 同房 + BBT
  for (const d of ['2026-07-28', '2026-08-27', '2026-09-26']) {
    const ev = await withFixedClock(NOW, () => rt.callObject('lucky-record', 'addCycleEvent', { journeyId: jid, type: 'period_start', date: d }, { token }))
    assert.equal(ev.errCode, 0)
    const ev2 = await withFixedClock(NOW, () => rt.callObject('lucky-record', 'addCycleEvent', { journeyId: jid, type: 'period_end', date: d, value: { days: 5 } }, { token }))
    assert.equal(ev2.errCode, 0)
  }
  const ovu = await withFixedClock(NOW, () => rt.callObject('lucky-record', 'addCycleEvent', { journeyId: jid, type: 'ovulation_test', date: '2026-10-10', value: { result: 'strong_positive' } }, { token }))
  assert.equal(ovu.errCode, 0)
  const ix = await withFixedClock(NOW, () => rt.callObject('lucky-record', 'addCycleEvent', { journeyId: jid, type: 'intercourse', date: '2026-10-10' }, { token }))
  assert.equal(ix.errCode, 0)
  const overview = await withFixedClock(NOW, () => rt.callObject('lucky-record', 'listCycleEvents', { journeyId: jid }, { token }))
  assert.equal(overview.prediction.avgCycleLength, 30)
  assert.ok(overview.prediction.fertileWindow.from <= '2026-11-09')
  // 敏感记录不落入普通查询语义（sensitivity 标记正确）
  assert.equal(overview.events.find(e => e.type === 'intercourse').sensitivity, 'strict')

  /* ---------- 3. 验孕与好孕确认 ---------- */
  const pt = await withFixedClock(NOW, () => rt.callObject('lucky-record', 'addCycleEvent', { journeyId: jid, type: 'pregnancy_test', date: '2026-10-24', value: { result: 'positive' } }, { token }))
  assert.equal(pt.pregnancyPositive, true, '验孕阳性应触发好孕引导')
  // 末次月经 2026-09-26 → 孕 61 天 → 孕 8 周 + 5 天 → T1
  const confirm = await withFixedClock(NOW, () => rt.callObject('lucky-journey', 'confirmPregnancy', { journeyId: jid, eddSource: 'lmp', lmpDate: '2026-09-26' }, { token }))
  assert.equal(confirm.errCode, 0)
  assert.equal(confirm.view.stage, 'T1')
  assert.equal(confirm.view.weeks, 8)
  assert.equal(confirm.view.days, 5)
  assert.ok(confirm.welcome.nextSteps.length >= 3)

  /* ---------- 4. 孕期记录 ---------- */
  const w = await withFixedClock(NOW, () => rt.callObject('lucky-record', 'addMetric', { journeyId: jid, code: 'weight', value: { kg: 58.2 } }, { token }))
  assert.equal(w.errCode, 0)
  const bpOk = await withFixedClock(NOW, () => rt.callObject('lucky-record', 'addMetric', { journeyId: jid, code: 'blood_pressure', value: { sbp: 118, dbp: 76, hr: 72 } }, { token }))
  assert.equal(bpOk.redline, null, '正常血压不应有红线')
  const bpBad = await withFixedClock(NOW, () => rt.callObject('lucky-record', 'addMetric', { journeyId: jid, code: 'blood_pressure', value: { sbp: 165, dbp: 105 } }, { token }))
  assert.equal(bpBad.redline.level, 'critical')
  const glu = await withFixedClock(NOW, () => rt.callObject('lucky-record', 'addMetric', { journeyId: jid, code: 'blood_glucose', value: { slot: 'fasting', mmol: 5.4 } }, { token }))
  assert.equal(glu.redline.level, 'warn', '空腹血糖超标应有 GDM 提示')
  const sym = await withFixedClock(NOW, () => rt.callObject('lucky-record', 'addMetric', { journeyId: jid, code: 'symptom', value: { codes: ['nausea', 'fatigue'], severity: 2, note: '晨起明显' } }, { token }))
  assert.equal(sym.errCode, 0)
  // 胎动（计数模式）
  const fm = await withFixedClock(NOW, () => rt.callObject('lucky-record', 'addMetric', { journeyId: jid, code: 'fetal_movement', value: { count: 12, durationMin: 60 } }, { token }))
  assert.equal(fm.errCode, 0)

  /* ---------- 5. 产检 ---------- */
  const gen = await withFixedClock(NOW, () => rt.callObject('lucky-care', 'generatePlan', { journeyId: jid }, { token }))
  assert.equal(gen.errCode, 0)
  const plan = await withFixedClock(NOW, () => rt.callObject('lucky-care', 'listPlan', { journeyId: jid }, { token }))
  assert.ok(plan.items.length >= 15, '应生成完整排程')
  // 补录一次已完成的建档产检
  const visit = await withFixedClock(NOW, () => rt.callObject('lucky-care', 'addVisit', {
    journeyId: jid, visitDate: '2026-10-20', hospital: '市妇幼保健院', doctor: '王主任', week: 3,
    items: [{ code: 'nt', name: 'NT超声', result: '1.2mm', abnormal: false }],
    costYuan: 680, conclusion: 'NT 正常，继续口服叶酸', nextVisitDate: '2026-12-04'
  }, { token }))
  assert.equal(visit.errCode, 0)
  const visits = await withFixedClock(NOW, () => rt.callObject('lucky-care', 'listVisits', { journeyId: jid }, { token }))
  assert.equal(visits.visits.length, 1)
  assert.equal(visits.totalCost, 680)

  /* ---------- 6. 分娩与产褥期 ---------- */
  const del = await withFixedClock(NOW, () => rt.callObject('lucky-journey', 'registerDelivery', {
    journeyId: jid, deliveryDate: '2026-11-20', deliveryMode: 'vaginal', hospital: '市妇幼保健院',
    babies: [{ nickname: '小年糕', sex: 'female', weightG: 3350, lengthCm: 50 }]
  }, { token }))
  assert.equal(del.errCode, 0)
  assert.equal(del.view.stage, 'POSTPARTUM')
  assert.equal(del.view.postpartumDays, 6)
  const babyId = del.babyIds[0]
  const lochia = await withFixedClock(NOW, () => rt.callObject('lucky-record', 'addMetric', { journeyId: jid, code: 'lochia', value: { color: 'dark_red', amount: 'medium', clots: false, odor: false } }, { token }))
  assert.equal(lochia.errCode, 0)
  const epds = await withFixedClock(NOW, () => rt.callObject('lucky-record', 'submitEpds', { journeyId: jid, answers: [0, 1, 0, 1, 0, 0, 1, 0, 0, 0] }, { token }))
  assert.equal(epds.score, 7, '温和区间得分(反向题 3+2 + 正向 2)')
  assert.ok(epds.action.includes('平稳') || epds.action.includes('休息'))

  /* ---------- 7. 育儿记录 ---------- */
  const f1 = await withFixedClock(NOW, () => rt.callObject('lucky-baby', 'addFeeding', { journeyId: jid, babyId, mode: 'nursing', side: 'left', durationSec: 900 }, { token }))
  assert.equal(f1.errCode, 0)
  const f2 = await withFixedClock(NOW, () => rt.callObject('lucky-baby', 'addFeeding', { journeyId: jid, babyId, mode: 'formula', ml: 60 }, { token }))
  assert.equal(f2.errCode, 0)
  const d1 = await withFixedClock(NOW, () => rt.callObject('lucky-baby', 'addDiaper', { journeyId: jid, babyId, kind: 'both', texture: 'paste', color: 'yellow' }, { token }))
  assert.equal(d1.errCode, 0)
  const dBad = await withFixedClock(NOW, () => rt.callObject('lucky-baby', 'addDiaper', { journeyId: jid, babyId, kind: 'poop', color: 'blood_streak' }, { token }))
  assert.equal(dBad.redline.level, 'critical', '血便红线')
  const s1 = await withFixedClock(NOW, () => rt.callObject('lucky-baby', 'addSleep', { journeyId: jid, babyId, kind: 'night', startTs: NOW - 5 * 3600 * 1000, endTs: NOW - 1 * 3600 * 1000, nightWakings: 2 }, { token }))
  assert.equal(s1.errCode, 0)
  const daily = await withFixedClock(NOW, () => rt.callObject('lucky-baby', 'dailySummary', { journeyId: jid, babyId }, { token }))
  assert.equal(daily.feeding.count, 2)
  assert.equal(daily.feeding.totalMl, 60)
  assert.equal(daily.sleep.totalMin, 240)
  // 成长：出生体重记录 + 6 天后
  const g0 = await withFixedClock(NOW, () => rt.callObject('lucky-baby', 'addGrowth', { journeyId: jid, babyId, weightKg: 3.35, heightCm: 50, measureDate: '2026-11-20' }, { token }))
  assert.equal(g0.errCode, 0)
  const g1 = await withFixedClock(NOW, () => rt.callObject('lucky-baby', 'addGrowth', { journeyId: jid, babyId, weightKg: 3.5, heightCm: 50.5, measureDate: '2026-11-26' }, { token }))
  assert.equal(g1.errCode, 0)
  // 疫苗：出生剂次
  const vrec = await withFixedClock(NOW, () => rt.callObject('lucky-baby', 'recordVaccine', { journeyId: jid, babyId, code: 'hepb1', name: '乙肝疫苗', dose: 1, date: '2026-11-20' }, { token }))
  assert.equal(vrec.errCode, 0)
  const vrec2 = await withFixedClock(NOW, () => rt.callObject('lucky-baby', 'recordVaccine', { journeyId: jid, babyId, code: 'bcg', name: '卡介苗', dose: 1, date: '2026-11-20' }, { token }))
  assert.equal(vrec2.errCode, 0)
  const vplan = await withFixedClock(NOW, () => rt.callObject('lucky-baby', 'getVaccinePlan', { journeyId: jid, babyId }, { token }))
  assert.equal(vplan.doneCount, 2)
  // 里程碑目录（未达成 → upcoming）
  const ms = await withFixedClock(NOW, () => rt.callObject('lucky-baby', 'listMilestones', { journeyId: jid, babyId }, { token }))
  assert.equal(ms.errCode, 0)
  assert.ok(ms.catalog.length >= 14)
  assert.equal(ms.catalog.find(m => m.code === 'head_up').status, 'upcoming')
  // 辅食：宝宝 0 月龄仍可预记录（记录不限制月龄，内容侧提示 6 月龄起）
  const food = await withFixedClock(NOW, () => rt.callObject('lucky-baby', 'addFood', { journeyId: jid, babyId, name: '强化铁米粉' }, { token }))
  assert.equal(food.errCode, 0)
  assert.equal(food.first, true)
  assert.ok(food.observation, '首次添加应建立 3 天观察窗')
  const react = await withFixedClock(NOW, () => rt.callObject('lucky-baby', 'logFoodReaction', { foodLogId: food.recordId, reaction: 'rash' }, { token }))
  assert.ok(react.alert.includes('强化铁米粉'))
  const dash = await withFixedClock(NOW, () => rt.callObject('lucky-baby', 'foodDashboard', { journeyId: jid, babyId }, { token }))
  assert.deepEqual(dash.allergens, ['强化铁米粉'])

  /* ---------- 8. 家庭共享 ---------- */
  const fam = await withFixedClock(NOW, () => rt.callObject('lucky-family', 'getFamily', { journeyId: jid }, { token }))
  assert.equal(fam.errCode, 0)
  const regDad = await withFixedClock(NOW, () => rt.callObject('lucky-id', 'register', { username: 'azhe2026', password: 'superdaddy8', nickname: '阿哲' }))
  assert.equal(regDad.errCode, 0)
  const dadLogin = await withFixedClock(NOW, () => rt.callObject('lucky-id', 'login', { username: 'azhe2026', password: 'superdaddy8' }))
  const inv = await withFixedClock(NOW, () => rt.callObject('lucky-family', 'invite', { journeyId: jid, role: 'recorder' }, { token }))
  const joinDad = await withFixedClock(NOW, () => rt.callObject('lucky-family', 'join', { code: inv.code, nickname: '爸爸' }, { token: dadLogin.token }))
  assert.equal(joinDad.errCode, 0)
  assert.equal(joinDad.role, 'recorder')
  // 爸爸记录夜奶（写入同一数据流）
  const dadFeed = await withFixedClock(NOW, () => rt.callObject('lucky-baby', 'addFeeding', { journeyId: jid, babyId, mode: 'breastmilk_bottle', ml: 80 }, { token: dadLogin.token }))
  assert.equal(dadFeed.errCode, 0, '记录者应可写记录')
  const daily2 = await withFixedClock(NOW, () => rt.callObject('lucky-baby', 'dailySummary', { journeyId: jid, babyId }, { token }))
  assert.equal(daily2.feeding.count, 3, '爸爸的记录进入同一数据流')

  /* ---------- 9. 提醒与数据 ---------- */
  const rule = await withFixedClock(NOW, () => rt.callObject('lucky-reminder', 'addRule', { journeyId: jid, type: 'absolute', title: '产后 42 天检查', anchorDate: '2027-01-01', leadDays: 3 }, { token }))
  assert.equal(rule.errCode, 0)
  const due = await withFixedClock(NOW, () => rt.callObject('lucky-reminder', 'listDue', { journeyId: jid, days: 60 }, { token }))
  assert.ok(due.todos.some(t => t.title.includes('42 天')), '42 天检查应出现在待办')
  const today = await withFixedClock(NOW, () => rt.callObject('lucky-data', 'today', { journeyId: jid }, { token }))
  assert.equal(today.errCode, 0)
  assert.equal(today.journey.stage, 'POSTPARTUM')
  assert.ok(today.todos.length > 0)
  assert.equal(today.latest.weight.value.kg, 58.2)
  const series = await withFixedClock(NOW, () => rt.callObject('lucky-data', 'series', { journeyId: jid, code: 'weight' }, { token }))
  assert.equal(series.points.length, 1)
  const timeline = await withFixedClock(NOW, () => rt.callObject('lucky-data', 'timeline', { journeyId: jid }, { token }))
  assert.ok(timeline.events.length >= 10, '时间线应聚合多种记录')
  const exported = await withFixedClock(NOW, () => rt.callObject('lucky-data', 'exportAll', { journeyId: jid }, { token }))
  assert.equal(exported.errCode, 0)
  assert.ok(exported.data['lb-feedings'].length >= 3)
  // 围观者不可导出（权限边界）
  const regGma = await withFixedClock(NOW, () => rt.callObject('lucky-id', 'register', { username: 'grandma66', password: 'grandma668', nickname: '外婆' }))
  const gmaLogin = await withFixedClock(NOW, () => rt.callObject('lucky-id', 'login', { username: 'grandma66', password: 'grandma668' }))
  const invGma = await withFixedClock(NOW, () => rt.callObject('lucky-family', 'invite', { journeyId: jid, role: 'viewer' }, { token }))
  await withFixedClock(NOW, () => rt.callObject('lucky-family', 'join', { code: invGma.code }, { token: gmaLogin.token }))
  const gmaExport = await withFixedClock(NOW, () => rt.callObject('lucky-data', 'exportAll', { journeyId: jid }, { token: gmaLogin.token }))
  assert.equal(gmaExport.errCode, 'NOT_FOUND', '非 owner 不可导出全量数据')

  /* ---------- 10. 二宝回流 ---------- */
  const nj = await withFixedClock(NOW + 60000, () => rt.callObject('lucky-journey', 'startNewJourney', { journeyId: jid, title: '二宝来啦', fromJourneyId: jid }, { token }))
  assert.equal(nj.errCode, 0)
  const listJ = await withFixedClock(NOW + 60000, () => rt.callObject('lucky-journey', 'listJourneys', {}, { token }))
  assert.equal(listJ.journeys.length, 2)
  assert.equal(listJ.currentId, nj.journeyId, '默认切换到新旅程')
  const arch = await withFixedClock(NOW, () => rt.callObject('lucky-journey', 'archiveJourney', { journeyId: jid }, { token }))
  assert.equal(arch.errCode, 0)

  /* ---------- 11. 登出 ---------- */
  const out = await withFixedClock(NOW, () => rt.callObject('lucky-id', 'logout', {}, { token }))
  assert.equal(out.errCode, 0)
  const chk = await withFixedClock(NOW, () => rt.callObject('lucky-id', 'checkToken', {}, { token }))
  assert.equal(chk.errCode, 'TOKEN_INVALID', '登出后 token 应吊销')
})
