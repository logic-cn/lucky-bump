/**
 * 鉴权守卫测试：token 吊销全局生效（安全审计 C5）
 */
const test = require('node:test')
const assert = require('node:assert')
const path = require('node:path')
const fs = require('node:fs')
const crypto = require('node:crypto')
const { createRuntime } = require('../harness/unicloud-mock')
const { CLOUD_ROOT } = require('../harness/cloud-dir')

async function setup() {
  const rt = createRuntime()
  const reg = await rt.callObject('lucky-id', 'register', { username: 'c5tester', password: 'password123', nickname: 'C5' })
  assert.equal(reg.errCode, 0, JSON.stringify(reg))
  const mk = await rt.callObject('lucky-journey', 'createJourney', { mode: 'ttc', title: '旅程' }, { token: reg.token })
  assert.equal(mk.errCode, 0, JSON.stringify(mk))
  return { rt, token: reg.token, jid: mk.journeyId }
}

test('C5：logout 后旧 token 在其余云对象上立即失效', async () => {
  const { rt, token, jid } = await setup()
  // 退出前可正常访问
  const before = await rt.callObject('lucky-record', 'listMetrics', { journeyId: jid }, { token })
  assert.equal(before.errCode, 0, '退出前应可访问')
  // 退出登录
  const out = await rt.callObject('lucky-id', 'logout', {}, { token })
  assert.equal(out.errCode, 0)
  // 退出后：lucky-record 必须拒绝
  const after = await rt.callObject('lucky-record', 'listMetrics', { journeyId: jid }, { token })
  assert.notEqual(after.errCode, 0, 'C5 未修复：logout 后 lucky-record 仍接受旧 token')
  assert.equal(after.errCode, 'TOKEN_INVALID')
})

test('C5：logout 后 lucky-data / lucky-reminder 同样拒绝', async () => {
  const { rt, token, jid } = await setup()
  await rt.callObject('lucky-id', 'logout', {}, { token })
  const d = await rt.callObject('lucky-data', 'today', { journeyId: jid }, { token })
  assert.equal(d.errCode, 'TOKEN_INVALID', 'lucky-data 未校验吊销')
  const r = await rt.callObject('lucky-reminder', 'listDue', { journeyId: jid }, { token })
  assert.equal(r.errCode, 'TOKEN_INVALID', 'lucky-reminder 未校验吊销')
})

/* ---------------- 恢复凭证找回密码（无需短信） ---------------- */

test('恢复凭证：一次性、可重置密码并吊销旧 token', async () => {
  const rt = createRuntime()
  const reg = await rt.callObject('lucky-id', 'register', { username: 'recover1', password: 'oldPass123' })
  assert.equal(reg.errCode, 0, JSON.stringify(reg))

  const gen = await rt.callObject('lucky-id', 'createRecoveryCode', {}, { token: reg.token })
  assert.equal(gen.errCode, 0, JSON.stringify(gen))
  assert.ok(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(gen.code), '凭证格式应为 XXXX-XXXX')

  const bad = await rt.callObject('lucky-id', 'resetPasswordByRecovery', { username: 'recover1', code: 'ZZZZ-ZZZZ', newPassword: 'newPass123' })
  assert.equal(bad.errCode, 'RECOVERY_ERROR', '错误凭证必须拒绝')

  const ok = await rt.callObject('lucky-id', 'resetPasswordByRecovery', { username: 'recover1', code: gen.code, newPassword: 'newPass123' })
  assert.equal(ok.errCode, 0, JSON.stringify(ok))

  const oldLogin = await rt.callObject('lucky-id', 'login', { username: 'recover1', password: 'oldPass123' })
  assert.equal(oldLogin.errCode, 'PASSWORD_ERROR', '旧密码应失效')
  const newLogin = await rt.callObject('lucky-id', 'login', { username: 'recover1', password: 'newPass123' })
  assert.equal(newLogin.errCode, 0, '新密码应可登录')

  const reuse = await rt.callObject('lucky-id', 'resetPasswordByRecovery', { username: 'recover1', code: gen.code, newPassword: 'thirdPass123' })
  assert.equal(reuse.errCode, 'NO_RECOVERY_CODE', '凭证使用后必须作废')

  const after = await rt.callObject('lucky-id', 'checkToken', {}, { token: reg.token })
  assert.equal(after.errCode, 'TOKEN_INVALID', '重置后旧 token 必须失效')
})

