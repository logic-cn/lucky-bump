/**
 * 哀伤模式服务端门禁（安全审计 H6）
 * 产品红线：流产/胎停后零营销推送、零孕育类待办。
 * 当前推送尚未实现，但门禁必须先在服务端成立，否则接入推送即违约。
 */
const test = require('node:test')
const assert = require('node:assert')
const { createRuntime } = require('../harness/unicloud-mock')

async function mourningJourney() {
  const rt = createRuntime()
  const reg = await rt.callObject('lucky-id', 'register', { username: 'mourn01', password: 'password123' })
  // mode 合法值：ttc / pregnant（pregnant 需 eddSource + lmpDate）
  const mk = await rt.callObject('lucky-journey', 'createJourney', { mode: 'pregnant', eddSource: 'lmp', lmpDate: '2026-03-01', title: '这段旅程' }, { token: reg.token })
  assert.equal(mk.errCode, 0, JSON.stringify(mk))
  const jid = mk.journeyId
  // 造出真实待办：绝对日期提醒
  const rule = await rt.callObject('lucky-reminder', 'addRule', { journeyId: jid, title: '糖耐复查', type: 'absolute', anchorDate: '2026-12-01' }, { token: reg.token })
  assert.equal(rule.errCode, 0, JSON.stringify(rule))
  // 进入哀伤模式
  const m = await rt.callObject('lucky-journey', 'registerMourning', { journeyId: jid, reason: '胎停' }, { token: reg.token })
  assert.equal(m.errCode, 0, JSON.stringify(m))
  return { rt, jid, token: reg.token }
}

test('H6：MOURNING 旅程的 listDue 返回空待办', async () => {
  const { rt, jid, token } = await mourningJourney()
  const r = await rt.callObject('lucky-reminder', 'listDue', { journeyId: jid, days: 60 }, { token })
  assert.equal(r.errCode, 0, JSON.stringify(r))
  assert.deepEqual(r.todos, [], 'H6：哀伤模式下仍生成待办')
})

test('H6：MOURNING 旅程的 today 不返回待办且结构完整', async () => {
  const { rt, jid, token } = await mourningJourney()
  const t = await rt.callObject('lucky-data', 'today', { journeyId: jid }, { token })
  assert.equal(t.errCode, 0, JSON.stringify(t))
  assert.deepEqual(t.todos, [], 'H6：哀伤模式首页仍返回待办')
  assert.ok(t.journey, '前端依赖 journey 字段，门禁短路也必须返回')
  assert.equal(t.journey.stage, 'MOURNING', 'stage 应标识哀伤模式')
})

test('H6 对照：非哀伤旅程仍正常生成待办（防门禁误伤）', async () => {
  const rt = createRuntime()
  const reg = await rt.callObject('lucky-id', 'register', { username: 'normal01', password: 'password123' })
  const mk = await rt.callObject('lucky-journey', 'createJourney', { mode: 'pregnant', eddSource: 'lmp', lmpDate: '2026-03-01', title: '正常' }, { token: reg.token })
  assert.equal(mk.errCode, 0, JSON.stringify(mk))
  const jid = mk.journeyId
  await rt.callObject('lucky-reminder', 'addRule', { journeyId: jid, title: '产检', type: 'absolute', anchorDate: '2026-12-01' }, { token: reg.token })
  const r = await rt.callObject('lucky-reminder', 'listDue', { journeyId: jid, days: 60 }, { token: reg.token })
  assert.equal(r.errCode, 0, JSON.stringify(r))
  assert.ok(r.todos.length > 0, '非哀伤旅程应正常返回待办')
})
