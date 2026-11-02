/**
 * 30 天清单回归：手机号登录、敏感信息同意、反馈、旅程管理、服务端埋点、看板权限
 */
const test = require('node:test')
const assert = require('node:assert')
const path = require('path')
const { createRuntime } = require('../harness/unicloud-mock')
const auth = require(path.resolve(__dirname, '../../uniCloud-aliyun/cloudfunctions/common/lucky-auth-common/index.js'))

const MOBILE = '13800138000'

async function seedCode(rt, code, opts = {}) {
  await rt.db.collection('lb-sms-codes').add({
    phone: opts.phone || MOBILE,
    code_hash: auth.hashPassword(code),
    purpose: 'login',
    expires_at: opts.expired ? Date.now() - 1000 : Date.now() + 300000,
    attempts: opts.attempts || 0,
    used: !!opts.used,
    ip: '127.0.0.1',
    created_at: Date.now()
  })
}

async function register(rt, username = 'u_' + Math.random().toString(36).slice(2, 8)) {
  const r = await rt.callObject('lucky-id', 'register', { username, password: 'password123' })
  assert.equal(r.errCode, 0, JSON.stringify(r))
  return r
}

test('手机号验证码登录：新手机号自动建号并签发 token', async () => {
  const rt = createRuntime()
  await seedCode(rt, '123456')
  const res = await rt.callObject('lucky-id', 'loginBySms', { mobile: MOBILE, code: '123456' })
  assert.equal(res.errCode, 0, JSON.stringify(res))
  assert.ok(res.token && res.isNew == true, '新号应自动创建并返回 token')
  const prof = await rt.callObject('lucky-id', 'getProfile', {}, { token: res.token })
  assert.equal(prof.userInfo.mobile, MOBILE)
  assert.equal(prof.userInfo.opsAdmin, false, '默认不是运营管理员')
  const rows = await rt.db.collection('lb-sms-codes').where({ phone: MOBILE }).get()
  assert.equal(rows.data[0].used, true, '验证码只能使用一次')
})

test('手机号验证码登录：错误/过期/复用均被拒绝', async () => {
  const rt = createRuntime()
  await seedCode(rt, '123456')
  const wrong = await rt.callObject('lucky-id', 'loginBySms', { mobile: MOBILE, code: '000000' })
  assert.equal(wrong.errCode, 'CODE_ERROR')
  const rows = await rt.db.collection('lb-sms-codes').where({ phone: MOBILE }).get()
  assert.equal(rows.data[0].attempts, 1, '失败应累计尝试次数')

  const rt2 = createRuntime()
  await seedCode(rt2, '123456', { expired: true })
  const expired = await rt2.callObject('lucky-id', 'loginBySms', { mobile: MOBILE, code: '123456' })
  assert.equal(expired.errCode, 'CODE_EXPIRED')
})

test('短信服务未配置时返回 CONFIG_MISSING，不阻断账号密码登录', async () => {
  const rt = createRuntime()
  const res = await rt.callObject('lucky-id', 'sendSmsCode', { mobile: MOBILE })
  assert.equal(res.errCode, 'CONFIG_MISSING')
  const reg = await register(rt, 'pw_login_1')
  const login = await rt.callObject('lucky-id', 'login', { username: 'pw_login_1', password: 'password123' })
  assert.equal(login.errCode, 0, '账号密码登录必须保持可用')
  assert.ok(reg.token && login.token)
})

test('敏感信息单独同意与反馈提交', async () => {
  const rt = createRuntime()
  const reg = await register(rt)
  const consent = await rt.callObject('lucky-id', 'recordConsent', { sensitiveVersion: 'v1.0', privacyVersion: 'v1.0' }, { token: reg.token })
  assert.equal(consent.errCode, 0, JSON.stringify(consent))
  const prof = await rt.callObject('lucky-id', 'getProfile', {}, { token: reg.token })
  assert.equal(prof.userInfo.sensitiveConsentVersion, 'v1.0')
  assert.ok(prof.userInfo.sensitiveConsentAt > 0)

  const bad = await rt.callObject('lucky-id', 'submitFeedback', { content: '短' }, { token: reg.token })
  assert.equal(bad.errCode, 'PARAM_ERROR')
  const ok = await rt.callObject('lucky-id', 'submitFeedback', { content: '希望增加导出提醒', contact: 'a@b.com', platform: 'web' }, { token: reg.token })
  assert.equal(ok.errCode, 0, JSON.stringify(ok))
  const rows = await rt.db.collection('lb-feedback').where({ user_id: prof.userInfo.id }).get()
  assert.equal(rows.data.length, 1)
  assert.equal(rows.data[0].status, 'open')
})