test('未设置恢复凭证的账号重置会得到明确提示', async () => {
  const rt = createRuntime()
  const reg = await rt.callObject('lucky-id', 'register', { username: 'noRecovery', password: 'password123' })
  assert.equal(reg.errCode, 0)
  const res = await rt.callObject('lucky-id', 'resetPasswordByRecovery', { username: 'noRecovery', code: 'AAAA-BBBB', newPassword: 'newPass123' })
  assert.equal(res.errCode, 'NO_RECOVERY_CODE')
})

test('C4：visibilityFilter 只保留本人 strict 记录', () => {
  const auth = require(path.join(require('../harness/cloud-dir').CLOUD_ROOT, 'cloudfunctions/common/lucky-auth-common'))
  const rows = [
    { _id: '1', user_id: 'u1', sensitivity: 'strict' },
    { _id: '2', user_id: 'u2', sensitivity: 'strict' },
    { _id: '3', user_id: 'u2', sensitivity: 'normal' }
  ]
  const out = auth.visibilityFilter(rows, 'u1')
  assert.deepEqual(out.map(r => r._id), ['1', '3'])
})

test('C4：admin 角色的 dataScope 为 self，看不到他人 strict 记录', async () => {
  const { rt, token, jid } = await setup()
  // 先建家庭组（invite 前置条件）
  const fam = await rt.callObject('lucky-family', 'getFamily', { journeyId: jid }, { token })
  assert.equal(fam.errCode, 0, JSON.stringify(fam))
  // 邀请爸爸加入为 admin
  const inv = await rt.callObject('lucky-family', 'invite', { journeyId: jid, role: 'admin' }, { token })
  assert.equal(inv.errCode, 0, JSON.stringify(inv))
  const reg2 = await rt.callObject('lucky-id', 'register', { username: 'dadc4', password: 'password123' })
  assert.equal(reg2.errCode, 0, JSON.stringify(reg2))
  const join = await rt.callObject('lucky-family', 'join', { code: inv.code }, { token: reg2.token })
  assert.equal(join.errCode, 0, JSON.stringify(join))

  // 受邀成员没有自己的旅程：仍应能读取所在家庭与成员列表
  const dadFam = await rt.callObject('lucky-family', 'getFamily', { journeyId: 'not-mine' }, { token: reg2.token })
  assert.equal(dadFam.errCode, 0, JSON.stringify(dadFam))
  assert.ok((dadFam.members || []).some(m => m.isMe === true), '成员应能查看家庭并按 isMe 标识自己')
  assert.ok((dadFam.members || []).every(m => m.nickname && m.nickname !== '我'), '成员列表不应出现多个“我”')

  // 爸爸写入自己的 strict 记录
  const ev = await rt.callObject('lucky-record', 'addCycleEvent', { journeyId: jid, type: 'intercourse', date: '2026-10-01' }, { token: reg2.token })
  assert.equal(ev.errCode, 0, JSON.stringify(ev))

  // 爸爸自己应能看到（阳性对照，防断言因数据不存在而假通过）
  const dadView = await rt.callObject('lucky-record', 'listCycleEvents', { journeyId: jid }, { token: reg2.token })
  const dadStrict = (dadView.events || []).filter(e => e.sensitivity === 'strict' && e.date === '2026-10-01')
  assert.equal(dadStrict.length, 1, '前置条件失败：爸爸应能看到自己的 strict 记录')

  // 妈妈（旅程主人）读取：爸爸的 strict 记录不得出现
  const momView = await rt.callObject('lucky-record', 'listCycleEvents', { journeyId: jid }, { token })
  const leaked = (momView.events || []).filter(e => e.sensitivity === 'strict' && e.date === '2026-10-01')
  assert.equal(leaked.length, 0, 'C4：主人的 owner 角色不得越过 strict 仅本人可见红线')
})

test('C4：resolveJourneyAccess 为 admin 返回 dataScope=self 且保留原始 memberRole', () => {
  const auth = require(path.join(require('../harness/cloud-dir').CLOUD_ROOT, 'cloudfunctions/common/lucky-auth-common'))
  const docs = {
    'lb-journeys': [{ _id: 'j1', user_id: 'mom' }],
    'lb-families': [{ _id: 'f1', journey_id: 'j1', matrix: { admin: { reports: true } } }],
    'lb-family-members': [{ family_id: 'f1', user_id: 'dad', role: 'admin' }]
  }
  const fakeDb = {
    collection: (name) => ({
      doc: (id) => ({ get: async () => ({ data: docs[name].filter(d => d._id === id) }) }),
      where: () => ({ limit: () => ({ get: async () => ({ data: docs[name] }) }) })
    })
  }
  return auth.resolveJourneyAccess(fakeDb, 'dad', 'j1').then((r) => {
    assert.equal(r.role, 'owner', 'admin 的管理权限应提升为 owner')
    assert.equal(r.memberRole, 'admin', '原始角色必须保留供矩阵索引')
    assert.equal(r.dataScope, 'self', 'C4：admin 的数据权限必须是 self，不能是 journey')
    assert.ok(r.journey, '应返回 journey')
  })
})

