/**
 * 提醒完成闭环：打勾回写后从 listDue 与 today 中移除，且幂等
 */
const test = require('node:test')
const assert = require('node:assert')
const { createRuntime } = require('../harness/unicloud-mock')

async function setup() {
  const rt = createRuntime()
  const reg = await rt.callObject('lucky-id', 'register', { username: 'remDone', password: 'password123' })
  assert.equal(reg.errCode, 0, JSON.stringify(reg))
  const mk = await rt.callObject('lucky-journey', 'createJourney', { mode: 'ttc', title: '提醒旅程' }, { token: reg.token })
  assert.equal(mk.errCode, 0, JSON.stringify(mk))
  const jid = mk.journeyId
  const today = await rt.callObject('lucky-data', 'today', { journeyId: jid }, { token: reg.token })
  const date = today.serverDate
  return { rt, token: reg.token, jid, date }
}

test('提醒完成：listDue 与 today 同时移除，重复完成幂等', async () => {
  const { rt, token, jid, date } = await setup()
  const rule = await rt.callObject('lucky-reminder', 'addRule', {
    journeyId: jid, title: '叶酸打卡', type: 'absolute', anchorDate: date, leadDays: 0
  }, { token })
  assert.equal(rule.errCode, 0, JSON.stringify(rule))

  const before = await rt.callObject('lucky-reminder', 'listDue', { journeyId: jid }, { token })
  assert.ok(before.todos.some(t => t.ruleId === rule.ruleId), '完成前应出现在待办')

  const done = await rt.callObject('lucky-reminder', 'completeTodo', {
    journeyId: jid, ruleId: rule.ruleId, dueDate: date
  }, { token })
  assert.equal(done.errCode, 0, JSON.stringify(done))

  const after = await rt.callObject('lucky-reminder', 'listDue', { journeyId: jid }, { token })
  assert.ok(!after.todos.some(t => t.ruleId === rule.ruleId), '完成后应移出 listDue')

  const today = await rt.callObject('lucky-data', 'today', { journeyId: jid }, { token })
  assert.ok(!today.todos.some(t => t.ruleId === rule.ruleId), '完成后应移出首页今日待办')

  const again = await rt.callObject('lucky-reminder', 'completeTodo', {
    journeyId: jid, ruleId: rule.ruleId, dueDate: date
  }, { token })
  assert.equal(again.errCode, 0, '重复完成应幂等')
})

test('删除提醒：列表不再返回该规则', async () => {
  const { rt, token, jid, date } = await setup()
  const rule = await rt.callObject('lucky-reminder', 'addRule', {
    journeyId: jid, title: '可删除提醒', type: 'absolute', anchorDate: date
  }, { token })
  assert.equal(rule.errCode, 0, JSON.stringify(rule))
  const del = await rt.callObject('lucky-reminder', 'removeRule', { ruleId: rule.ruleId }, { token })
  assert.equal(del.errCode, 0, JSON.stringify(del))
  const list = await rt.callObject('lucky-reminder', 'listRules', { journeyId: jid }, { token })
  assert.ok(!list.rules.some(r => r._id === rule.ruleId), '删除后列表不应再返回该提醒')
})
