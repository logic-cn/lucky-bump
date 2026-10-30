/**
 * 分娩登记后的产褥期日程（docs/03 M4.1 / M4.3）
 * 验证：产检排程退场、42 天复查与 EPDS 2/4/6 周随访自动生成、重复登记幂等。
 */
const test = require('node:test')
const assert = require('node:assert')
const { createRuntime } = require('../harness/unicloud-mock')

async function pregnantSetup() {
  const rt = createRuntime()
  const reg = await rt.callObject('lucky-id', 'register', { username: 'mom2026', password: 'password123' })
  assert.equal(reg.errCode, 0, JSON.stringify(reg))
  const mk = await rt.callObject('lucky-journey', 'createJourney', {
    mode: 'pregnant', title: '孕期', lmpDate: '2026-01-01'
  }, { token: reg.token })
  assert.equal(mk.errCode, 0, JSON.stringify(mk))
  const jid = mk.journeyId
  const plan = await rt.callObject('lucky-care', 'generatePlan', { journeyId: jid }, { token: reg.token })
  assert.equal(plan.errCode, 0, JSON.stringify(plan))
  assert.ok(plan.count > 0, '前置条件失败：应生成产检排程')
  return { rt, jid, token: reg.token }
}

test('分娩登记：产检排程退场，生成 42 天复查与 EPDS 随访', async () => {
  const { rt, jid, token } = await pregnantSetup()
  const del = await rt.callObject('lucky-journey', 'registerDelivery', {
    journeyId: jid, deliveryDate: '2026-10-30', deliveryMode: 'vaginal', hospital: '市妇幼',
    babies: [{ nickname: '小满', sex: 'female', weightG: 3200, lengthCm: 50 }]
  }, { token })
  assert.equal(del.errCode, 0, JSON.stringify(del))
  assert.ok(del.postpartum.clearedPrenatal > 0, '未完成的产检排程应被清空')
  assert.equal(del.postpartum.followUps, 4, '应生成 42 天复查 + 3 次 EPDS 随访')

  const plan = await rt.callObject('lucky-care', 'listPlan', { journeyId: jid }, { token })
  assert.equal(plan.errCode, 0, JSON.stringify(plan))
  const upcoming = plan.items.filter(x => x.displayStatus === 'upcoming' || x.displayStatus === 'due')
  assert.equal(upcoming.length, 0, '产后不应再有待办产检')
  assert.equal(plan.next, null, '不应再返回下一次产检')

  const rules = await rt.callObject('lucky-reminder', 'listRules', { journeyId: jid }, { token })
  const titles = rules.rules.map(r => r.title)
  assert.ok(titles.includes('产后 42 天复查'), '缺少 42 天复查提醒')
  assert.ok(titles.includes('产后情绪自评（2 周）'), '缺少 EPDS 2 周随访')
  assert.ok(titles.includes('产后情绪自评（4 周）'), '缺少 EPDS 4 周随访')
  assert.ok(titles.includes('产后情绪自评（6 周）'), '缺少 EPDS 6 周随访')
  const recheck = rules.rules.find(r => r.title === '产后 42 天复查')
  assert.equal(recheck.anchor_date, '2026-12-11', '42 天复查日期应为分娩日 + 42 天')
  assert.equal(recheck.urgent, true)

  const due = await rt.callObject('lucky-reminder', 'listDue', { journeyId: jid, days: 60 }, { token })
  assert.equal(due.errCode, 0, JSON.stringify(due))
  assert.ok(due.todos.some(t => t.title === '产后 42 天复查'), '随访提醒应进入待办投影')
})

test('重复登记分娩：随访提醒幂等，不产生重复待办', async () => {
  const { rt, jid, token } = await pregnantSetup()
  const first = await rt.callObject('lucky-journey', 'registerDelivery', {
    journeyId: jid, deliveryDate: '2026-10-30',
    babies: [{ nickname: '宝宝', sex: 'female', weightG: 3000, lengthCm: 50 }]
  }, { token })
  assert.equal(first.postpartum.followUps, 4)
  const second = await rt.callObject('lucky-journey', 'registerDelivery', {
    journeyId: jid, deliveryDate: '2026-10-30',
    babies: [{ nickname: '宝宝', sex: 'female', weightG: 3000, lengthCm: 50 }]
  }, { token })
  assert.equal(second.errCode, 0, JSON.stringify(second))
  assert.equal(second.postpartum.followUps, 0, '重复登记不应再生成随访提醒')

  const rules = await rt.callObject('lucky-reminder', 'listRules', { journeyId: jid }, { token })
  assert.equal(rules.rules.length, 4, '随访提醒总数应保持 4 条')
})