/* ---------------- H5：密钥 fail-closed ---------------- */

test('H5：配置中心已加载但缺 tokenSecret 时必须抛错', () => {
  const auth = require(path.join(require('../harness/cloud-dir').CLOUD_ROOT, 'cloudfunctions/common/lucky-auth-common'))
  assert.throws(() => auth.assertSecretConfigured(true, {}), /tokenSecret/)
  assert.throws(() => auth.assertSecretConfigured(true, null), /tokenSecret/)
})

test('H5：本地开发（配置中心不可用）与已配置密钥时不应抛错', () => {
  const auth = require(path.join(require('../harness/cloud-dir').CLOUD_ROOT, 'cloudfunctions/common/lucky-auth-common'))
  const real = 'a'.repeat(64)
  assert.doesNotThrow(() => auth.assertSecretConfigured(false, {}))
  assert.doesNotThrow(() => auth.assertSecretConfigured(true, { tokenSecret: real }))
  // 示例占位符与过短串等同未配置，不能当正式密钥
  assert.throws(() => auth.assertSecretConfigured(true, { tokenSecret: '<替换为 openssl rand -hex 32 生成的 64 位随机串>' }), /tokenSecret/)
  assert.throws(() => auth.assertSecretConfigured(true, { tokenSecret: 'short' }), /tokenSecret/)
})

/* ---------------- C6：token 会话与 uid 绑定 ---------------- */

function b64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

