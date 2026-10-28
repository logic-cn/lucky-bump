/**
 * lucky-care —— 产检中心
 * 职责：按国内常规产检指南生成日程（模板见 lucky-templates，高危提示以医生口径为准可自定义）、
 *       产检记录（项目/结果/费用/报告照片占位 fileID/下次产检时间）。
 */
'use strict'
const auth = require('./common/lucky-auth-common')
const T = require('./common/lucky-templates')

const DAY = 24 * 3600 * 1000
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

/** 按预产期生成产检排程（28 周前每 4 周 / 28-35 每 2 周 / 36+ 每周），匹配模板区间取项目 */
function buildPlan(j, now = Date.now()) {
  const anchor = j.lmp_date || (j.edd - 280 * DAY)
  const edd = j.edd
  const items = []
  for (const band of T.PRENATAL_CADENCE) {
    for (let w = band.weekFrom; w <= band.weekTo; w += band.everyWeeks) {
      const planTs = anchor + w * 7 * DAY
      if (planTs > edd) break
      const tpl = T.PRENATAL_PLAN.find(t => w >= t.weekFrom && w <= t.weekTo) || T.PRENATAL_PLAN[T.PRENATAL_PLAN.length - 1]
      items.push({
        kind: 'prenatal', week: w, plan_date: planTs,
        title: tpl.title, items: tpl.items, prep: tpl.prep,
        status: planTs < now ? 'due_confirm' : 'upcoming'
      })
    }
  }
  return items
}

