/**
 * lucky-care —— 产检中心
 * 职责：按国内常规产检指南生成日程（模板见 lucky-templates，高危提示以医生口径为准可自定义）、
 *       产检记录（项目/结果/费用/报告照片占位 fileID/下次产检时间）。
 */
'use strict'
const auth = require('./common/lucky-auth-common')
const T = require('./common/lucky-templates')

const DAY = 24 * 3600 * 1000
function db() { return uniCloud.database() }
async function requireUser() {
  const token = (this.__mockToken != null) ? this.__mockToken : this.getUniIdToken()
  const r = await auth.requireUser(db.call(this), token)
  return r.ok ? r.uid : null
}
async function accessibleJourney(uid, journeyId, need = 'read') {
  const access = await journeyAccess.call(this, uid, journeyId, need)
  return access ? access.journey : null
}
/** 完整访问上下文（含 matrix），供数据组授权判断使用 */
async function journeyAccess(uid, journeyId, need = 'read') {
  const access = await auth.resolveJourneyAccess(db.call(this), uid, journeyId)
  if (!access.role || !access.journey) return null
  if (need === 'write' && access.role === 'viewer') return null
  return access
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
  /** 儿保体检：记录身高体重头围、医生结论与下次体检时间（AI 儿保单识别待外部服务） */
  async addChildHealth(params = {}) {
    const uid = await requireUser.call(this)
    if (!uid) return auth.fail('TOKEN_INVALID', '未登录')
    const j = await accessibleJourney.call(this, uid, params.journeyId, 'write')
    if (!j) return auth.fail('NOT_FOUND', '旅程不存在')
    const bRes = await db.call(this).collection('lb-babies').where({ _id: String(params.babyId || ''), journey_id: j._id, user_id: uid }).limit(1).get()
    const baby = bRes.data[0]
    if (!baby) return auth.fail('NOT_FOUND', '宝宝不存在')
    const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(params.date || '')
    if (!d) return auth.fail('PARAM_ERROR', '体检日期无效')
    const ts = Date.UTC(+d[1], +d[2] - 1, +d[3], 12, 0, 0)
    if (ts > Date.now() + DAY) return auth.fail('PARAM_ERROR', '体检日期不能在未来')
    const monthAge = Math.max(0, Math.floor((ts - baby.birth_date) / (30.4375 * DAY)))
    const res = await db.call(this).collection('lb-child-health').add({
      user_id: uid, journey_id: j._id, baby_id: baby._id,
      date: params.date, ts, month_age: monthAge,
      hospital: String(params.hospital || '').slice(0, 40),
      weight_kg: Math.max(0, Math.min(50, +params.weightKg || 0)),
      height_cm: Math.max(0, Math.min(150, +params.heightCm || 0)),
      head_cm: Math.max(0, Math.min(70, +params.headCm || 0)),
      conclusion: String(params.conclusion || '').slice(0, 500),
      advice: String(params.advice || '').slice(0, 500),
      next_date: String(params.nextDate || '').slice(0, 10),
      created_at: Date.now()
    })
    await auth.logEvent(db.call(this), { userId: uid, journeyId: j._id, event: 'record_create', props: { type: 'child_health' } })
    return auth.ok({ recordId: res.id, monthAge })
  },

  async listChildHealth(params = {}) {
    const uid = await requireUser.call(this)
    if (!uid) return auth.fail('TOKEN_INVALID', '未登录')
    const j = await accessibleJourney.call(this, uid, params.journeyId)
    if (!j) return auth.fail('NOT_FOUND', '旅程不存在')
    const bRes = await db.call(this).collection('lb-babies').where({ _id: String(params.babyId || ''), journey_id: j._id, user_id: uid }).limit(1).get()
    if (!bRes.data[0]) return auth.fail('NOT_FOUND', '宝宝不存在')
    const res = await db.call(this).collection('lb-child-health').where({ baby_id: bRes.data[0]._id }).orderBy('ts', 'desc').limit(50).get()
    return auth.ok({ records: res.data })
  },

  /** 生成/重置产检排程（医生口径的"下次产检时间"始终可覆盖单条） */
  async generatePlan(params = {}) {
    const uid = await requireUser.call(this)
    if (!uid) return auth.fail('TOKEN_INVALID', '未登录')
    const access = await journeyAccess.call(this, uid, params.journeyId, 'write')
    if (!access) return auth.fail('NOT_FOUND', '旅程不存在')
    if (!auth.canAccessGroup(access, 'prenatal', 'write')) return auth.fail('PERMISSION_DENIED', '家人未开放产检数据')
    const j = access.journey
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
    const access = await journeyAccess.call(this, uid, params.journeyId)
    if (!access) return auth.fail('NOT_FOUND', '旅程不存在')
    if (!auth.canAccessGroup(access, 'prenatal')) return auth.fail('PERMISSION_DENIED', '家人未开放产检数据')
    const j = access.journey
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
    const access = await journeyAccess.call(this, uid, params.journeyId, 'write')
    if (!access) return auth.fail('NOT_FOUND', '旅程不存在')
    if (!auth.canAccessGroup(access, 'prenatal', 'write')) return auth.fail('PERMISSION_DENIED', '家人未开放产检数据')
    const j = access.journey
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
    const access = await journeyAccess.call(this, uid, params.journeyId, 'write')
    if (!access) return auth.fail('NOT_FOUND', '旅程不存在')
    if (!auth.canAccessGroup(access, 'prenatal', 'write')) return auth.fail('PERMISSION_DENIED', '家人未开放产检数据')
    const reportFileIds = Array.isArray(params.reportFileIds) ? params.reportFileIds.slice(0, 12) : []
    const wantsReports = reportFileIds.length > 0
      || String(params.conclusion || '').trim().length > 0
      || (Array.isArray(params.items) && params.items.some(x => x && String(x.result || '').trim()))
    if (wantsReports && !auth.canAccessGroup(access, 'reports', 'write')) {
      return auth.fail('PERMISSION_DENIED', '家人未开放检查报告数据')
    }
    const j = access.journey
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
      report_file_ids: reportFileIds,
      sensitivity: 'reports', created_at: Date.now()
    })
    await auth.logEvent(db.call(this), { userId: uid, journeyId: j._id, event: 'record_create', props: { type: 'visit' } })
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
    const access = await journeyAccess.call(this, uid, params.journeyId)
    if (!access) return auth.fail('NOT_FOUND', '旅程不存在')
    if (!auth.canAccessGroup(access, 'prenatal')) return auth.fail('PERMISSION_DENIED', '家人未开放产检数据')
    const reportsAllowed = auth.canAccessGroup(access, 'reports')
    const j = access.journey
    const res = await db.call(this).collection('lb-prenatal-visits').where({ journey_id: j._id }).orderBy('visit_ts', 'desc').limit(50).get()
    const visits = res.data.map(v => {
      const row = Object.assign({}, v, { visitDate: dateOf(v.visit_ts) })
      if (!reportsAllowed) {
        // 检查报告组未授权：结论、报告图、逐项结果都属于报告内容
        row.report_file_ids = []
        row.conclusion = ''
        row.items = (Array.isArray(row.items) ? row.items : []).map(x => ({ code: x.code, name: x.name }))
      }
      return row
    })
    return auth.ok({ visits, totalCost: res.data.reduce((a, x) => a + (x.cost_yuan || 0), 0) })
  }
}
