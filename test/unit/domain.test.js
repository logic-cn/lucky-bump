/** 领域规则单元测试：产检排程 / 疫苗计划 / EPDS / 5-1-1 / 百分位 / 授权矩阵 / 红线 */
const test = require('node:test')
const assert = require('node:assert')
const { createRuntime, withFixedClock } = require('../harness/unicloud-mock')
const { CLOUD_ROOT } = require('../harness/cloud-dir')

const NOW = Date.UTC(2026, 9, 26, 14, 0, 0)
const DAY = 24 * 3600 * 1000

async function freshUser(rt, name) {
  const reg = await withFixedClock(NOW, () => rt.callObject('lucky-id', 'register', { username: name, password: 'password123' }))
  const login = await withFixedClock(NOW, () => rt.callObject('lucky-id', 'login', { username: name, password: 'password123' }))
  return login.token
}
async function pregnantJourney(rt, token, lmp) {
  const mk = await withFixedClock(NOW, () => rt.callObject('lucky-journey', 'createJourney', { mode: 'ttc' }, { token }))
  const c = await withFixedClock(NOW, () => rt.callObject('lucky-journey', 'confirmPregnancy', { journeyId: mk.journeyId, eddSource: 'lmp', lmpDate: lmp }, { token }))
  assert.equal(c.errCode, 0)
  return mk.journeyId
}

test('产检排程：生成数量、区间覆盖与准备提醒', async () => {
  const rt = createRuntime()
  const token = await freshUser(rt, 'user_a')
  const jid = await pregnantJourney(rt, token, '2026-07-18') // NOW 时孕 14+2
  const gen = await withFixedClock(NOW, () => rt.callObject('lucky-care', 'generatePlan', { journeyId: jid }, { token }))
  assert.equal(gen.errCode, 0)
  const list = await withFixedClock(NOW, () => rt.callObject('lucky-care', 'listPlan', { journeyId: jid }, { token }))
  assert.equal(list.errCode, 0)
  // 28 周前每 4 周（6,10,14,18,22,26）、28-35 每 2 周（28,30,32,34）、36+ 每周（36..40）→ 15 条
  assert.equal(list.items.length, 15, '排程数量应为 15：' + list.items.length)
  const ogtt = list.items.find(i => i.title.includes('糖耐'))
  assert.ok(ogtt, '应包含糖耐项目')
  assert.ok(ogtt.prep.includes('空腹'), '糖耐应有空腹准备提醒')
  const weeks = list.items.map(i => i.week)
  assert.deepEqual(weeks.slice().sort((a, b) => a - b), [6, 10, 14, 18, 22, 26, 28, 30, 32, 34, 36, 37, 38, 39, 40])
})

test('疫苗计划：按出生日期生成状态与接种记录', async () => {
  const rt = createRuntime()
  const token = await freshUser(rt, 'user_b')
  const mk = await withFixedClock(NOW, () => rt.callObject('lucky-journey', 'createJourney', { mode: 'ttc' }, { token }))
  const birth = '2026-09-26' // 恰好 1 月龄
  const del = await withFixedClock(NOW, () => rt.callObject('lucky-journey', 'registerDelivery', {
    journeyId: mk.journeyId, deliveryDate: birth, babies: [{ nickname: '小豆', sex: 'male', weightG: 3300, lengthCm: 50 }]
  }, { token }))
  const babyId = del.babyIds[0]
  const plan = await withFixedClock(NOW, () => rt.callObject('lucky-baby', 'getVaccinePlan', { journeyId: mk.journeyId, babyId }, { token }))
  assert.equal(plan.errCode, 0)
  const hepb1 = plan.plan.find(v => v.code === 'hepb1')
  const mmr2 = plan.plan.find(v => v.code === 'mmr2')
  assert.equal(hepb1.status, 'due', '出生剂次应已到期')
  assert.equal(mmr2.status, 'upcoming', '18 月剂次应未到期')
  // 记录接种
  const rec = await withFixedClock(NOW, () => rt.callObject('lucky-baby', 'recordVaccine', { journeyId: mk.journeyId, babyId, code: 'hepb1', name: '乙肝疫苗', dose: 1, date: birth, lotNo: 'A2026' }, { token }))
  assert.equal(rec.errCode, 0)
  const plan2 = await withFixedClock(NOW, () => rt.callObject('lucky-baby', 'getVaccinePlan', { journeyId: mk.journeyId, babyId }, { token }))
  assert.equal(plan2.plan.find(v => v.code === 'hepb1').status, 'done')
})