test('C6：不能借用他人 jti 伪造身份（即使签名密钥泄露）', async () => {
  const rt = createRuntime()
  // 必须用运行时实际加载的 vendored 副本取密钥，否则两份密钥不一致会让用例假通过
  const auth = require(path.join(CLOUD_ROOT, 'cloudfunctions/lucky-id/common/lucky-auth-common'))
  const a = await rt.callObject('lucky-id', 'register', { username: 'attacker9', password: 'password123' })
  const b = await rt.callObject('lucky-id', 'register', { username: 'victim9', password: 'password123' })
  assert.equal(a.errCode, 0, JSON.stringify(a))
  assert.equal(b.errCode, 0, JSON.stringify(b))
  const victim = await rt.callObject('lucky-id', 'getProfile', {}, { token: b.token })
  const victimUid = victim.userInfo.id
  const session = JSON.parse(Buffer.from(a.token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString())
  const payload = b64url(JSON.stringify({ uid: victimUid, exp: Date.now() + 86400000, jti: session.jti }))
  const forged = `lb.${payload}.${b64url(crypto.createHmac('sha256', auth.loadSecret()).update(payload).digest())}`
  const res = await rt.callObject('lucky-id', 'getProfile', {}, { token: forged })
  assert.notEqual(res.errCode, 0, 'C6：借用他人 jti 伪造 uid 必须被拒绝')
  // 阳性对照：攻击者自己的真实 token 仍可用
  const own = await rt.callObject('lucky-id', 'getProfile', {}, { token: a.token })
  assert.equal(own.errCode, 0, JSON.stringify(own))
})


test('配置读取：vendored 副本能读到 uni-config-center 插件配置', () => {
  const vendorRoot = path.join(CLOUD_ROOT, 'cloudfunctions/lucky-id/common')
  const pluginId = '__test_config__'
  const dir = path.join(vendorRoot, 'uni-config-center', pluginId)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ probe: 'ok' }))
  try {
    const auth = require(path.join(vendorRoot, 'lucky-auth-common'))
    assert.equal(auth.readConfig(pluginId).probe, 'ok', 'readConfig 未解析到 vendor 目录下的配置')
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('H1：家庭组数据组授权在服务端生效（日记/产检）', async () => {
  const rt = createRuntime()
  const mom = await rt.callObject('lucky-id', 'register', { username: 'h1mom', password: 'password123' })
  const dad = await rt.callObject('lucky-id', 'register', { username: 'h1dad', password: 'password123' })
  const mk = await rt.callObject('lucky-journey', 'createJourney', { mode: 'ttc' }, { token: mom.token })
  const jid = mk.journeyId
  const fam = await rt.callObject('lucky-family', 'getFamily', { journeyId: jid }, { token: mom.token })
  assert.equal(fam.errCode, 0, JSON.stringify(fam))
  const inv = await rt.callObject('lucky-family', 'invite', { journeyId: jid, role: 'recorder' }, { token: mom.token })
  assert.equal(inv.errCode, 0, JSON.stringify(inv))
  const join = await rt.callObject('lucky-family', 'join', { code: inv.code, nickname: '爸爸' }, { token: dad.token })
  assert.equal(join.errCode, 0, JSON.stringify(join))

  // 默认授权：爸爸可读日记
  const before = await rt.callObject('lucky-record', 'listDiaries', { journeyId: jid }, { token: dad.token })
  assert.equal(before.errCode, 0, JSON.stringify(before))

  for (const group of ['diary', 'prenatal']) {
    const perm = await rt.callObject('lucky-family', 'setPermission', { journeyId: jid, group, role: 'recorder', allow: false }, { token: mom.token })
    assert.equal(perm.errCode, 0, JSON.stringify(perm))
  }
  const denied = await rt.callObject('lucky-record', 'listDiaries', { journeyId: jid }, { token: dad.token })
  assert.equal(denied.errCode, 'PERMISSION_DENIED', '关闭授权后家庭成员不应再读到日记: ' + JSON.stringify(denied))
  const careDenied = await rt.callObject('lucky-care', 'listPlan', { journeyId: jid }, { token: dad.token })
  assert.equal(careDenied.errCode, 'PERMISSION_DENIED', '关闭授权后家庭成员不应再读到产检: ' + JSON.stringify(careDenied))
  // 主人不受授权开关影响
  const own = await rt.callObject('lucky-record', 'listDiaries', { journeyId: jid }, { token: mom.token })
  assert.equal(own.errCode, 0, JSON.stringify(own))
})

test('H1：报告组未授权时产检结论与逐项结果不得返回', async () => {
  const rt = createRuntime()
  const mom = await rt.callObject('lucky-id', 'register', { username: 'h1rmom', password: 'password123' })
  const viewer = await rt.callObject('lucky-id', 'register', { username: 'h1rview', password: 'password123' })
  const mk = await rt.callObject('lucky-journey', 'createJourney', { mode: 'ttc' }, { token: mom.token })
  const jid = mk.journeyId
  await rt.callObject('lucky-family', 'getFamily', { journeyId: jid }, { token: mom.token })
  const inv = await rt.callObject('lucky-family', 'invite', { journeyId: jid, role: 'viewer' }, { token: mom.token })
  const join = await rt.callObject('lucky-family', 'join', { code: inv.code, nickname: '长辈' }, { token: viewer.token })
  assert.equal(join.errCode, 0, JSON.stringify(join))

  const add = await rt.callObject('lucky-care', 'addVisit', {
    journeyId: jid, visitDate: '2026-10-01', hospital: '市妇幼', week: 20,
    conclusion: '胎心偏快，建议复查',
    items: [{ code: 'bscan', name: 'B超', result: 'NT 2.1mm', abnormal: true }],
    reportFileIds: ['cloud://report-1']
  }, { token: mom.token })
  assert.equal(add.errCode, 0, JSON.stringify(add))

  // viewer 默认 reports=false：只保留产检基本信息和项目名称
  const list = await rt.callObject('lucky-care', 'listVisits', { journeyId: jid }, { token: viewer.token })
  assert.equal(list.errCode, 0, JSON.stringify(list))
  const row = list.visits[0]
  assert.equal(row.conclusion, '', '报告组未授权时不应返回检查结论')
  assert.deepEqual(row.report_file_ids, [], '报告组未授权时不应返回报告文件')
  assert.equal(row.items[0].result, undefined, '报告组未授权时不应返回逐项结果')
  assert.equal(row.items[0].abnormal, undefined, '报告组未授权时不应返回异常标记')
  assert.equal(row.items[0].name, 'B超', '产检项目名称属于产检信息，可保留')
  // 主人不受影响
  const own = await rt.callObject('lucky-care', 'listVisits', { journeyId: jid }, { token: mom.token })
  assert.equal(own.visits[0].conclusion, '胎心偏快，建议复查')
})

test('限流表容量满时不得清空在用计数', () => {
  const auth = require(path.join(CLOUD_ROOT, 'cloudfunctions/common/lucky-auth-common'))
  const now = 1000
  const victim = `victim:${Date.now()}`
  for (let i = 0; i < 5100; i++) auth.rateLimit(`flood:${Date.now()}:${i}`, 5, 600000, now)
  assert.equal(auth.rateLimit(victim, 1, 600000, now), true)
  assert.equal(auth.rateLimit(victim, 1, 600000, now), false, '容量清扫不应重置正在生效的计数')
})