module.exports = {
  /** 生成/重置产检排程（医生口径的"下次产检时间"始终可覆盖单条） */
  async generatePlan(params = {}) {
    const uid = await requireUser.call(this)
    if (!uid) return auth.fail('TOKEN_INVALID', '未登录')
    const j = await accessibleJourney.call(this, uid, params.journeyId, 'write')
    if (!j) return auth.fail('NOT_FOUND', '旅程不存在')
    if (!j.edd || j.delivery_date) return auth.fail('STATE_ERROR', '仅孕期旅程可生成产检排程')
    const col = db.call(this).collection('lb-schedule-items')
    const old = await col.where({ journey_id: j._id, kind: 'prenatal' }).get()
    for (const it of old.data) { if (it.status !== 'done') await col.doc(it._id).remove() }
    const now = Date.now()
    const items = buildPlan(j, now)
    const ids = []
    for (const it of items) {
      const r = await col.add(Object.assign({ user_id: uid, journey_id: j._id }, it, { created_at: now }))
      ids.push(r.id)
    }
    return auth.ok({ count: ids.length, note: T.PRENATAL_HIGH_RISK_NOTE })
  },

  async listPlan(params = {}) {
    const uid = await requireUser.call(this)
    if (!uid) return auth.fail('TOKEN_INVALID', '未登录')
    const j = await accessibleJourney.call(this, uid, params.journeyId)
    if (!j) return auth.fail('NOT_FOUND', '旅程不存在')
    const res = await db.call(this).collection('lb-schedule-items')
      .where({ journey_id: j._id, kind: 'prenatal' }).orderBy('plan_date', 'asc').limit(60).get()
    const now = Date.now()
    const list = res.data.map(x => Object.assign({}, x, {
      planDate: dateOf(x.plan_date),
      displayStatus: x.status === 'done' ? 'done' : (x.status === 'skipped' ? 'skipped' : (x.plan_date <= now ? 'due' : 'upcoming'))
    }))
    const next = list.find(x => x.displayStatus === 'upcoming' || x.displayStatus === 'due') || null
    return auth.ok({ items: list, next, highRiskNote: j.high_risk ? T.PRENATAL_HIGH_RISK_NOTE : '' })
  },

  /** 标记单条状态（done/skipped + 备注 + 实际日期），或由医生口径修改时间 */
  async updateItem(params = {}) {
    const uid = await requireUser.call(this)
    if (!uid) return auth.fail('TOKEN_INVALID', '未登录')
    const j = await accessibleJourney.call(this, uid, params.journeyId, 'write')
    if (!j) return auth.fail('NOT_FOUND', '旅程不存在')
    const col = db.call(this).collection('lb-schedule-items')
    const r = await col.doc(String(params.itemId)).get()
    const it = r.data[0]
    if (!it || it.user_id !== uid || it.journey_id !== j._id) return auth.fail('NOT_FOUND', '日程不存在')
    const patch = {}
    if (params.status && ['upcoming', 'done', 'skipped'].includes(params.status)) patch.status = params.status
    if (params.note !== undefined) patch.note = String(params.note).slice(0, 200)
    if (params.planDate) {
      const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(params.planDate)
      if (!d) return auth.fail('PARAM_ERROR', '日期无效')
      patch.plan_date = Date.UTC(+d[1], +d[2] - 1, +d[3], 12, 0, 0)
      patch.status = 'upcoming'
    }
    await col.doc(String(params.itemId)).update(patch)
    return auth.ok()
  },

  /** 录入一次产检 */
  async addVisit(params = {}) {
    const uid = await requireUser.call(this)
    if (!uid) return auth.fail('TOKEN_INVALID', '未登录')
    const j = await accessibleJourney.call(this, uid, params.journeyId, 'write')
    if (!j) return auth.fail('NOT_FOUND', '旅程不存在')
    const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(params.visitDate || '')
    if (!d) return auth.fail('PARAM_ERROR', '产检日期无效')
    const visitTs = Date.UTC(+d[1], +d[2] - 1, +d[3], 12, 0, 0)
    if (visitTs > Date.now() + DAY) return auth.fail('PARAM_ERROR', '产检日期不能在未来')
    const items = Array.isArray(params.items) ? params.items.slice(0, 30).map(x => ({
      code: String(x.code || '').slice(0, 24), name: String(x.name || '').slice(0, 30),
      result: String(x.result || '').slice(0, 100), abnormal: !!x.abnormal
    })) : []
    const res = await db.call(this).collection('lb-prenatal-visits').add({
      user_id: uid, journey_id: j._id, visit_ts: visitTs,
      hospital: String(params.hospital || '').slice(0, 40), doctor: String(params.doctor || '').slice(0, 20),
      week: Math.max(0, Math.min(45, +params.week || 0)), items,
      cost_yuan: Math.max(0, +params.costYuan || 0),
      conclusion: String(params.conclusion || '').slice(0, 500),
      report_file_ids: Array.isArray(params.reportFileIds) ? params.reportFileIds.slice(0, 12) : [],
      sensitivity: 'reports', created_at: Date.now()
    })
    // 下次产检时间（医生口径优先）：写入排程
    let nextId = ''
    if (params.nextVisitDate) {
      const n = /^(\d{4})-(\d{2})-(\d{2})$/.exec(params.nextVisitDate)
      if (n) {
        const r = await db.call(this).collection('lb-schedule-items').add({
          user_id: uid, journey_id: j._id, kind: 'prenatal_custom', plan_date: Date.UTC(+n[1], +n[2] - 1, +n[3], 12, 0, 0),
          title: '下次产检（医生口径）', items: [], prep: '', status: 'upcoming', created_at: Date.now()
        })
        nextId = r.id
      }
    }
    return auth.ok({ visitId: res.id, nextScheduleId: nextId })
  },

  async listVisits(params = {}) {
    const uid = await requireUser.call(this)
    if (!uid) return auth.fail('TOKEN_INVALID', '未登录')
    const j = await accessibleJourney.call(this, uid, params.journeyId)
    if (!j) return auth.fail('NOT_FOUND', '旅程不存在')
    const res = await db.call(this).collection('lb-prenatal-visits').where({ journey_id: j._id }).orderBy('visit_ts', 'desc').limit(50).get()
    return auth.ok({ visits: res.data.map(v => Object.assign({}, v, { visitDate: dateOf(v.visit_ts) })), totalCost: res.data.reduce((a, x) => a + (x.cost_yuan || 0), 0) })
  }
}