test('EPDS：计分规则（1/2 题反向）与自伤特殊处理', async () => {
  const rt = createRuntime()
  const token = await freshUser(rt, 'user_c')
  const jid = await pregnantJourney(rt, token, '2026-01-01')
  // 全 0：前两题反向 → 3+3=6，其余 0 → 6 分
  const s1 = await withFixedClock(NOW, () => rt.callObject('lucky-record', 'submitEpds', { journeyId: jid, answers: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0] }, { token }))
  assert.equal(s1.score, 6)
  assert.equal(s1.selfHarm, false)
  // 全 3：反向 → 0，其余 3×8=24 → ≥13 + 自伤
  const s2 = await withFixedClock(NOW, () => rt.callObject('lucky-record', 'submitEpds', { journeyId: jid, answers: [3, 3, 3, 3, 3, 3, 3, 3, 3, 3] }, { token }))
  assert.equal(s2.score, 24)
  assert.equal(s2.selfHarm, true)
  assert.ok(s2.action.includes('热线'), '自伤风险应立即给求助资源')
  // 参数校验
  const s3 = await withFixedClock(NOW, () => rt.callObject('lucky-record', 'submitEpds', { journeyId: jid, answers: [1, 2, 3] }, { token }))
  assert.equal(s3.errCode, 'PARAM_ERROR')
})

test('5-1-1 宫缩判定：规律 1 小时触发、零散不触发', async () => {
  const rt = createRuntime()
  const token = await freshUser(rt, 'user_d')
  const jid = await pregnantJourney(rt, token, '2026-01-01')
  const t0 = NOW - 90 * 60 * 1000
  // 规律宫缩：每 4.5 分钟一次、每次 70 秒、持续约 67 分钟 → 应触发
  for (let i = 0; i < 16; i++) {
    const s = await withFixedClock(NOW, () => rt.callObject('lucky-record', 'startTracker', { journeyId: jid, type: 'contraction', startedAt: t0 + i * 270 * 1000 }, { token }))
    await withFixedClock(NOW, () => rt.callObject('lucky-record', 'stopTracker', { journeyId: jid, sessionId: s.sessionId, endedAt: t0 + i * 270 * 1000 + 70 * 1000 }, { token }))
  }
  const adv = await withFixedClock(NOW, () => rt.callObject('lucky-record', 'contractionAdvice', { journeyId: jid }, { token }))
  assert.equal(adv.qualified, true, '规律宫缩应触发 5-1-1：' + JSON.stringify(adv))

  // 另一旅程：零散宫缩（间隔 20 分钟）→ 不触发
  const mk2 = await withFixedClock(NOW, () => rt.callObject('lucky-journey', 'createJourney', { mode: 'ttc' }, { token }))
  const c2 = await withFixedClock(NOW, () => rt.callObject('lucky-journey', 'confirmPregnancy', { journeyId: mk2.journeyId, eddSource: 'lmp', lmpDate: '2026-01-01' }, { token }))
  for (let i = 0; i < 4; i++) {
    const s = await withFixedClock(NOW, () => rt.callObject('lucky-record', 'startTracker', { journeyId: mk2.journeyId, type: 'contraction', startedAt: t0 + i * 1200 * 1000 }, { token }))
    await withFixedClock(NOW, () => rt.callObject('lucky-record', 'stopTracker', { journeyId: mk2.journeyId, sessionId: s.sessionId, endedAt: t0 + i * 1200 * 1000 + 60 * 1000 }, { token }))
  }
  const adv2 = await withFixedClock(NOW, () => rt.callObject('lucky-record', 'contractionAdvice', { journeyId: mk2.journeyId }, { token }))
  assert.equal(adv2.qualified, false)
})

