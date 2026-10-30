/**
 * 注销冷静期满后的物理删除（lucky-maintenance）
 * 验证：到期账号的数据被彻底清除、未到期账号原样保留、单个账号失败不阻塞其余账号。
 */
const test = require('node:test')
const assert = require('node:assert')
const { createRuntime } = require('../harness/unicloud-mock')
const { purgeDueUsers } = require('../../uniCloud-aliyun/cloudfunctions/lucky-maintenance')

const DAY = 24 * 3600 * 1000

async function seedUser(rt, username) {
  const reg = await rt.callObject('lucky-id', 'register', { username, password: 'password123' })
  assert.equal(reg.errCode, 0, JSON.stringify(reg))
  const mk = await rt.callObject('lucky-journey', 'createJourney', { mode: 'ttc', title: '旅程' }, { token: reg.token })
  const jid = mk.journeyId
  await rt.callObject('lucky-record', 'addMetric', { journeyId: jid, code: 'weight', value: { kg: 60 } }, { token: reg.token })
  await rt.callObject('lucky-record', 'addDiary', { journeyId: jid, text: '今天很好' }, { token: reg.token })
  const uid = rt.store.get('uni-id-users')
    ? [...rt.store.get('uni-id-users').entries()].find(([, u]) => u.username === username)[0]
    : ''
  return { uid, jid, token: reg.token }
}

function storeCount(rt, name) {
  return rt.store.has(name) ? rt.store.get(name).size : 0
}

test('到期账号：业务数据、token、账号全部物理删除', async () => {
  const rt = createRuntime()
  const { uid, jid, token } = await seedUser(rt, 'purge01')
  await rt.callObject('lucky-id', 'requestDeletion', { password: 'password123' }, { token })
  // 模拟 30 天已到
  await rt.db.collection('uni-id-users').doc(uid).update({ purge_at: Date.now() - DAY })

  const res = await purgeDueUsers(rt.db, Date.now())
  assert.equal(res.errors.length, 0, JSON.stringify(res.errors))
  assert.equal(res.purged.length, 1)
  assert.equal(res.purged[0].journeys, 1)

  assert.equal(storeCount(rt, 'uni-id-users'), 0, '账号应被删除')
  assert.equal(storeCount(rt, 'lb-token'), 0, 'token 应被清除')
  const journeys = await rt.db.collection('lb-journeys').where({ _id: jid }).get()
  assert.equal(journeys.data.length, 0, '旅程应被删除')
  const diaries = await rt.db.collection('lb-diaries').where({ journey_id: jid }).get()
  assert.equal(diaries.data.length, 0, '日记应被删除')
  const logs = await rt.db.collection('lb-daily-logs').where({ journey_id: jid }).get()
  assert.equal(logs.data.length, 0, '指标应被删除')
})

test('未到冷静期结束的账号：不做任何删除', async () => {
  const rt = createRuntime()
  const { uid, jid } = await seedUser(rt, 'keep01')
  await rt.db.collection('uni-id-users').doc(uid).update({ status: 'pending_deletion', purge_at: Date.now() + 10 * DAY })

  const res = await purgeDueUsers(rt.db, Date.now())
  assert.equal(res.purged.length, 0)
  assert.equal(storeCount(rt, 'uni-id-users'), 1, '未到期账号不得删除')
  const journeys = await rt.db.collection('lb-journeys').where({ _id: jid }).get()
  assert.equal(journeys.data.length, 1, '未到期账号的旅程不得删除')
})

test('幂等：重复执行不报错且不误删其余账号', async () => {
  const rt = createRuntime()
  const a = await seedUser(rt, 'purge02')
  const b = await seedUser(rt, 'live02')
  await rt.db.collection('uni-id-users').doc(a.uid).update({ status: 'pending_deletion', purge_at: Date.now() - DAY })

  const first = await purgeDueUsers(rt.db, Date.now())
  const second = await purgeDueUsers(rt.db, Date.now())
  assert.equal(first.purged.length, 1)
  assert.equal(second.purged.length, 0, '第二次执行应无待清理账号')
  assert.equal(storeCount(rt, 'uni-id-users'), 1, '正常账号应保留')
  const alive = await rt.db.collection('uni-id-users').where({ _id: b.uid }).get()
  assert.equal(alive.data.length, 1)
})