test('旅程管理：创建即当前、切换、重命名、归档后回退', async () => {
  const rt = createRuntime()
  const reg = await register(rt)
  const ctx = { token: reg.token }
  const j1 = await rt.callObject('lucky-journey', 'createJourney', { mode: 'ttc', lmpDate: '2026-10-01', title: '第一段' }, ctx)
  const j2 = await rt.callObject('lucky-journey', 'createJourney', { mode: 'ttc', lmpDate: '2026-10-20', title: '第二段' }, ctx)
  let list = await rt.callObject('lucky-journey', 'listJourneys', {}, ctx)
  assert.equal(list.currentId, j2.journeyId, '新建旅程应成为当前旅程')

  const sw = await rt.callObject('lucky-journey', 'setCurrentJourney', { journeyId: j1.journeyId }, ctx)
  assert.equal(sw.errCode, 0, JSON.stringify(sw))
  list = await rt.callObject('lucky-journey', 'listJourneys', {}, ctx)
  assert.equal(list.currentId, j1.journeyId, '切换后当前旅程应持久化')

  const renamed = await rt.callObject('lucky-journey', 'updateJourneyTitle', { journeyId: j1.journeyId, title: '第一次怀孕' }, ctx)
  assert.equal(renamed.errCode, 0)
  list = await rt.callObject('lucky-journey', 'listJourneys', {}, ctx)
  const view = list.journeys.find(j => j._id === j1.journeyId)
  assert.equal(view.title, '第一次怀孕')

  await rt.callObject('lucky-journey', 'archiveJourney', { journeyId: j1.journeyId }, ctx)
  list = await rt.callObject('lucky-journey', 'listJourneys', {}, ctx)
  assert.equal(list.currentId, j2.journeyId, '归档当前旅程后应回退到下一段旅程')
  const archived = list.journeys.find(j => j._id === j1.journeyId)
  assert.equal(archived.archived, true)
})

test('服务端埋点：记录写入即产生 record_create，报告查看产生 report_view', async () => {
  const rt = createRuntime()
  const reg = await register(rt)
  const ctx = { token: reg.token }
  const j = await rt.callObject('lucky-journey', 'createJourney', { mode: 'ttc', lmpDate: '2026-10-01' }, ctx)
  const add = await rt.callObject('lucky-record', 'addMetric', {
    journeyId: j.journeyId, code: 'weight', value: { kg: 60 }, date: '2026-10-30', ts: Date.now()
  }, ctx)
  assert.equal(add.errCode, 0, JSON.stringify(add))
  const events = await rt.db.collection('lb-events').where({ journey_id: j.journeyId }).get()
  const rec = events.data.find(e => e.event === 'record_create' && e.props.type === 'weight')
  assert.ok(rec, '写入记录应产生服务端 record_create 事件')

  const report = await rt.callObject('lucky-data', 'report', { journeyId: j.journeyId, type: 'cycle' }, ctx)
  assert.equal(report.errCode, 0, JSON.stringify(report))
  const after = await rt.db.collection('lb-events').where({ journey_id: j.journeyId }).get()
  assert.ok(after.data.some(e => e.event === 'report_view'), '查看报告应产生 report_view')
})

test('运营看板：非管理员拒绝访问', async () => {
  const rt = createRuntime()
  const reg = await register(rt)
  const res = await rt.callObject('lucky-analytics', 'opsSummary', {}, { token: reg.token })
  assert.equal(res.errCode, 'PERMISSION_DENIED')
})

test('短信账号注销与撤回：短信用户可用「注销」确认，验证码登录自动撤回', async () => {
  const rt = createRuntime()
  await seedCode(rt, '111111')
  const login = await rt.callObject('lucky-id', 'loginBySms', { mobile: MOBILE, code: '111111' })
  assert.equal(login.errCode, 0)
  const ctx = { token: login.token }
  const bad = await rt.callObject('lucky-id', 'requestDeletion', { password: '注销' }, ctx)
  assert.equal(bad.errCode, 0, '未设置密码的短信用户应可用「注销」确认')
  const logout = await rt.callObject('lucky-id', 'checkToken', {}, ctx)
  assert.notEqual(logout.errCode, 0, '注销后 token 应被吊销')

  await seedCode(rt, '222222')
  const again = await rt.callObject('lucky-id', 'loginBySms', { mobile: MOBILE, code: '222222' })
  assert.equal(again.errCode, 0, '手机号验证后应能登录并撤回注销')
  assert.ok(again.token)
  const users = await rt.db.collection('uni-id-users').where({ mobile: MOBILE }).get()
  assert.equal(users.data[0].status, 'active', '再次验证登录应恢复账号状态')
})

test('密码账号注销仍必须输入密码，「注销」二字不能绕过', async () => {
  const rt = createRuntime()
  const reg = await register(rt)
  const res = await rt.callObject('lucky-id', 'requestDeletion', { password: '注销' }, { token: reg.token })
  assert.equal(res.errCode, 'PASSWORD_ERROR')
})

test('存量账号（无 password_set 字段）仍按密码账号处理', async () => {
  const rt = createRuntime()
  await rt.db.collection('uni-id-users').add({
    username: 'legacy01', password: auth.hashPassword('password123'), nickname: '老用户',
    status: 'active', role: [], heightCm: 0, prePregnancyWeightKg: 0, birthYear: 0,
    register_date: Date.now(), last_login_date: 0
  })
  const login = await rt.callObject('lucky-id', 'login', { username: 'legacy01', password: 'password123' })
  assert.equal(login.errCode, 0, JSON.stringify(login))
  const prof = await rt.callObject('lucky-id', 'getProfile', {}, { token: login.token })
  assert.equal(prof.userInfo.hasPassword, true, '存量账号应视为已设置密码')
  const del = await rt.callObject('lucky-id', 'requestDeletion', { password: '注销' }, { token: login.token })
  assert.equal(del.errCode, 'PASSWORD_ERROR', '存量密码账号不能用「注销」绕过')
})