test('成长百分位：正常区间与红线提示', async () => {
  const rt = createRuntime()
  const token = await freshUser(rt, 'user_e')
  const mk = await withFixedClock(NOW, () => rt.callObject('lucky-journey', 'createJourney', { mode: 'ttc' }, { token }))
  const del = await withFixedClock(NOW, () => rt.callObject('lucky-journey', 'registerDelivery', {
    journeyId: mk.journeyId, deliveryDate: '2026-07-26', babies: [{ nickname: '小满', sex: 'female', weightG: 3200, lengthCm: 50 }]
  }, { token }))
  const babyId = del.babyIds[0]
  // 3 月龄女孩 6.0kg → ~50 百分位
  const g1 = await withFixedClock(NOW, () => rt.callObject('lucky-baby', 'addGrowth', { journeyId: mk.journeyId, babyId, weightKg: 6.0, measureDate: '2026-10-26' }, { token }))
  assert.equal(g1.errCode, 0)
  assert.ok(g1.percentiles.weightPct >= 40 && g1.percentiles.weightPct <= 60, '6kg 应在中位附近：' + g1.percentiles.weightPct)
  // 2.5kg → <3rd 红线
  const g2 = await withFixedClock(NOW, () => rt.callObject('lucky-baby', 'addGrowth', { journeyId: mk.journeyId, babyId, weightKg: 2.5, measureDate: '2026-10-26' }, { token }))
  assert.ok(g2.alerts.length > 0, '低于第 3 百分位应有儿保沟通提示')
})

test('授权矩阵：strict 数据组不可授权，普通组可开关', async () => {
  const rt = createRuntime()
  const momToken = await freshUser(rt, 'mom_user')
  const dadToken = await freshUser(rt, 'dad_user')
  const mk = await withFixedClock(NOW, () => rt.callObject('lucky-journey', 'createJourney', { mode: 'ttc' }, { token: momToken }))
  await withFixedClock(NOW, () => rt.callObject('lucky-family', 'getFamily', { journeyId: mk.journeyId }, { token: momToken }))
  const inv = await withFixedClock(NOW, () => rt.callObject('lucky-family', 'invite', { journeyId: mk.journeyId, role: 'recorder' }, { token: momToken }))
  const join = await withFixedClock(NOW, () => rt.callObject('lucky-family', 'join', { code: inv.code, nickname: '爸爸' }, { token: dadToken }))
  assert.equal(join.errCode, 0)
  // intimate 组拒绝授权
  const deny = await withFixedClock(NOW, () => rt.callObject('lucky-family', 'setPermission', { journeyId: mk.journeyId, group: 'intimate', role: 'recorder', allow: true }, { token: momToken }))
  assert.equal(deny.errCode, 'PERMISSION_DENIED')
  // 普通组可关
  const okP = await withFixedClock(NOW, () => rt.callObject('lucky-family', 'setPermission', { journeyId: mk.journeyId, group: 'reports', role: 'viewer', allow: false }, { token: momToken }))
  assert.equal(okP.errCode, 0)
  // 非管理员不能改角色
  const notAdmin = await withFixedClock(NOW, () => rt.callObject('lucky-family', 'setRole', { journeyId: mk.journeyId, memberUserId: 'x', role: 'viewer' }, { token: dadToken }))
  assert.equal(notAdmin.errCode, 'NOT_FOUND')
})

test('红线判定：血压重度升高/症状红线词', async () => {
  const rt = createRuntime()
  const token = await freshUser(rt, 'user_f')
  const jid = await pregnantJourney(rt, token, '2026-01-01')
  const bp = await withFixedClock(NOW, () => rt.callObject('lucky-record', 'addMetric', { journeyId: jid, code: 'blood_pressure', value: { sbp: 168, dbp: 112 } }, { token }))
  assert.equal(bp.errCode, 0)
  assert.equal(bp.redline.level, 'critical')
  const sym = await withFixedClock(NOW, () => rt.callObject('lucky-record', 'addMetric', { journeyId: jid, code: 'symptom', value: { codes: ['bleeding'], severity: 2 } }, { token }))
  assert.equal(sym.redline.level, 'critical')
  // 指标白名单拦截
  const bad = await withFixedClock(NOW, () => rt.callObject('lucky-record', 'addMetric', { journeyId: jid, code: 'weight', value: { kg: 999 } }, { token }))
  assert.equal(bad.errCode, 'PARAM_ERROR')
  const unknown = await withFixedClock(NOW, () => rt.callObject('lucky-record', 'addMetric', { journeyId: jid, code: 'hacker_metric', value: {} }, { token }))
  assert.equal(unknown.errCode, 'PARAM_ERROR')
})

