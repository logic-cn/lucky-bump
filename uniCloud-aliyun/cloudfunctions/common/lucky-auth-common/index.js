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

/**
 * 守卫：配置中心已加载但未配置 tokenSecret → 生产事故，直接抛错。
 * 修复安全审计 H5：此前静默回落到硬编码开发密钥，漏传配置即可被伪造 token。
 */
function assertSecretConfigured(centerLoaded, conf) {
  if (centerLoaded && !(conf && conf.tokenSecret)) {
    throw new Error('[lucky-auth-common] 已加载配置中心但缺少 tokenSecret，拒绝使用开发密钥（请检查 uni-config-center/uni-id/config.json）')
  }
}

// 优先读 uni-config-center 的 lucky-id 配置（生产），否则使用内置默认密钥（开发/测试）。
function loadSecret() {
  let centerLoaded = false
  const configs = []
  try {
    // uniCloud 环境下可用；本地 Node 测试环境无此模块。
    // 插件目录：优先自研命名空间 lucky-id，回退官方约定 uni-id（两者均指向 uni-config-center/<id>/config.json）
    const createConfigCenter = require('uni-config-center')
    centerLoaded = true
    for (const pid of ['lucky-id', 'uni-id']) {
      configs.push(createConfigCenter({ pluginId: pid }).config() || {})
    }
  } catch (e) {
    // 配置中心模块本身不存在 → 本地 Node 测试环境，允许回落
    if (centerLoaded) throw e
    return 'lb-dev-secret-DO-NOT-USE-IN-PRODUCTION'
  }
  // 先把两个命名空间都收集齐再判定，避免 lucky-id 空配置时误抛
  for (const conf of configs) {
    if (conf.tokenSecret) return String(conf.tokenSecret)
  }
  // 配置中心存在但都没有密钥 → fail-closed
  assertSecretConfigured(true, null)
  return 'lb-dev-secret-DO-NOT-USE-IN-PRODUCTION' // 不可达，仅满足静态分析
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

const TOKEN_COL = 'lb-token'

/**
 * 统一鉴权守卫：校验签名 + 查 lb-token 吊销状态。
 * 修复安全审计 C5：此前仅 lucky-id 查吊销表，其余云对象只验签名，
 * 导致用户"退出登录"后旧 token 仍可用满 30 天。
 * 返回 { ok:true, uid, jti } 或 { ok:false, errCode, errMsg }
 */
async function requireUser(db, token) {
  const v = verifyToken(token)
  if (!v.ok) return { ok: false, errCode: v.errCode, errMsg: v.errMsg }
  const tr = await db.collection(TOKEN_COL).where({ jti: v.jti, revoked: false }).get()
  if (tr.data.length === 0) return { ok: false, errCode: 'TOKEN_INVALID', errMsg: 'token 已失效' }
  return { ok: true, uid: v.uid, jti: v.jti }
}

/**
 * 解析用户对旅程的访问权限。
 * 返回 { role, memberRole, dataScope, matrix, journey }
 *  role       管理权限：admin 映射为 owner（家庭管理用）
 *  memberRole 原始角色，矩阵索引必须用它（不能用 role，否则 admin 借用 owner 的可见性）
 *  dataScope  'journey' 仅旅程主人；'self' 家庭成员——strict 数据永远只认 user_id
 *
 * 安全审计 C4：此前 admin 被映射为 owner 后直接参与数据可见性判断，
 * 导致家庭管理员可读他人 strict 记录。管理权限与数据权限必须分离。
 */
async function resolveJourneyAccess(db, uid, journeyId) {
  const denied = { role: null, memberRole: null, dataScope: 'self', matrix: null }
  if (!uid || !journeyId) return denied
  const j = await db.collection('lb-journeys').doc(String(journeyId)).get()
  const journey = j.data[0]
  if (!journey) return denied
  if (journey.user_id === uid) {
    return { role: 'owner', memberRole: 'owner', dataScope: 'journey', matrix: null, journey }
  }
  const f = await db.collection('lb-families').where({ journey_id: String(journeyId) }).limit(1).get()
  if (f.data.length === 0) return denied
  const fam = f.data[0]
  const m = await db.collection('lb-family-members').where({ family_id: fam._id, user_id: uid }).limit(1).get()
  if (m.data.length === 0) return denied
  const memberRole = m.data[0].role
  return {
    role: memberRole === 'admin' ? 'owner' : memberRole,
    memberRole,
    dataScope: 'self',
    matrix: fam.matrix || {},
    journey
  }
}

/**
 * strict 记录（同房/验孕/EPDS）仅本人可见，无任何例外。
 * 产品红线 docs/03：任何授权不可覆盖。
 */
function visibilityFilter(records, uid) {
  return (records || []).filter(r => r.sensitivity !== 'strict' || r.user_id === uid)
}

/** 读取 uni-config-center 命名空间配置；本地测试或未部署时返回空对象 */
function readConfig(pluginId) {
  try {
    const cc = require('uni-config-center')
    return cc({ pluginId }).config() || {}
  } catch (e) {
    return {}
  }
}

/**
 * 服务端埋点：业务写入成功后调用，保证「记录发生即计数」，不依赖页面。
 * 失败静默（埋点不得影响业务）。
 */
async function logEvent(db, payload) {
  try {
    const ts = payload.ts || Date.now()
    await db.collection('lb-events').add({
      user_id: payload.userId || '',
      journey_id: payload.journeyId || '',
      event: String(payload.event || '').slice(0, 32),
      props: payload.props || {},
      date: new Date(ts).toISOString().slice(0, 10),
      ts
    })
  } catch (e) { /* 埋点失败不影响业务 */ }
}

module.exports = { createToken, verifyToken, hashPassword, verifyPassword, ok, fail, rateLimit, loadSecret, resolveJourneyAccess, requireUser, visibilityFilter, assertSecretConfigured, readConfig, logEvent }
