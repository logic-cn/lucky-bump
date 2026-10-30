/**
 * 最小埋点（lucky-analytics）：白名单、属性脱敏、鉴权。
 */
const test = require('node:test')
const assert = require('node:assert')
const { createRuntime } = require('../harness/unicloud-mock')

async function setup() {
  const rt = createRuntime()
  const reg = await rt.callObject('lucky-id', 'register', { username: 'track01', password: 'password123' })
  assert.equal(reg.errCode, 0, JSON.stringify(reg))
  const mk = await rt.callObject('lucky-journey', 'createJourney', { mode: 'ttc', title: '旅程' }, { token: reg.token })
  return { rt, token: reg.token, jid: mk.journeyId }
}

test('埋点：只接收白名单事件并按天落库', async () => {
  const { rt, token, jid } = await setup()
  const res = await rt.callObject('lucky-analytics', 'report', {
    events: [
      { event: 'record_create', journeyId: jid, props: { type: 'weight' }, ts: 1793340000000 },
      { event: 'unknown_event', journeyId: jid, ts: 1793340000000 },
      { event: 'export_done', journeyId: jid, ts: 1793340000000 }
    ]
  }, { token })
  assert.equal(res.errCode, 0, JSON.stringify(res))
  assert.equal(res.accepted, 2, '非法事件应被丢弃')

  const rows = await rt.db.collection('lb-events').where({ journey_id: jid }).get()
  assert.equal(rows.data.length, 2)
  const types = rows.data.map(r => r.event).sort()
  assert.deepEqual(types, ['export_done', 'record_create'])
  assert.ok(rows.data[0].date.length == 10, '应落 date 便于按天聚合')
})

test('埋点：props 只保留短值，防止健康文本入库', async () => {
  const { rt, token, jid } = await setup()
  const longText = '这是一段很长的健康内容不应该进入事件表'.repeat(3)
  await rt.callObject('lucky-analytics', 'report', {
    events: [{ event: 'record_create', journeyId: jid, props: { type: 'weight', note: longText } }]
  }, { token })
  const rows = await rt.db.collection('lb-events').where({ journey_id: jid }).get()
  assert.equal(rows.data.length, 1)
  const note = rows.data[0].props.note
  assert.ok(note.length <= 24, '长文本必须截断')
})

test('埋点：未登录拒绝上报', async () => {
  const { rt } = await setup()
  const res = await rt.callObject('lucky-analytics', 'report', { events: [{ event: 'app_launch' }] })
  assert.equal(res.errCode, 'TOKEN_INVALID')
})