test('周期预测：近期加权均值 + 区间/置信度输出', async () => {
  const rt = createRuntime()
  const token = await freshUser(rt, 'user_g')
  const jid = await pregnantJourney(rt, token, '2026-01-01')
  // 3 个周期：9/1、9/29、10/26（长度 28、27）
  for (const d of ['2026-09-01', '2026-09-29', '2026-10-26']) {
    await withFixedClock(NOW, () => rt.callObject('lucky-record', 'addCycleEvent', { journeyId: jid, type: 'period_start', date: d }, { token }))
  }
  const list = await withFixedClock(NOW, () => rt.callObject('lucky-record', 'listCycleEvents', { journeyId: jid }, { token }))
  assert.equal(list.errCode, 0)
  // 近期加权：(28×1 + 27×2)/3 = 27.33 → 27（新周期权重更高）
  assert.equal(list.prediction.avgCycleLength, 27)
  assert.equal(list.prediction.regular, true)
  // 下次月经 = 10/26 + 27 = 11/22；排卵 = 11/8；预测带 ±1 天不确定区间
  assert.equal(list.prediction.nextPeriodDate, '2026-11-22')
  assert.equal(list.prediction.ovulationDate, '2026-11-08')
  assert.equal(list.prediction.uncertaintyDays, 1)
  assert.equal(list.prediction.nextPeriodRange.earliest, '2026-11-21')
  assert.equal(list.prediction.nextPeriodRange.latest, '2026-11-23')
  // 仅 2 个周期长度，样本不足 → 置信度仍为 low（周期数与规律度共同决定）
  assert.equal(list.prediction.confidence, 'low')
  // 强阳试纸覆盖日历预测
  await withFixedClock(NOW, () => rt.callObject('lucky-record', 'addCycleEvent', { journeyId: jid, type: 'ovulation_test', date: '2026-11-07', value: { result: 'strong_positive' } }, { token }))
  const list2 = await withFixedClock(NOW, () => rt.callObject('lucky-record', 'listCycleEvents', { journeyId: jid }, { token }))
  assert.equal(list2.prediction.basedOn, 'ovulation_test')
  assert.equal(list2.prediction.ovulationDate, '2026-11-07')
  // 易孕窗随不确定度外扩：11/7 前后 ±(2+1) 天起
  assert.ok(list2.prediction.fertileWindow.from <= '2026-11-04')
  assert.ok(list2.prediction.fertileWindow.to >= '2026-11-08')
})

test('周期预测：BBT 双相证据参与排卵定位', async () => {
  const rt = createRuntime()
  const token = await freshUser(rt, 'user_bbt')
  const jid = await pregnantJourney(rt, token, '2026-01-01')
  // 2 个周期：10/1、10/29（保证 lastStart 存在）
  for (const d of ['2026-10-01', '2026-10-29']) {
    await withFixedClock(NOW, () => rt.callObject('lucky-record', 'addCycleEvent', { journeyId: jid, type: 'period_start', date: d }, { token }))
  }
  // 本周期（10/29 起）BBT：3 天 36.4 低温相 → 4 天 36.9 高温相（升温 0.5°C）
  for (const d of ['2026-10-29', '2026-10-30', '2026-10-31']) {
    await withFixedClock(NOW, () => rt.callObject('lucky-record', 'addCycleEvent', { journeyId: jid, type: 'bbt', date: d, value: { tempC: 36.4 } }, { token }))
  }
  for (const d of ['2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04']) {
    await withFixedClock(NOW, () => rt.callObject('lucky-record', 'addCycleEvent', { journeyId: jid, type: 'bbt', date: d, value: { tempC: 36.9 } }, { token }))
  }
  const list = await withFixedClock(NOW, () => rt.callObject('lucky-record', 'listCycleEvents', { journeyId: jid }, { token }))
  assert.equal(list.errCode, 0)
  assert.equal(list.prediction.basedOn, 'bbt')
  // 排卵日 = 高温首日 11/1
  assert.equal(list.prediction.ovulationDate, '2026-11-01')
})

