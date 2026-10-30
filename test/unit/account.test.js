/**
 * 注销账号闭环（docs/03：删除账户 = 30 天冷静期后彻底删除）
 */
const test = require('node:test')
const assert = require('node:assert')
const { createRuntime } = require('../harness/unicloud-mock')

const DAY = 24 * 3600 * 1000

async function reg(rt, username) {
  return rt.callObject('lucky-id', 'register', { username, password: 'password123', nickname: '测试' })
}

test('注销：密码错误时拒绝', async () => {
  const rt = createRuntime()
  const r = await reg(rt, 'deluser1')
  const d = await rt.callObject('lucky-id', 'requestDeletion', { password: 'wrongpass' }, { token: r.token })
  assert.equal(d.errCode, 'PASSWORD_ERROR')
})

test('注销：正确密码后账号标记 pending_deletion 且 token 立即失效', async () => {
  const rt = createRuntime()
  const r = await reg(rt, 'deluser2')
  const d = await rt.callObject('lucky-id', 'requestDeletion', { password: 'password123' }, { token: r.token })
  assert.equal(d.errCode, 0, JSON.stringify(d))
  assert.ok(d.purgeAt > Date.now(), '应返回 30 天后的 purgeAt')
  assert.ok(d.purgeAt <= Date.now() + 30 * DAY, 'purgeAt 应为 30 天内')
  // token 立即失效（依赖 Task 1 的吊销修复）
  const chk = await rt.callObject('lucky-id', 'checkToken', {}, { token: r.token })
  assert.notEqual(chk.errCode, 0, '注销后 token 应失效')
  // 再登录被拦截
  const li = await rt.callObject('lucky-id', 'login', { username: 'deluser2', password: 'password123' })
  assert.equal(li.errCode, 'ACCOUNT_PENDING_DELETION')
  assert.ok(li.daysLeft >= 29 && li.daysLeft <= 30, '应返回剩余天数')
})

test('注销：冷静期内可撤回并恢复登录', async () => {
  const rt = createRuntime()
  const r = await reg(rt, 'deluser3')
  await rt.callObject('lucky-id', 'requestDeletion', { password: 'password123' }, { token: r.token })
  const li1 = await rt.callObject('lucky-id', 'login', { username: 'deluser3', password: 'password123' })
  assert.equal(li1.errCode, 'ACCOUNT_PENDING_DELETION')
  // 用密码登录时带 cancel 标志撤回
  const c = await rt.callObject('lucky-id', 'cancelDeletion', { username: 'deluser3', password: 'password123' })
  assert.equal(c.errCode, 0, JSON.stringify(c))
  const li2 = await rt.callObject('lucky-id', 'login', { username: 'deluser3', password: 'password123' })
  assert.equal(li2.errCode, 0, '撤回后应可正常登录')
})

test('注销：cancelDeletion 对正常账号拒绝', async () => {
  const rt = createRuntime()
  await reg(rt, 'deluser4')
  const c = await rt.callObject('lucky-id', 'cancelDeletion', { username: 'deluser4', password: 'password123' })
  assert.equal(c.errCode, 'STATE_ERROR', '未申请注销的账号不应可撤回')
})

test('应用锁：verifyPassword 校验通过且不发新 token', async () => {
  const rt = createRuntime()
  const r = await reg(rt, 'lock01')
  const ok = await rt.callObject('lucky-id', 'verifyPassword', { password: 'password123' }, { token: r.token })
  assert.equal(ok.errCode, 0, JSON.stringify(ok))
  assert.equal(ok.verified, true)
  assert.equal(ok.token, undefined, '解锁校验不得签发新 token')
})

test('应用锁：verifyPassword 密码错误 / 未登录均拒绝', async () => {
  const rt = createRuntime()
  const r = await reg(rt, 'lock02')
  const bad = await rt.callObject('lucky-id', 'verifyPassword', { password: 'wrongpass' }, { token: r.token })
  assert.equal(bad.errCode, 'PASSWORD_ERROR')
  const anon = await rt.callObject('lucky-id', 'verifyPassword', { password: 'password123' })
  assert.equal(anon.errCode, 'TOKEN_INVALID', '无 token 不得解锁')
})
