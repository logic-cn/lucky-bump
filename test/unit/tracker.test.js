/**
 * 计时器恢复：服务端为准（docs/03 M5 锁屏后台运行）
 */
const test = require('node:test')
const assert = require('node:assert')
const { createRuntime } = require('../harness/unicloud-mock')

async function ctx() {
  const rt = createRuntime()
  const r = await rt.callObject('lucky-id', 'register', { username: 'timer01', password: 'password123' })
  const mk = await rt.callObject('lucky-journey', 'createJourney', { mode: 'pregnant', title: '计时', eddSource: 'lmp', lmpDate: '2026-09-01' }, { token: r.token })
  return { rt, jid: mk.journeyId, token: r.token }
}

test('activeOnly 只返回未结束的会话', async () => {
  const { rt, jid, token } = await ctx()
  // 开始一个会话但不结束
  const s1 = await rt.callObject('lucky-record', 'startTracker', { journeyId: jid, type: 'nursing', side: 'left' }, { token })
  assert.equal(s1.errCode, 0, JSON.stringify(s1))
  // 另一个会话：开始后立即结束
  const s2 = await rt.callObject('lucky-record', 'startTracker', { journeyId: jid, type: 'nursing', side: 'right' }, { token })
  await rt.callObject('lucky-record', 'stopTracker', { journeyId: jid, sessionId: s2.sessionId }, { token })

  const active = await rt.callObject('lucky-record', 'listTrackers', { journeyId: jid, type: 'nursing', activeOnly: true }, { token })
  assert.equal(active.errCode, 0, JSON.stringify(active))
  assert.equal(active.sessions.length, 1, '应只返回 1 条未结束会话')
  assert.equal(active.sessions[0]._id, s1.sessionId)
  assert.equal(active.sessions[0].ended_at, 0)

  const all = await rt.callObject('lucky-record', 'listTrackers', { journeyId: jid, type: 'nursing' }, { token })
  assert.equal(all.sessions.length, 2, '不带 activeOnly 应返回全部')
})

test('activeOnly：无未结束会话时返回空数组', async () => {
  const { rt, jid, token } = await ctx()
  const s = await rt.callObject('lucky-record', 'startTracker', { journeyId: jid, type: 'contraction' }, { token })
  await rt.callObject('lucky-record', 'stopTracker', { journeyId: jid, sessionId: s.sessionId }, { token })
  const active = await rt.callObject('lucky-record', 'listTrackers', { journeyId: jid, type: 'contraction', activeOnly: true }, { token })
  assert.equal(active.errCode, 0, JSON.stringify(active))
  assert.equal(active.sessions.length, 0, '全部结束后 activeOnly 应为空')
})