test('周期预测：紊乱周期降低置信度并放大不确定度', async () => {
  const rt = createRuntime()
  const token = await freshUser(rt, 'user_irr')
  const jid = await pregnantJourney(rt, token, '2026-01-01')
  // 5 个起点 → 长度 [26, 40, 22, 35]，标准差约 7 天
  for (const d of ['2026-07-01', '2026-07-27', '2026-09-05', '2026-09-27', '2026-11-01']) {
    await withFixedClock(NOW, () => rt.callObject('lucky-record', 'addCycleEvent', { journeyId: jid, type: 'period_start', date: d }, { token }))
  }
  const list = await withFixedClock(NOW, () => rt.callObject('lucky-record', 'listCycleEvents', { journeyId: jid }, { token }))
  assert.equal(list.errCode, 0)
  assert.equal(list.prediction.regular, false)
  assert.equal(list.prediction.confidence, 'low')
  assert.equal(list.prediction.uncertaintyDays, 5)
  // 区间显著放宽：earliest 与 latest 相距 10 天
  const range = Date.parse(list.prediction.nextPeriodRange.latest) - Date.parse(list.prediction.nextPeriodRange.earliest)
  assert.equal(range, 10 * 86400000)
})

test('白带记录：枚举校验与落库', async () => {
  const rt = createRuntime()
  const token = await freshUser(rt, 'user_mucus')
  const jid = await pregnantJourney(rt, token, '2026-01-01')
  const ok = await withFixedClock(NOW, () => rt.callObject('lucky-record', 'addCycleEvent', { journeyId: jid, type: 'mucus', date: '2026-10-26', value: { result: 'eggwhite' } }, { token }))
  assert.equal(ok.errCode, 0, JSON.stringify(ok))
  const bad = await withFixedClock(NOW, () => rt.callObject('lucky-record', 'addCycleEvent', { journeyId: jid, type: 'mucus', value: { result: 'hacker' } }, { token }))
  assert.equal(bad.errCode, 'PARAM_ERROR', '非法枚举必须拒绝')
  // 试纸照片地址可随事件落库（超长拒绝）
  const photo = await withFixedClock(NOW, () => rt.callObject('lucky-record', 'addCycleEvent', { journeyId: jid, type: 'ovulation_test', value: { result: 'weak_positive', photoUrl: 'cloud://test.jpg' } }, { token }))
  assert.equal(photo.errCode, 0, JSON.stringify(photo))
  const longUrl = await withFixedClock(NOW, () => rt.callObject('lucky-record', 'addCycleEvent', { journeyId: jid, type: 'ovulation_test', value: { result: 'weak_positive', photoUrl: 'x'.repeat(301) } }, { token }))
  assert.equal(longUrl.errCode, 'PARAM_ERROR')
})

test('家庭移除成员：owner 按 user_id 移除后成员消失', async () => {
  const rt = createRuntime()
  const momToken = await freshUser(rt, 'mom_rm')
  const dadToken = await freshUser(rt, 'dad_rm')
  const mk = await withFixedClock(NOW, () => rt.callObject('lucky-journey', 'createJourney', { mode: 'ttc' }, { token: momToken }))
  await withFixedClock(NOW, () => rt.callObject('lucky-family', 'getFamily', { journeyId: mk.journeyId }, { token: momToken }))
  const inv = await withFixedClock(NOW, () => rt.callObject('lucky-family', 'invite', { journeyId: mk.journeyId, role: 'recorder' }, { token: momToken }))
  await withFixedClock(NOW, () => rt.callObject('lucky-family', 'join', { code: inv.code, nickname: '爸爸' }, { token: dadToken }))
  const fam = await withFixedClock(NOW, () => rt.callObject('lucky-family', 'getFamily', { journeyId: mk.journeyId }, { token: momToken }))
  const dad = fam.members.find(m => m.role == 'recorder')
  assert.ok(dad != null && (dad.user_id ?? '').length > 0, '成员应携带 user_id')
  const rm = await withFixedClock(NOW, () => rt.callObject('lucky-family', 'removeMember', { journeyId: mk.journeyId, memberUserId: dad.user_id }, { token: momToken }))
  assert.equal(rm.errCode, 0)
  const fam2 = await withFixedClock(NOW, () => rt.callObject('lucky-family', 'getFamily', { journeyId: mk.journeyId }, { token: momToken }))
  assert.equal(fam2.members.length, 1, '移除后仅剩管理员')
  // 被移除后爸爸丧失写权限
  const blocked = await withFixedClock(NOW, () => rt.callObject('lucky-record', 'addMetric', { journeyId: mk.journeyId, code: 'weight', value: { kg: 60 } }, { token: dadToken }))
  assert.equal(blocked.errCode, 'NOT_FOUND', '移除后应失去旅程写权限')
})

