/**
 * lucky-auth-common —— 幸孕记云端公共模块：token 签发/校验 + 密码哈希 + 响应约定
 *
 * 设计说明（docs/06-技术架构设计.md A3/A4）：
 * - 接口语义对齐 uni-id-common（createToken/checkToken/TOKEN_INVALID/TOKEN_EXPIRED），
 *   后续可在 HBuilderX 中安装官方 uni-id-common 后仅替换本模块实现，调用方无需改动。
 * - 零第三方依赖：HMAC-SHA256 签名 + node:crypto scrypt 密码哈希，本地 Node 可直接测试。
 */
'use strict'
const crypto = require('crypto')

// 优先读 uni-config-center 的 lucky-id 配置（生产），否则使用内置默认密钥（开发/测试）。
function loadSecret() {
  try {
    // uniCloud 环境下可用；本地 Node 测试环境无此模块则走默认。
    const createConfigCenter = require('uni-config-center')
    const conf = createConfigCenter({ pluginId: 'lucky-id' }).config() || {}
    if (conf.tokenSecret) return String(conf.tokenSecret)
  } catch (e) { /* 本地测试环境：忽略 */ }
  return 'lb-dev-secret-DO-NOT-USE-IN-PRODUCTION'
}

function b64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
function fromB64url(str) {
  str = str.replace(/-/g, '+').replace(/_/g, '/')
  while (str.length % 4) str += '='
  return Buffer.from(str, 'base64')
}
function hmac(payloadB64, secret) {
  return b64url(crypto.createHmac('sha256', secret).update(payloadB64).digest())
}

/** 签发 token：lb.<payloadB64>.<hmacB64>，payload={uid,exp,jti} */
function createToken(uid, ttlDays = 30, secret = loadSecret(), now = Date.now()) {
  if (!uid) throw new Error('uid required')
  const payload = { uid, exp: now + ttlDays * 24 * 3600 * 1000, jti: crypto.randomBytes(9).toString('hex') }
  const body = b64url(JSON.stringify(payload))
  return { token: `lb.${body}.${hmac(body, secret)}`, tokenExpired: payload.exp, jti: payload.jti, uid }
}

/** 校验 token。返回 {ok:true, uid, jti} 或 {ok:false, errCode:'TOKEN_INVALID'|'TOKEN_EXPIRED'} */
function verifyToken(token, secret = loadSecret(), now = Date.now()) {
  if (typeof token !== 'string') return { ok: false, errCode: 'TOKEN_INVALID', errMsg: 'token 无效' }
  const parts = token.split('.')
  if (parts.length !== 3 || parts[0] !== 'lb') return { ok: false, errCode: 'TOKEN_INVALID', errMsg: 'token 无效' }
  const expect = hmac(parts[1], secret)
  const a = Buffer.from(expect)
  const b = Buffer.from(parts[2])
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return { ok: false, errCode: 'TOKEN_INVALID', errMsg: 'token 无效' }
  }
  let payload
  try { payload = JSON.parse(fromB64url(parts[1]).toString('utf8')) } catch (e) {
    return { ok: false, errCode: 'TOKEN_INVALID', errMsg: 'token 无效' }
  }
  if (!payload || !payload.uid) return { ok: false, errCode: 'TOKEN_INVALID', errMsg: 'token 无效' }
  if (payload.exp <= now) return { ok: false, errCode: 'TOKEN_EXPIRED', errMsg: 'token 已过期' }
  return { ok: true, uid: payload.uid, jti: payload.jti, exp: payload.exp }
}

/** scrypt 密码哈希：s2$<saltHex>$<hashHex> */
function hashPassword(password) {
  const salt = crypto.randomBytes(16)
  const hash = crypto.scryptSync(String(password), salt, 32)
  return `s2$${salt.toString('hex')}$${hash.toString('hex')}`
}
function verifyPassword(password, stored) {
  if (typeof stored !== 'string') return false
  const [tag, saltHex, hashHex] = stored.split('$')
  if (tag !== 's2' || !saltHex || !hashHex) return false
  const hash = crypto.scryptSync(String(password), Buffer.from(saltHex, 'hex'), 32)
  const expect = Buffer.from(hashHex, 'hex')
  return hash.length === expect.length && crypto.timingSafeEqual(hash, expect)
}

/** 统一响应约定：errCode=0 成功；字符串错误码对齐 uni-id 语义 */
function ok(data) { return Object.assign({ errCode: 0, errMsg: 'ok' }, data || {}) }
function fail(errCode, errMsg, extra) {
  return Object.assign({ errCode, errMsg }, extra || {})
}

/** 简单登录限速（内存版，生产建议持久化）：key → {count, resetAt} */
const _rateBuckets = new Map()
function rateLimit(key, max, windowMs, now = Date.now()) {
  const b = _rateBuckets.get(key)
  if (!b || now > b.resetAt) { _rateBuckets.set(key, { count: 1, resetAt: now + windowMs }); return true }
  if (b.count >= max) return false
  b.count += 1
  return true
}

/**
 * 解析用户对旅程的访问角色：owner(旅程主人/admin) / recorder(可读写) / viewer(只读) / null(无权限)
 * 家庭组模型见 docs/03 M7.1。journey 记录必须存在。
 */
async function resolveJourneyAccess(db, uid, journeyId) {
  if (!uid || !journeyId) return { role: null }
  const j = await db.collection('lb-journeys').doc(String(journeyId)).get()
  const journey = j.data[0]
  if (!journey) return { role: null }
  if (journey.user_id === uid) return { role: 'owner', journey }
  const f = await db.collection('lb-families').where({ journey_id: String(journeyId) }).limit(1).get()
  if (f.data.length === 0) return { role: null }
  const m = await db.collection('lb-family-members').where({ family_id: f.data[0]._id, user_id: uid }).limit(1).get()
  if (m.data.length === 0) return { role: null }
  const role = m.data[0].role === 'admin' ? 'owner' : m.data[0].role
  return { role, journey }
}

module.exports = { createToken, verifyToken, hashPassword, verifyPassword, ok, fail, rateLimit, loadSecret, resolveJourneyAccess }
