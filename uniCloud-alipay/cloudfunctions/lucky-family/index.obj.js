/**
 * lucky-family —— 家庭组（妈妈=管理员 / 爸爸=记录者 / 长辈=围观者）
 * 数据组授权矩阵按「数据组 × 角色」过滤；同房与 EPDS 服务端硬编码仅本人（docs/03 M7.1）。
 */
'use strict'
const auth = require('./common/lucky-auth-common')

const DAY = 24 * 3600 * 1000
// 可授权数据组（strict 组不可授权，见 STRICT_ONLY）
const GROUPS = ['prenatal', 'reports', 'emotions', 'diary', 'intimate', 'screenings']
// 服务端硬编码：仅本人可见的数据组（产品级约束，任何授权不可覆盖）
const STRICT_ONLY = new Set(['intimate', 'screenings'])
const ROLES = ['admin', 'recorder', 'viewer']

function db() { return uniCloud.database() }
async function requireUser() {
  const token = (this.__mockToken != null) ? this.__mockToken : this.getUniIdToken()
  const r = await auth.requireUser(db.call(this), token)
  return r.ok ? r.uid : null
}
async function ownedJourney(uid, journeyId) {
  const r = await db.call(this).collection('lb-journeys').where({ _id: journeyId, user_id: uid }).get()
  return r.data[0] || null
}
async function familyOf(journeyId) {
  const r = await db.call(this).collection('lb-families').where({ journey_id: journeyId }).limit(1).get()
  return r.data[0] || null
}
/** 成员对旅程的访问角色：owner / recorder / viewer / null */
async function accessOf(uid, journeyId) {
  const j = await db.call(this).collection('lb-journeys').doc(String(journeyId)).get()
  const journey = j.data[0]
  if (!journey) return null
  if (journey.user_id === uid) return 'owner'
  const fam = await familyOf.call(this, journeyId)
  if (!fam) return null
  const m = await db.call(this).collection('lb-family-members').where({ family_id: fam._id, user_id: uid }).limit(1).get()
  if (m.data.length === 0) return null
  const role = m.data[0].role
  return role === 'admin' ? 'owner' : role
}

/** 成员展示名：兼容历史数据里占位的“我”，避免两个“我”同时出现 */
function memberView(m, ownerId) {
  const nick = m.nickname && m.nickname !== '我' ? m.nickname : (m.user_id === ownerId ? '妈妈' : '家人')
  return { _id: m._id, user_id: m.user_id, role: m.role, nickname: nick, joinedAt: m.joined_at, isMe: false }
}

