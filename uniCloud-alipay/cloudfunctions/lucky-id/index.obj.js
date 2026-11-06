/**
 * lucky-id —— 账户与登录（uni-id 兼容语义，docs/06 A3）
 * 数据表：uni-id-users（结构对齐 uni-id）、lb-token（可吊销 token 记录）
 * 客户端经 callFunction {method, params} 或 importObject 调用；token 经 uni_id_token 通道传递。
 */
'use strict'
const auth = require('./common/lucky-auth-common')
const crypto = require('crypto')

const TOKEN_TTL_DAYS = 30

function db() { return uniCloud.database() }
const usersCol = 'uni-id-users'
const tokenCol = 'lb-token'
const USERNAME_RE = /^[a-zA-Z0-9_]{4,24}$/

/**
 * 调用方标识：优先 IP，其次设备 ID；都缺失时返回空串。
 * 空串时只按账号/手机号维度限速，避免退化成全站共享桶把所有人一起锁死。
 */
function clientKey(ctx) {
  try {
    const info = (ctx.getClientInfo && ctx.getClientInfo()) || {}
    return String(info.clientIP || info.deviceId || '')
  } catch (e) {
    return ''
  }
}

/** 从调用上下文取 token 并校验（优先 uni_id_token 通道，兼容测试注入） */
async function requireUser() {
  const token = (this.__mockToken != null) ? this.__mockToken : this.getUniIdToken()
  const r = await auth.requireUser(db.call(this), token)
  if (!r.ok) return auth.fail(r.errCode, r.errMsg)
  return auth.ok({ uid: r.uid })
}

