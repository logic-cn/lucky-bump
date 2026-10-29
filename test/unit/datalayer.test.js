/**
 * 数据层越权回归测试（安全审计 C2/C3/H2/H3/H4）
 * 全部场景：攻击者没有该旅程的任何权限，但知道 journeyId
 */
const test = require('node:test')
const assert = require('node:assert')
const { createRuntime } = require('../harness/unicloud-mock')

async function twoUsers() {
  const rt = createRuntime()
  const victim = await rt.callObject('lucky-id', 'register', { username: 'victim01', password: 'password123' })
  const mk = await rt.callObject('lucky-journey', 'createJourney', { mode: 'ttc', title: '受害者旅程' }, { token: victim.token })
  const jid = mk.journeyId
  await rt.callObject('lucky-record', 'addMetric', { journeyId: jid, code: 'weight', value: { kg: 55.5 } }, { token: victim.token })
  await rt.callObject('lucky-record', 'addCycleEvent', { journeyId: jid, type: 'period_start', date: '2026-10-01' }, { token: victim.token })
  await rt.callObject('lucky-record', 'startTracker', { journeyId: jid, type: 'nursing', side: 'left' }, { token: victim.token })
  await rt.callObject('lucky-reminder', 'addRule', { journeyId: jid, title: '产检提醒', type: 'absolute', anchorDate: '2026-12-01' }, { token: victim.token })
  const attacker = await rt.callObject('lucky-id', 'register', { username: 'attacker1', password: 'password123' })
  return { rt, jid, victimToken: victim.token, attackerToken: attacker.token }
}

test('C2：listMetrics 拒绝无关用户', async () => {
  const { rt, jid, attackerToken } = await twoUsers()
  const r = await rt.callObject('lucky-record', 'listMetrics', { journeyId: jid }, { token: attackerToken })
  assert.equal(r.errCode, 'NOT_FOUND', 'C2 未修复：任意用户可凭 journeyId 读他人健康指标')
})

test('C3：listCycleEvents 拒绝无关用户', async () => {
  const { rt, jid, attackerToken } = await twoUsers()
  const r = await rt.callObject('lucky-record', 'listCycleEvents', { journeyId: jid }, { token: attackerToken })
  assert.equal(r.errCode, 'NOT_FOUND', 'C3 未修复：任意用户可读他人经期数据')
})

test('H3：latestMetrics 拒绝无关用户', async () => {
  const { rt, jid, attackerToken } = await twoUsers()
  const r = await rt.callObject('lucky-record', 'latestMetrics', { journeyId: jid, codes: ['weight'] }, { token: attackerToken })
  assert.equal(r.errCode, 'NOT_FOUND', 'H3 未修复：可读他人最新指标')
})

test('H3：latestMetrics 对合法用户仍能取到本人记录（防修复过度）', async () => {
  const { rt, jid, victimToken } = await twoUsers()
  const r = await rt.callObject('lucky-record', 'latestMetrics', { journeyId: jid, codes: ['weight'] }, { token: victimToken })
  assert.equal(r.errCode, 0, JSON.stringify(r))
  assert.ok(r.latest && r.latest.weight, '主人应能取到自己的最新体重')
  assert.equal(r.latest.weight.value.kg, 55.5)
})

test('H4：listTrackers / contractionAdvice 拒绝无关用户', async () => {
  const { rt, jid, attackerToken } = await twoUsers()
  const a = await rt.callObject('lucky-record', 'listTrackers', { journeyId: jid }, { token: attackerToken })
  assert.equal(a.errCode, 'NOT_FOUND', 'H4：listTrackers 越权')
  const b = await rt.callObject('lucky-record', 'contractionAdvice', { journeyId: jid }, { token: attackerToken })
  assert.equal(b.errCode, 'NOT_FOUND', 'H4：contractionAdvice 越权')
})

test('H2：listRules 拒绝无关用户', async () => {
  const { rt, jid, attackerToken } = await twoUsers()
  const r = await rt.callObject('lucky-reminder', 'listRules', { journeyId: jid }, { token: attackerToken })
  assert.equal(r.errCode, 'NOT_FOUND', 'H2 未修复：可读他人提醒规则')
})

test('H2：updateRule 拒绝篡改他人提醒', async () => {
  const { rt, jid, victimToken, attackerToken } = await twoUsers()
  const list = await rt.callObject('lucky-reminder', 'listRules', { journeyId: jid }, { token: victimToken })
  const ruleId = list.rules[0]._id
  const up = await rt.callObject('lucky-reminder', 'updateRule', { ruleId, enabled: false }, { token: attackerToken })
  assert.equal(up.errCode, 'NOT_FOUND', 'H2 未修复：可关闭他人产检提醒')
  const after = await rt.callObject('lucky-reminder', 'listRules', { journeyId: jid }, { token: victimToken })
  assert.equal(after.rules[0].enabled, true, '提醒规则被越权修改')
})