test('部署自检：lucky-seed.verifySeed 模板完整性与密钥告警', async () => {
  const rt = createRuntime()
  const seed = await withFixedClock(NOW, () => rt.callObject('lucky-seed', 'verifySeed', {}))
  assert.equal(seed.errCode, 0)
  assert.equal(seed.prenatalTemplates, 7)
  assert.equal(seed.vaccineProgram, 22)
  assert.equal(seed.epdsItems, 10)
  assert.equal(seed.milestones, 14)
  // 告警必须与实际密钥来源一致：开发默认值告警，正式密钥不告警
  const secretIsDev = require(`${CLOUD_ROOT}/cloudfunctions/lucky-seed/common/lucky-auth-common`).loadSecret().startsWith('lb-dev-secret')
  assert.equal(seed.problems.some(x => String(x).includes('tokenSecret')), secretIsDev, 'tokenSecret 告警应与实际密钥来源一致')
})

test('登录限速：同账号连续失败 10 次后锁定', async () => {
  const rt = createRuntime()
  const reg = await withFixedClock(NOW, () => rt.callObject('lucky-id', 'register', { username: 'lockme99', password: 'password123' }))
  assert.equal(reg.errCode, 0)
  let last = null
  for (let i = 0; i < 11; i++) {
    last = await withFixedClock(NOW, () => rt.callObject('lucky-id', 'login', { username: 'lockme99', password: 'wrong-pass-' + i }))
  }
  assert.equal(last.errCode, 'TOO_MANY_REQUESTS', '第 11 次应被限速: ' + JSON.stringify(last))
  // 正确密码也被拒绝（锁定期间）
  const ok = await withFixedClock(NOW, () => rt.callObject('lucky-id', 'login', { username: 'lockme99', password: 'password123' }))
  assert.equal(ok.errCode, 'TOO_MANY_REQUESTS')
})

test('撤回注销：匿名入口连续失败后按账号+IP 限速', async () => {
  const rt = createRuntime()
  const reg = await withFixedClock(NOW, () => rt.callObject('lucky-id', 'register', { username: 'cancelme99', password: 'password123' }))
  assert.equal(reg.errCode, 0)
  let last = null
  for (let i = 0; i < 11; i++) {
    last = await withFixedClock(NOW, () => rt.callObject('lucky-id', 'cancelDeletion', { username: 'cancelme99', password: 'wrong-pass-' + i }))
  }
  assert.equal(last.errCode, 'TOO_MANY_REQUESTS', '第 11 次应被限速: ' + JSON.stringify(last))
  // 阳性对照：额度内正确密码仍可撤回（本用例账号未申请注销，返回状态错误而非限速）
  const rt2 = createRuntime()
  await withFixedClock(NOW, () => rt2.callObject('lucky-id', 'register', { username: 'cancelok99', password: 'password123' }))
  const blocked = await withFixedClock(NOW, () => rt2.callObject('lucky-id', 'cancelDeletion', { username: 'cancelok99', password: 'password123' }))
  assert.equal(blocked.errCode, 'STATE_ERROR', '正确密码不应被限流: ' + JSON.stringify(blocked))
})