module.exports = {
  /** 注册（账号密码）。短信注册需配置服务商后另行开放。 */
  async register(params = {}) {
    const username = String(params.username || '').trim()
    const password = String(params.password || '')
    const nickname = String(params.nickname || '').trim() || ('用户' + username.slice(-4))
    // 防脚本批量注册：按来源 IP 限速（测试进程跳过，避免用例互相影响）
    if (process.env.NODE_ENV !== 'test') {
      const ipKey = clientKey(this)
      if (ipKey && !auth.rateLimit(`register:${ipKey}`, 10, 60 * 60 * 1000)) {
        return auth.fail('TOO_MANY_REQUESTS', '注册过于频繁，请稍后再试')
      }
    }
    if (!USERNAME_RE.test(username)) return auth.fail('PARAM_ERROR', '用户名需 4-24 位字母数字下划线')
    if (password.length < 8 || password.length > 32) return auth.fail('PARAM_ERROR', '密码长度需 8-32 位')
    const exists = await db.call(this).collection(usersCol).where({ username }).count()
    if (exists.total > 0) return auth.fail('USERNAME_EXISTS', '用户名已被注册')
    const now = Date.now()
    const addRes = await db.call(this).collection(usersCol).add({
      username,
      password: auth.hashPassword(password),
      password_set: true,
      nickname,
      avatar: '',
      heightCm: 0,
      prePregnancyWeightKg: 0,
      birthYear: 0,
      role: [],
      status: 'active',
      register_date: now,
      last_login_date: now,
      mobile: '',
      currentJourneyId: '',
      sensitive_consent_at: 0,
      sensitive_consent_version: '',
      privacy_consent_version: ''
    })
    const uid = addRes.id
    const t = await _issueToken(uid)
    return auth.ok(t)
  },

  /** 登录（账号密码），失败限速 */
  async login(params = {}) {
    const username = String(params.username || '').trim()
    const password = String(params.password || '')
    // 用户名先做格式校验：既限制匿名 key 的空间，也避免超长输入进入限流表
    if (!USERNAME_RE.test(username)) return auth.fail('PASSWORD_ERROR', '用户名或密码错误')
    // 防爆破：按「账号+IP」限速（锁定的是账号而非整个出口 IP）；三个密码入口共享同一预算
    const ipKey = clientKey(this)
    const rateKey = `pw:${username}` + (ipKey ? `:${ipKey}` : '')
    if (!auth.rateLimit(rateKey, 10, 10 * 60 * 1000)) {
      return auth.fail('TOO_MANY_REQUESTS', '尝试过于频繁，请稍后再试')
    }
    const res = await db.call(this).collection(usersCol).where({ username }).get()
    if (res.data.length === 0) return auth.fail('ACCOUNT_NOT_EXISTS', '账号不存在')
    const user = res.data[0]
    if (user.status === 'pending_deletion') {
      const left = Math.max(0, Math.ceil(((user.purge_at || 0) - Date.now()) / (24 * 3600 * 1000)))
      return auth.fail('ACCOUNT_PENDING_DELETION', '账号处于注销冷静期，可撤回后继续使用', { daysLeft: left })
    }
    if (user.status !== 'active') return auth.fail('ACCOUNT_DISABLED', '账号不可用')
    if (!auth.verifyPassword(password, user.password)) return auth.fail('PASSWORD_ERROR', '用户名或密码错误')
    await db.call(this).collection(usersCol).doc(user._id).update({ last_login_date: Date.now() })
    const issued = await _issueToken(user._id)
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
    const ops = auth.readConfig('lucky-ops')
    const admins = Array.isArray(ops.adminUserIds) ? ops.adminUserIds : []
    return auth.ok({ userInfo: {
      id: u._id, username: u.username, nickname: u.nickname, avatar: u.avatar || '',
      mobile: u.mobile || '', hasPassword: u.password_set !== false, heightCm: u.heightCm || 0, prePregnancyWeightKg: u.prePregnancyWeightKg || 0,
      birthYear: u.birthYear || 0,
      sensitiveConsentAt: u.sensitive_consent_at || 0, sensitiveConsentVersion: u.sensitive_consent_version || '',
      privacyConsentVersion: u.privacy_consent_version || '',
      opsAdmin: admins.indexOf(g.uid) >= 0
    } })
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

  /**
   * 发送短信验证码（登录/绑定）。
   * 依赖：uni-config-center/lucky-sms/config.json 与 uni-cloud-sms 扩展库；
   * 未配置时返回 CONFIG_MISSING，客户端提示改用账号密码登录，不影响既有用户。
   */
  async sendSmsCode(params = {}) {
    const mobile = String(params.mobile || '').trim()
    if (!/^1[3-9]\d{9}$/.test(mobile)) return auth.fail('PARAM_ERROR', '请输入有效的手机号')
    const cfg = auth.readConfig('lucky-sms')
    if (!cfg.templateId) return auth.fail('CONFIG_MISSING', '短信服务尚未配置，请使用账号密码登录')
    if (typeof uniCloud.sendSms !== 'function') return auth.fail('CONFIG_MISSING', '当前云环境未启用短信扩展库')
    const ttl = Math.min(600, Math.max(60, +cfg.codeTtlSeconds || 300))
    const resend = Math.min(300, Math.max(30, +cfg.resendSeconds || 60))
    const ip = clientKey(this)
    // 同一 IP 每小时最多 20 次，先于手机号计数判断，避免刷接口提前耗尽真实用户的发送额度
    if (ip && !auth.rateLimit(`smsip:${ip}`, 20, 60 * 60 * 1000)) return auth.fail('TOO_MANY_REQUESTS', '发送过于频繁，请稍后再试')
    // 同一手机号 60s 内只发一次、每小时最多 5 次
    if (!auth.rateLimit(`sms:${mobile}`, 1, resend * 1000)) return auth.fail('TOO_MANY_REQUESTS', '发送过于频繁，请稍后再试')
    if (!auth.rateLimit(`smsh:${mobile}`, 5, 60 * 60 * 1000)) return auth.fail('TOO_MANY_REQUESTS', '今日验证码次数已达上限，请稍后再试')
    const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0')
    // 旧验证码作废，只保留最新一条
    await db.call(this).collection('lb-sms-codes').where({ phone: mobile, purpose: 'login', used: false }).update({ used: true })
    await db.call(this).collection('lb-sms-codes').add({
      phone: mobile, code_hash: auth.hashPassword(code), purpose: 'login',
      expires_at: Date.now() + ttl * 1000, attempts: 0, used: false, ip, created_at: Date.now()
    })
    let sent
    try {
      sent = await uniCloud.sendSms({
        appid: cfg.appId,
        smsKey: cfg.smsKey || undefined,
        smsSecret: cfg.smsSecret || undefined,
        phone: mobile,
        templateId: cfg.templateId,
        data: { code, validMin: Math.ceil(ttl / 60) }
      })
    } catch (e) {
      return auth.fail('SMS_SEND_FAILED', '短信发送失败，请稍后重试')
    }
    if (sent && sent.errCode && sent.errCode !== 0) return auth.fail('SMS_SEND_FAILED', '短信发送失败，请稍后重试')
    return auth.ok({ cooldown: resend, ttl })
  },

  /** 手机号验证码登录：未注册手机号自动创建账号（密码随机，后续可设置） */
  async loginBySms(params = {}) {
    const mobile = String(params.mobile || '').trim()
    const code = String(params.code || '').replace(/\D/g, '')
    if (!/^1[3-9]\d{9}$/.test(mobile)) return auth.fail('PARAM_ERROR', '请输入有效的手机号')
    if (!/^\d{6}$/.test(code)) return auth.fail('PARAM_ERROR', '请输入 6 位验证码')
    const ipKey = clientKey(this)
    if (!auth.rateLimit(`smslogin:${mobile}${ipKey ? ':' + ipKey : ''}`, 10, 10 * 60 * 1000)) {
      return auth.fail('TOO_MANY_REQUESTS', '尝试过于频繁，请稍后再试')
    }
    const r = await db.call(this).collection('lb-sms-codes').where({ phone: mobile, purpose: 'login', used: false }).orderBy('created_at', 'desc').limit(1).get()
    const row = r.data[0]
    if (!row || row.expires_at < Date.now()) return auth.fail('CODE_EXPIRED', '验证码已过期，请重新获取')
    if ((row.attempts || 0) >= 5) return auth.fail('CODE_LOCKED', '验证码尝试次数过多，请重新获取')
    if (!auth.verifyPassword(code, row.code_hash)) {
      await db.call(this).collection('lb-sms-codes').doc(row._id).update({ attempts: (row.attempts || 0) + 1 })
      return auth.fail('CODE_ERROR', '验证码不正确')
    }
    await db.call(this).collection('lb-sms-codes').doc(row._id).update({ used: true })

    const found = await db.call(this).collection(usersCol).where({ mobile }).get()
    let user = found.data[0]
    let isNew = false
    const now = Date.now()
    if (!user) {
      // 手机号是唯一标识；用户名自动生成，避免与既有用户名冲突
      let username = `m_${mobile}`
      const dup = await db.call(this).collection(usersCol).where({ username }).count()
      if (dup.total > 0) username = `m_${mobile}_${String(now).slice(-4)}`
      const addRes = await db.call(this).collection(usersCol).add({
        username, password: auth.hashPassword(crypto.randomBytes(18).toString('hex')),
        password_set: false,
        nickname: '用户' + mobile.slice(-4), avatar: '', mobile,
        heightCm: 0, prePregnancyWeightKg: 0, birthYear: 0, role: [],
        status: 'active', register_date: now, last_login_date: now,
        currentJourneyId: '', sensitive_consent_at: 0, sensitive_consent_version: '', privacy_consent_version: ''
      })
      user = { _id: addRes.id, username, nickname: '用户' + mobile.slice(-4), avatar: '', mobile, status: 'active' }
      isNew = true
    } else {
      if (user.status === 'pending_deletion') {
        // 手机号验证码已证明持有关系：撤回注销并恢复账号（与密码登录的「撤回」等价）
        await db.call(this).collection(usersCol).doc(user._id).update({
          status: 'active', deletion_requested_at: 0, purge_at: 0, last_login_date: now
        })
        user.status = 'active'
      } else if (user.status !== 'active') {
        return auth.fail('ACCOUNT_DISABLED', '账号不可用')
      } else {
        await db.call(this).collection(usersCol).doc(user._id).update({ last_login_date: now })
      }
    }
    const issued = await _issueToken(user._id)
    return auth.ok(Object.assign(issued, {
      isNew,
      userInfo: { id: user._id, username: user.username, nickname: user.nickname, avatar: user.avatar || '', mobile }
    }))
  },

  /** 记录敏感个人信息单独同意（PIPL）：版本号由客户端与协议页共享 */
  async recordConsent(params = {}) {
    const g = await requireUser.call(this)
    if (g.errCode !== 0) return g
    const sensitive = String(params.sensitiveVersion || '').slice(0, 32)
    const privacy = String(params.privacyVersion || '').slice(0, 32)
    if (sensitive.length === 0 || privacy.length === 0) return auth.fail('PARAM_ERROR', '同意条款版本缺失')
    await db.call(this).collection(usersCol).doc(g.uid).update({
      sensitive_consent_at: Date.now(),
      sensitive_consent_version: sensitive,
      privacy_consent_version: privacy
    })
    return auth.ok({ consentedAt: Date.now(), sensitiveVersion: sensitive, privacyVersion: privacy })
  },

  /** 应用内意见反馈（带版本与平台，便于定位；不采集健康内容） */
  async submitFeedback(params = {}) {
    const g = await requireUser.call(this)
    if (g.errCode !== 0) return g
    const content = String(params.content || '').trim()
    if (content.length < 5 || content.length > 2000) return auth.fail('PARAM_ERROR', '反馈内容需 5-2000 字')
    const res = await db.call(this).collection('lb-feedback').add({
      user_id: g.uid, journey_id: String(params.journeyId || '').slice(0, 64),
      content, contact: String(params.contact || '').slice(0, 100),
      app_version: String(params.appVersion || '').slice(0, 40),
      platform: String(params.platform || '').slice(0, 20),
      status: 'open', created_at: Date.now()
    })
    await auth.logEvent(db.call(this), { userId: g.uid, journeyId: params.journeyId, event: 'feedback_submit', props: { platform: String(params.platform || '') } })
    return auth.ok({ feedbackId: res.id })
  },

  /**
   * 应用锁解锁：校验当前登录用户的密码（不签发新 token，仅返回校验结果）。
   * 生物识别不可用时的降级路径，避免"点一下即进"的假锁（docs/08 §8.9）。
   */
  async verifyPassword(params = {}) {
    const g = await requireUser.call(this)
    if (g.errCode !== 0) return g
    const res = await db.call(this).collection(usersCol).doc(g.uid).get()
    const user = res.data[0]
    if (!user) return auth.fail('ACCOUNT_NOT_EXISTS', '用户不存在')
    if (!auth.verifyPassword(String(params.password || ''), user.password)) {
      return auth.fail('PASSWORD_ERROR', '密码错误')
    }
    return auth.ok({ verified: true })
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
    await db.call(this).collection(usersCol).doc(g.uid).update({ password: auth.hashPassword(np), password_set: true })
    return auth.ok()
  },

  /**
   * 生成一次性恢复凭证（无需短信即可找回密码）。
   * 凭证仅在本次返回中出现一次，服务端只存哈希；使用后立刻作废。
   */
  async createRecoveryCode() {
    const g = await requireUser.call(this)
    if (g.errCode !== 0) return g
    const code = _recoveryCode()
    await db.call(this).collection(usersCol).doc(g.uid).update({
      recovery_hash: auth.hashPassword(code.replace(/-/g, '')),
      recovery_created_at: Date.now(),
      recovery_used_at: 0
    })
    return auth.ok({ code })
  },

  /**
   * 用恢复凭证重置密码（未登录可调用）。
   * 成功后吊销该账号全部 token，强制重新登录。
   */
  async resetPasswordByRecovery(params = {}) {
    const username = String(params.username || '').trim()
    const code = String(params.code || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase()
    const np = String(params.newPassword || '')
    if (!USERNAME_RE.test(username)) return auth.fail('RECOVERY_ERROR', '账号或恢复凭证不正确')
    if (np.length < 8 || np.length > 32) return auth.fail('PARAM_ERROR', '新密码长度需 8-32 位')
    // 防爆破：按「账号+IP」限速；与登录、撤回注销共享同一密码尝试预算
    const ipKey = clientKey(this)
    const rateKey = `pw:${username}` + (ipKey ? `:${ipKey}` : '')
    if (!auth.rateLimit(rateKey, 10, 10 * 60 * 1000)) {
      return auth.fail('TOO_MANY_REQUESTS', '尝试过于频繁，请稍后再试')
    }
    const res = await db.call(this).collection(usersCol).where({ username }).get()
    if (res.data.length === 0) return auth.fail('ACCOUNT_NOT_EXISTS', '账号不存在')
    const user = res.data[0]
    if (user.status !== 'active') return auth.fail('ACCOUNT_DISABLED', '账号当前不可用')
    if (!user.recovery_hash) return auth.fail('NO_RECOVERY_CODE', '该账号未设置恢复凭证，请登录后在设置中生成')
    if (!auth.verifyPassword(code, user.recovery_hash)) return auth.fail('RECOVERY_ERROR', '恢复凭证不正确')
    await db.call(this).collection(usersCol).doc(user._id).update({
      password: auth.hashPassword(np),
      password_set: true,
      recovery_hash: '',
      recovery_used_at: Date.now()
    })
    // 作废旧登录态，防止凭证泄露后被继续使用
    await db.call(this).collection(tokenCol).where({ uid: user._id }).update({ revoked: true })
    return auth.ok({ reset: true })
  },

  /**
   * 申请注销：30 天冷静期后彻底删除（docs/03）。
   * 立即生效：吊销全部 token、拦截登录；数据保留，供冷静期内撤回。
   */
  async requestDeletion(params = {}) {
    const g = await requireUser.call(this)
    if (g.errCode !== 0) return g
    const res = await db.call(this).collection(usersCol).doc(g.uid).get()
    const user = res.data[0]
    if (!user) return auth.fail('ACCOUNT_NOT_EXISTS', '用户不存在')
    const input = String(params.password || '')
    const okByPassword = auth.verifyPassword(input, user.password)
    const okByMobileConfirm = user.password_set === false && !!user.mobile && input === '注销'
    if (!okByPassword && !okByMobileConfirm) {
      return auth.fail('PASSWORD_ERROR', user.password_set !== false ? '密码错误' : '请输入「注销」确认')
    }
    const now = Date.now()
    const purgeAt = now + 30 * 24 * 3600 * 1000
    await db.call(this).collection(usersCol).doc(g.uid).update({
      status: 'pending_deletion', deletion_requested_at: now, purge_at: purgeAt
    })
    // 立即吊销该用户全部 token
    await db.call(this).collection(tokenCol).where({ uid: g.uid }).update({ revoked: true })
    return auth.ok({ purgeAt })
  },

  /**
   * 撤回注销：冷静期内的用户可用账号密码撤回（此时无有效 token）。
   */
  async cancelDeletion(params = {}) {
    const username = String(params.username || '').trim()
    const password = String(params.password || '')
    if (!USERNAME_RE.test(username)) return auth.fail('PASSWORD_ERROR', '用户名或密码错误')
    // 防密码爆破：该入口匿名可调，与登录、找回密码共享「账号+IP」预算
    const ipKey = clientKey(this)
    const rateKey = `pw:${username}` + (ipKey ? `:${ipKey}` : '')
    if (!auth.rateLimit(rateKey, 10, 10 * 60 * 1000)) {
      return auth.fail('TOO_MANY_REQUESTS', '尝试过于频繁，请稍后再试')
    }
    const res = await db.call(this).collection(usersCol).where({ username }).get()
    const user = res.data[0]
    if (!user) return auth.fail('ACCOUNT_NOT_EXISTS', '账号不存在')
    if (!auth.verifyPassword(password, user.password)) return auth.fail('PASSWORD_ERROR', '用户名或密码错误')
    if (user.status !== 'pending_deletion') return auth.fail('STATE_ERROR', '账号未处于注销冷静期')
    await db.call(this).collection(usersCol).doc(user._id).update({
      status: 'active', deletion_requested_at: 0, purge_at: 0
    })
    return auth.ok()
  }
}

/** 内部：生成一次性恢复凭证（去掉易混淆字符，展示为 XXXX-XXXX） */
const RECOVERY_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
function _recoveryCode() {
  let raw = ''
  for (let i = 0; i < 8; i++) raw += RECOVERY_ALPHABET[crypto.randomInt(RECOVERY_ALPHABET.length)]
  return `${raw.slice(0, 4)}-${raw.slice(4)}`
}

/** 内部：签发并落库 token（可吊销）。真实运行时 this 原型链无模块方法，内部调用一律走模块级函数。 */
async function _issueToken(uid) {
  const t = auth.createToken(uid, TOKEN_TTL_DAYS)
  await uniCloud.database().collection(tokenCol).add({ jti: t.jti, uid, tokenExpired: t.tokenExpired, revoked: false, created_at: Date.now() })
  return { token: t.token, tokenExpired: t.tokenExpired }
}
