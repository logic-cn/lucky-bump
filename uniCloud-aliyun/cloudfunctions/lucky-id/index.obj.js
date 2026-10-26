/**
 * lucky-id —— 账户与登录（uni-id 兼容语义，docs/06 A3）
 * 数据表：uni-id-users（结构对齐 uni-id）、lb-token（可吊销 token 记录）
 * 客户端经 callFunction {method, params} 或 importObject 调用；token 经 uni_id_token 通道传递。
 */
'use strict'
const auth = require('../common/lucky-auth-common')

const TOKEN_TTL_DAYS = 30

function db() { return this.uniCloud.database() }
const usersCol = 'uni-id-users'
const tokenCol = 'lb-token'

/** 从调用上下文取 token 并校验（优先 uni_id_token 通道，兼容测试注入） */
async function requireUser() {
  const token = (this.__mockToken != null) ? this.__mockToken : this.getUniIdToken()
  const v = auth.verifyToken(token)
  if (!v.ok) return auth.fail(v.errCode, v.errMsg)
  const tr = await db.call(this).collection(tokenCol).where({ jti: v.jti, revoked: false }).get()
  if (tr.data.length === 0) return auth.fail('TOKEN_INVALID', 'token 已失效')
  return auth.ok({ uid: v.uid })
}

module.exports = {
  /** 注册（账号密码）。短信注册需配置服务商后另行开放。 */
  async register(params = {}) {
    const username = String(params.username || '').trim()
    const password = String(params.password || '')
    const nickname = String(params.nickname || '').trim() || ('用户' + username.slice(-4))
    if (!/^[a-zA-Z0-9_]{4,24}$/.test(username)) return auth.fail('PARAM_ERROR', '用户名需 4-24 位字母数字下划线')
    if (password.length < 8 || password.length > 32) return auth.fail('PARAM_ERROR', '密码长度需 8-32 位')
    const exists = await db.call(this).collection(usersCol).where({ username }).count()
    if (exists.total > 0) return auth.fail('USERNAME_EXISTS', '用户名已被注册')
    const now = Date.now()
    const addRes = await db.call(this).collection(usersCol).add({
      username,
      password: auth.hashPassword(password),
      nickname,
      avatar: '',
      heightCm: 0,
      prePregnancyWeightKg: 0,
      birthYear: 0,
      role: [],
      status: 'active',
      register_date: now,
      last_login_date: now
    })
    const uid = addRes.id
    const t = await this._issueToken(uid)
    return auth.ok(t)
  },

  /** 登录（账号密码），失败限速 */
  async login(params = {}) {
    const username = String(params.username || '').trim()
    const password = String(params.password || '')
    if (!auth.rateLimit('login:' + this.getClientInfo().clientIP || 'na', 10, 10 * 60 * 1000)) {
      return auth.fail('TOO_MANY_REQUESTS', '尝试过于频繁，请稍后再试')
    }
    const res = await db.call(this).collection(usersCol).where({ username }).get()
    if (res.data.length === 0) return auth.fail('ACCOUNT_NOT_EXISTS', '账号不存在')
    const user = res.data[0]
    if (user.status !== 'active') return auth.fail('ACCOUNT_DISABLED', '账号不可用')
    if (!auth.verifyPassword(password, user.password)) return auth.fail('PASSWORD_ERROR', '用户名或密码错误')
    await db.call(this).collection(usersCol).doc(user._id).update({ last_login_date: Date.now() })
    const issued = await this._issueToken(user._id)
    return auth.ok(Object.assign(issued, {
      userInfo: { id: user._id, username: user.username, nickname: user.nickname, avatar: user.avatar || '' }
    }))
  },

  /** 退出登录：吊销当前 token */
  async logout() {
    const v = auth.verifyToken((this.__mockToken != null) ? this.__mockToken : this.getUniIdToken())
    if (v.ok) {
      await db.call(this).collection(tokenCol).where({ jti: v.jti }).update({ revoked: true })
    }
    return auth.ok()
  },

  /** 客户端会话校验（冷启动恢复登录态用） */
  async checkToken() { return requireUser.call(this) },

  async getProfile() {
    const g = await requireUser.call(this)
    if (g.errCode !== 0) return g
    const res = await db.call(this).collection(usersCol).doc(g.uid).get()
    if (res.data.length === 0) return auth.fail('ACCOUNT_NOT_EXISTS', '用户不存在')
    const u = res.data[0]
    return auth.ok({ userInfo: { id: u._id, username: u.username, nickname: u.nickname, avatar: u.avatar || '', heightCm: u.heightCm || 0, prePregnancyWeightKg: u.prePregnancyWeightKg || 0, birthYear: u.birthYear || 0 } })
  },

  async updateProfile(params = {}) {
    const g = await requireUser.call(this)
    if (g.errCode !== 0) return g
    const patch = {}
    for (const k of ['nickname', 'avatar', 'heightCm', 'prePregnancyWeightKg', 'birthYear']) {
      if (params[k] !== undefined) patch[k] = params[k]
    }
    if (Object.keys(patch).length === 0) return auth.fail('PARAM_ERROR', '无可更新字段')
    await db.call(this).collection(usersCol).doc(g.uid).update(patch)
    return auth.ok()
  },

  async changePassword(params = {}) {
    const g = await requireUser.call(this)
    if (g.errCode !== 0) return g
    const res = await db.call(this).collection(usersCol).doc(g.uid).get()
    const user = res.data[0]
    if (!auth.verifyPassword(String(params.oldPassword || ''), user.password)) {
      return auth.fail('PASSWORD_ERROR', '原密码错误')
    }
    const np = String(params.newPassword || '')
    if (np.length < 8 || np.length > 32) return auth.fail('PARAM_ERROR', '新密码长度需 8-32 位')
    await db.call(this).collection(usersCol).doc(g.uid).update({ password: auth.hashPassword(np) })
    return auth.ok()
  },

  /** 内部：签发并落库 token（可吊销） */
  async _issueToken(uid) {
    const t = auth.createToken(uid, TOKEN_TTL_DAYS)
    await db.call(this).collection(tokenCol).add({ jti: t.jti, uid, tokenExpired: t.tokenExpired, revoked: false, created_at: Date.now() })
    return { token: t.token, tokenExpired: t.tokenExpired }
  }
}