module.exports = {
  _accessOf: accessOf,

  /** 家庭成员自助解析：我在哪个家庭/共享旅程、什么角色（爸爸端引导的根基；只返回本人成员关系，无泄露面） */
  async myFamily() {
    const uid = await requireUser.call(this)
    if (!uid) return auth.fail('TOKEN_INVALID', '未登录')
    const m = await db.call(this).collection('lb-family-members').where({ user_id: uid }).limit(1).get()
    if (m.data.length === 0) return auth.ok({ member: null })
    const fam = await db.call(this).collection('lb-families').doc(m.data[0].family_id).get()
    if (!fam.data || fam.data.length === 0) return auth.ok({ member: null })
    const f = Array.isArray(fam.data) ? fam.data[0] : fam.data
    return auth.ok({ member: { familyId: f._id, journeyId: f.journey_id, role: m.data[0].role, nickname: m.data[0].nickname || '' } })
  },

  async getFamily(params = {}) {
    const uid = await requireUser.call(this)
    if (!uid) return auth.fail('TOKEN_INVALID', '未登录')
    const j = await ownedJourney.call(this, uid, params.journeyId)
    if (!j) {
      // 受邀成员没有自己的旅程：按成员关系返回所在家庭，供成员端查看
      const mine = await db.call(this).collection('lb-family-members').where({ user_id: uid }).limit(1).get()
      if (mine.data.length === 0) return auth.fail('NOT_FOUND', '旅程不存在')
      const fr = await db.call(this).collection('lb-families').doc(mine.data[0].family_id).get()
      if (!fr.data || fr.data.length === 0) return auth.fail('NOT_FOUND', '家庭组不存在')
      const f = Array.isArray(fr.data) ? fr.data[0] : fr.data
      const members = await db.call(this).collection('lb-family-members').where({ family_id: f._id }).get()
      return auth.ok({ family: f, members: members.data.map(m => Object.assign(memberView(m, f.owner_id), { isMe: m.user_id === uid })) })
    }
    let fam = await familyOf.call(this, j._id)
    if (!fam) {
      const r = await db.call(this).collection('lb-families').add({
        journey_id: j._id, owner_id: uid, name: '我的家庭',
        matrix: { recorder: { prenatal: true, reports: true, emotions: true, diary: true }, viewer: { prenatal: true, reports: false, emotions: false, diary: false } },
        created_at: Date.now()
      })
      await db.call(this).collection('lb-family-members').add({ family_id: r.id, user_id: uid, role: 'admin', nickname: '我', joined_at: Date.now() })
      fam = Object.assign({ _id: r.id })
    }
    const members = await db.call(this).collection('lb-family-members').where({ family_id: fam._id }).get()
    return auth.ok({ family: fam, members: members.data.map(m => Object.assign(memberView(m, fam.owner_id), { isMe: m.user_id === uid })) })
  },

  /** 生成邀请码（默认邀请为记录者/爸爸） */
  async invite(params = {}) {
    const uid = await requireUser.call(this)
    if (!uid) return auth.fail('TOKEN_INVALID', '未登录')
    const j = await ownedJourney.call(this, uid, params.journeyId)
    if (!j) return auth.fail('NOT_FOUND', '旅程不存在')
    const fam = await familyOf.call(this, j._id)
    if (!fam) return auth.fail('STATE_ERROR', '请先创建家庭组')
    const code = Math.random().toString(36).slice(2, 8).toUpperCase()
    await db.call(this).collection('lb-family-invites').add({
      code, family_id: fam._id, journey_id: j._id, role: ROLES.includes(params.role) ? params.role : 'recorder',
      used: false, expires_at: Date.now() + 3 * DAY, created_at: Date.now()
    })
    await auth.logEvent(db.call(this), { userId: uid, journeyId: j._id, event: 'family_invite', props: { role: ROLES.includes(params.role) ? params.role : 'recorder' } })
    return auth.ok({ code, expiresInDays: 3 })
  },

  async join(params = {}) {
    const uid = await requireUser.call(this)
    if (!uid) return auth.fail('TOKEN_INVALID', '未登录')
    const code = String(params.code || '').trim().toUpperCase()
    const r = await db.call(this).collection('lb-family-invites').where({ code, used: false }).limit(1).get()
    const inv = r.data[0]
    if (!inv) return auth.fail('INVITE_INVALID', '邀请码无效')
    if (inv.expires_at < Date.now()) return auth.fail('INVITE_EXPIRED', '邀请码已过期')
    const dup = await db.call(this).collection('lb-family-members').where({ family_id: inv.family_id, user_id: uid }).limit(1).get()
    if (dup.data.length > 0) return auth.fail('STATE_ERROR', '你已在家庭组中')
    await db.call(this).collection('lb-family-invites').doc(inv._id).update({ used: true })
    await db.call(this).collection('lb-family-members').add({ family_id: inv.family_id, user_id: uid, role: inv.role, nickname: String(params.nickname || '家人').slice(0, 12), joined_at: Date.now() })
    await auth.logEvent(db.call(this), { userId: uid, journeyId: inv.journey_id, event: 'family_join', props: { role: inv.role } })
    return auth.ok({ journeyId: inv.journey_id, role: inv.role })
  },

  async setRole(params = {}) {
    const uid = await requireUser.call(this)
    if (!uid) return auth.fail('TOKEN_INVALID', '未登录')
    const j = await ownedJourney.call(this, uid, params.journeyId)
    if (!j) return auth.fail('NOT_FOUND', '旅程不存在')
    const fam = await familyOf.call(this, j._id)
    if (!fam) return auth.fail('NOT_FOUND', '家庭组不存在')
    if (!ROLES.includes(params.role)) return auth.fail('PARAM_ERROR', '角色无效')
    await db.call(this).collection('lb-family-members').where({ family_id: fam._id, user_id: String(params.memberUserId) }).update({ role: params.role })
    return auth.ok()
  },

  /** 设置数据组授权（intimate/screenings 硬编码拒绝） */
  async setPermission(params = {}) {
    const uid = await requireUser.call(this)
    if (!uid) return auth.fail('TOKEN_INVALID', '未登录')
    const j = await ownedJourney.call(this, uid, params.journeyId)
    if (!j) return auth.fail('NOT_FOUND', '旅程不存在')
    const fam = await familyOf.call(this, j._id)
    if (!fam) return auth.fail('NOT_FOUND', '家庭组不存在')
    if (!GROUPS.includes(params.group)) return auth.fail('PARAM_ERROR', '数据组无效')
    if (STRICT_ONLY.has(params.group)) return auth.fail('PERMISSION_DENIED', '该数据组为隐私组，仅本人可见，不可授权')
    if (!['recorder', 'viewer'].includes(params.role)) return auth.fail('PARAM_ERROR', '角色无效')
    const matrix = JSON.parse(JSON.stringify(fam.matrix || {}))
    matrix[params.role] = matrix[params.role] || {}
    matrix[params.role][params.group] = !!params.allow
    await db.call(this).collection('lb-families').doc(fam._id).update({ matrix })
    return auth.ok({ matrix })
  },

  async removeMember(params = {}) {
    const uid = await requireUser.call(this)
    if (!uid) return auth.fail('TOKEN_INVALID', '未登录')
    const j = await ownedJourney.call(this, uid, params.journeyId)
    if (!j) return auth.fail('NOT_FOUND', '旅程不存在')
    const fam = await familyOf.call(this, j._id)
    if (!fam) return auth.fail('NOT_FOUND', '家庭组不存在')
    await db.call(this).collection('lb-family-members').where({ family_id: fam._id, user_id: String(params.memberUserId) }).remove()
    return auth.ok()
  }
}