test('回归：合法用户仍可正常读写自己的数据', async () => {
  const { rt, jid, victimToken } = await twoUsers()
  const m = await rt.callObject('lucky-record', 'listMetrics', { journeyId: jid }, { token: victimToken })
  assert.equal(m.errCode, 0, JSON.stringify(m))
  assert.equal(m.records.length, 1, '应能读到自己的 1 条体重记录')
  const c = await rt.callObject('lucky-record', 'listCycleEvents', { journeyId: jid }, { token: victimToken })
  assert.equal(c.errCode, 0, JSON.stringify(c))
  assert.ok(c.events.length >= 1, '应能读到自己的经期事件')
  const t = await rt.callObject('lucky-record', 'listTrackers', { journeyId: jid }, { token: victimToken })
  assert.equal(t.errCode, 0, JSON.stringify(t))
  assert.equal(t.sessions.length, 1, '应能读到自己的计时会话')
  const rl = await rt.callObject('lucky-reminder', 'listRules', { journeyId: jid }, { token: victimToken })
  assert.equal(rl.errCode, 0, JSON.stringify(rl))
  assert.equal(rl.rules.length, 1, '应能读到自己的提醒规则')
})

/* ---------------- C1：timeline 聚合不得泄露 strict ---------------- */

test('C1：timeline 不得向家庭成员泄露 strict 事件', async () => {
  const { rt, jid, victimToken, attackerToken } = await twoUsers()
  // 先建家庭组（invite 前置条件）
  const fam = await rt.callObject('lucky-family', 'getFamily', { journeyId: jid }, { token: victimToken })
  assert.equal(fam.errCode, 0, JSON.stringify(fam))
  const inv = await rt.callObject('lucky-family', 'invite', { journeyId: jid, role: 'viewer' }, { token: victimToken })
  assert.equal(inv.errCode, 0, JSON.stringify(inv))
  await rt.callObject('lucky-family', 'join', { code: inv.code }, { token: attackerToken })
  // 受害者在加入后写一条同房记录（strict）
  const ev = await rt.callObject('lucky-record', 'addCycleEvent', { journeyId: jid, type: 'intercourse', date: '2026-10-05' }, { token: victimToken })
  assert.equal(ev.errCode, 0, JSON.stringify(ev))
  // 阳性对照：主人自己看得到
  const own = await rt.callObject('lucky-data', 'timeline', { journeyId: jid }, { token: victimToken })
  const ownStrict = (own.events || []).filter(e => e.sensitivity === 'strict')
  assert.ok(ownStrict.length > 0, '前置条件失败：主人自己应该能看到 strict 事件')
  // 攻击者（viewer）不得看到任何 strict 事件
  const tl = await rt.callObject('lucky-data', 'timeline', { journeyId: jid }, { token: attackerToken })
  assert.equal(tl.errCode, 0, JSON.stringify(tl))
  const strict = (tl.events || []).filter(e => e.sensitivity === 'strict')
  assert.equal(strict.length, 0, 'C1 未修复：timeline 向家庭成员泄露 strict 事件')
})

test('C4：exportAll 不得导出他人 strict 数据', async () => {
  const { rt, jid, victimToken, attackerToken } = await twoUsers()
  // 先建家庭组（invite 前置条件）
  const fam = await rt.callObject('lucky-family', 'getFamily', { journeyId: jid }, { token: victimToken })
  assert.equal(fam.errCode, 0, JSON.stringify(fam))
  const inv = await rt.callObject('lucky-family', 'invite', { journeyId: jid, role: 'admin' }, { token: victimToken })
  assert.equal(inv.errCode, 0, JSON.stringify(inv))
  await rt.callObject('lucky-family', 'join', { code: inv.code }, { token: attackerToken })
  // 妈妈自己写一条 strict（阳性对照）
  const mom = await rt.callObject('lucky-record', 'addCycleEvent', { journeyId: jid, type: 'intercourse', date: '2026-10-06' }, { token: victimToken })
  assert.equal(mom.errCode, 0, JSON.stringify(mom))
  // 爸爸（admin）也写一条
  const dad = await rt.callObject('lucky-record', 'addCycleEvent', { journeyId: jid, type: 'intercourse', date: '2026-10-07' }, { token: attackerToken })
  assert.equal(dad.errCode, 0, JSON.stringify(dad))
  // 妈妈（owner）导出：应含自己的 strict，但不含爸爸的
  const ex = await rt.callObject('lucky-data', 'exportAll', { journeyId: jid }, { token: victimToken })
  assert.equal(ex.errCode, 0, JSON.stringify(ex))
  const events = (ex.data && ex.data['lb-cycle-events']) || []
  const strictEvents = events.filter(e => e.sensitivity === 'strict')
  assert.equal(strictEvents.length, 1, 'C4 未修复：导出应只保留本人 strict 记录（期望 1 条，实际 ' + strictEvents.length + ' 条）')
  assert.equal(strictEvents[0].date, '2026-10-06', 'C4：导出中残留了他人的 strict 记录')
})
