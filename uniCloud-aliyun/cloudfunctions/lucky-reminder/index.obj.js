/**
 * lucky-reminder —— 提醒引擎
 * 规则类型：绝对日期 / 相对孕周 / 相对月龄 / 周期打卡；输出"未来 N 天待办投影"。
 * 策略：免打扰时段由端上执行；未处理超 24h 降级为站内待办不再推送（docs/03 M9）。
 */
'use strict'
const auth = require('../common/lucky-auth-common')

const DAY = 24 * 3600 * 1000
const MONTH = 30.4375 * DAY
function db() { return this.uniCloud.database() }
async function requireUser() {
  const token = (this.__mockToken != null) ? this.__mockToken : this.getUniIdToken()
  const v = auth.verifyToken(token)
  return v.ok ? v.uid : null
}
async function accessibleJourney(uid, journeyId, need = 'read') {
  const { role, journey } = await auth.resolveJourneyAccess(db.call(this), uid, journeyId)
  if (!role || !journey) return null
  if (need === 'write' && role === 'viewer') return null
  return journey
}
async function accessRole(uid, journeyId) {
  const { role } = await auth.resolveJourneyAccess(db.call(this), uid, journeyId)
  return role
}
function dateOf(ts) { return new Date(ts).toISOString().slice(0, 10) }

module.exports = {
  async addRule(params = {}) {
    const uid = await requireUser.call(this)
    if (!uid) return auth.fail('TOKEN_INVALID', '未登录')
    const j = await accessibleJourney.call(this, uid, params.journeyId, 'write')
    if (!j) return auth.fail('NOT_FOUND', '旅程不存在')
    const type = params.type
    if (!['absolute', 'by_week', 'by_month', 'recurring'].includes(type)) return auth.fail('PARAM_ERROR', 'type 无效')
    const res = await db.call(this).collection('lb-reminder-rules').add({
      user_id: uid, journey_id: j._id, type,
      title: String(params.title || '提醒').slice(0, 30),
      anchor_date: params.anchorDate || '',      // absolute: YYYY-MM-DD
      week: Math.max(0, Math.min(45, +params.week || 0)),   // by_week
      month: Math.max(0, +params.month || 0),    // by_month
      interval_days: Math.max(1, +params.intervalDays || 1), // recurring
      lead_days: Math.max(0, Math.min(7, +params.leadDays || 1)),
      urgent: !!params.urgent, enabled: true, created_at: Date.now()
    })
    return auth.ok({ ruleId: res.id })
  },

  async listRules(params = {}) {
    const uid = await requireUser.call(this)
    if (!uid) return auth.fail('TOKEN_INVALID', '未登录')
    const res = await db.call(this).collection('lb-reminder-rules').where({ journey_id: params.journeyId }).orderBy('created_at', 'desc').get()
    return auth.ok({ rules: res.data })
  },

  async updateRule(params = {}) {
    const uid = await requireUser.call(this)
    if (!uid) return auth.fail('TOKEN_INVALID', '未登录')
    const patch = {}
    if (params.enabled !== undefined) patch.enabled = !!params.enabled
    if (params.title) patch.title = String(params.title).slice(0, 30)
    await db.call(this).collection('lb-reminder-rules').doc(String(params.ruleId)).update(patch)
    return auth.ok()
  },

  async removeRule(params = {}) {
    const uid = await requireUser.call(this)
    if (!uid) return auth.fail('TOKEN_INVALID', '未登录')
    await db.call(this).collection('lb-reminder-rules').where({ _id: String(params.ruleId), user_id: uid }).remove()
    return auth.ok()
  },

  /** 未来 N 天待办投影：规则 + 产检排程聚合 */
  async listDue(params = {}) {
    const uid = await requireUser.call(this)
    if (!uid) return auth.fail('TOKEN_INVALID', '未登录')
    const j = await accessibleJourney.call(this, uid, params.journeyId)
    if (!j) return auth.fail('NOT_FOUND', '旅程不存在')
    const now = Date.now()
    const horizon = now + Math.min(60, Math.max(1, +params.days || 14)) * DAY
    const todos = []
    const rules = await db.call(this).collection('lb-reminder-rules').where({ journey_id: j._id, enabled: true }).get()
    const anchor = j.lmp_date || (j.edd ? j.edd - 280 * DAY : 0)
    for (const r of rules.data) {
      let due = 0
      if (r.type === 'absolute') due = /^(\d{4})-(\d{2})-(\d{2})$/.test(r.anchor_date) ? Date.parse(r.anchor_date + 'T12:00:00Z') : 0
      else if (r.type === 'by_week' && anchor) due = anchor + r.week * 7 * DAY
      else if (r.type === 'by_month' && j.delivery_date) due = j.delivery_date + r.month * MONTH
      else if (r.type === 'recurring') {
        let t = (r.last_fired || now)
        due = t + r.interval_days * DAY
      }
      if (!due) continue
      if (due - r.lead_days * DAY <= horizon) {
        todos.push({ source: 'rule', ruleId: r._id, title: r.title, dueTs: due - r.lead_days * DAY, dueDate: dateOf(due), urgent: r.urgent, kind: 'reminder' })
      }
    }
    const plans = await db.call(this).collection('lb-schedule-items').where({ journey_id: j._id, status: 'upcoming' }).orderBy('plan_date', 'asc').limit(30).get()
    for (const p of plans.data) {
      if (p.plan_date <= horizon) todos.push({ source: 'schedule', scheduleId: p._id, title: p.title, dueTs: p.plan_date, dueDate: dateOf(p.plan_date), prep: p.prep || '', kind: p.kind })
    }
    todos.sort((a, b) => a.dueTs - b.dueTs)
    return auth.ok({ todos: todos.slice(0, 30), serverDate: dateOf(now) })
  },

  /** 标记规则已触发（用于 recurring 推进） */
  async markFired(params = {}) {
    const uid = await requireUser.call(this)
    if (!uid) return auth.fail('TOKEN_INVALID', '未登录')
    await db.call(this).collection('lb-reminder-rules').where({ _id: String(params.ruleId), user_id: uid }).update({ last_fired: Date.now() })
    return auth.ok()
  }
}