test('运营反馈接口：非管理员拒绝查看与处理', async () => {
  const rt = createRuntime()
  const reg = await register(rt)
  const ctx = { token: reg.token }
  const list = await rt.callObject('lucky-analytics', 'listFeedback', {}, ctx)
  assert.equal(list.errCode, 'PERMISSION_DENIED')
  const resolve = await rt.callObject('lucky-analytics', 'resolveFeedback', { feedbackId: 'x' }, ctx)
  assert.equal(resolve.errCode, 'PERMISSION_DENIED')
})

test('关键集合索引文件齐备且格式正确', () => {
  const fs = require('fs')
  const root = path.resolve(__dirname, '../../uniCloud-aliyun/database')
  const must = ['lb-daily-logs', 'lb-cycle-events', 'lb-feedings', 'lb-events', 'lb-sms-codes',
    'lb-feedback', 'lb-child-health', 'lb-family-members', 'lb-token', 'uni-id-users']
  for (const c of must) {
    const file = path.join(root, c + '.index.json')
    assert.ok(fs.existsSync(file), `缺少索引文件 ${c}.index.json`)
    const arr = JSON.parse(fs.readFileSync(file, 'utf-8'))
    assert.ok(Array.isArray(arr) && arr.length > 0, `${c} 索引应为非空数组`)
    for (const idx of arr) {
      assert.ok(idx.IndexName && idx.MgoKeySchema && Array.isArray(idx.MgoKeySchema.MgoIndexKeys), `${c} 索引格式错误`)
    }
  }
  const users = JSON.parse(fs.readFileSync(path.join(root, 'uni-id-users.index.json'), 'utf-8'))
  assert.ok(users.some(i => i.IndexName === 'uniq_username' && i.MgoKeySchema.MgoIsUnique === true), '用户名列必须唯一索引')
  const members = JSON.parse(fs.readFileSync(path.join(root, 'lb-family-members.index.json'), 'utf-8'))
  assert.ok(members.some(i => i.MgoKeySchema.MgoIsUnique === true), '家庭成员应唯一索引')
})

test('注销清理覆盖相册/审计/提醒完成表', async () => {
  const rt = createRuntime()
  const reg = await register(rt)
  const ctx = { token: reg.token }
  const j = await rt.callObject('lucky-journey', 'createJourney', { mode: 'ttc', lmpDate: '2026-10-01' }, ctx)
  const jid = j.journeyId
  for (const c of ['lb-album', 'lb-audit-logs', 'lb-reminder-done']) {
    await rt.db.collection(c).add({ user_id: 'u', journey_id: jid, date: '2026-11-01', ts: Date.now() })
  }
  await rt.callObject('lucky-id', 'requestDeletion', { password: 'password123' }, ctx)
  const { purgeDueUsers } = require('../../uniCloud-aliyun/cloudfunctions/lucky-maintenance')
  // 将冷静期置为已到期后执行清理
  const users = await rt.db.collection('uni-id-users').where({}).get()
  const me = users.data[0]
  await rt.db.collection('uni-id-users').doc(me._id).update({ purge_at: Date.now() - 1000 })
  const res = await purgeDueUsers(rt.db, Date.now())
  assert.equal(res.purged.length, 1)
  for (const c of ['lb-album', 'lb-audit-logs', 'lb-reminder-done']) {
    const left = await rt.db.collection(c).where({ journey_id: jid }).get()
    assert.equal(left.data.length, 0, `${c} 应在注销后清空`)
  }
})

test('数据保留清理：过期验证码与 400 天前事件被删除', async () => {
  const rt = createRuntime()
  const now = Date.now()
  await rt.db.collection('lb-sms-codes').add({ phone: '13800138000', purpose: 'login', used: true, expires_at: now, created_at: now })
  await rt.db.collection('lb-sms-codes').add({ phone: '13800138001', purpose: 'login', used: false, expires_at: now + 300000, created_at: now })
  await rt.db.collection('lb-events').add({ event: 'app_launch', ts: now - 401 * 24 * 3600 * 1000 })
  await rt.db.collection('lb-events').add({ event: 'app_launch', ts: now })
  const { cleanupExpiredData } = require('../../uniCloud-aliyun/cloudfunctions/lucky-maintenance')
  const res = await cleanupExpiredData(rt.db, now)
  assert.equal(res.codes, 1, '已用验证码应被清理')
  assert.equal(res.events, 1, '400 天前事件应被清理')
  const codes = await rt.db.collection('lb-sms-codes').where({}).get()
  assert.equal(codes.data.length, 1)
  const events = await rt.db.collection('lb-events').where({}).get()
  assert.equal(events.data.length, 1)
})
