/**
 * lucky-data —— 数据中心：今日聚合（首屏一次请求）、指标曲线、时间线、全量导出
 */
'use strict'
const auth = require('./common/lucky-auth-common')

const DAY = 24 * 3600 * 1000
function db() { return uniCloud.database() }
async function requireUser() {
  const token = (this.__mockToken != null) ? this.__mockToken : this.getUniIdToken()
  const r = await auth.requireUser(db.call(this), token)
  return r.ok ? r.uid : null
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

/** 曲线主数值提取 */
function primaryOf(code, value) {
  if (!value) return null
  switch (code) {
    case 'weight': return { y: value.kg, unit: 'kg' }
    case 'blood_pressure': return { y: value.sbp, y2: value.dbp, unit: 'mmHg' }
    case 'blood_glucose': return { y: value.mmol, unit: 'mmol/L' }
    case 'hcg': return { y: value.iu, unit: 'IU/L' }
    case 'progesterone': return { y: value.ngml, unit: 'ng/ml' }
    case 'mood': return { y: value.score, unit: '' }
    default: return null
  }
}

/** 阶段推导（与 lucky-journey 同口径的只读镜像） */
function stageOf(j, now = Date.now()) {
  if (j.stage_code === 'MOURNING') return 'MOURNING'
  if (j.stage_code === 'ARCHIVED') return 'ARCHIVED'
  if (j.delivery_date) {
    const pd = Math.floor((now - j.delivery_date) / DAY)
    return pd < 0 ? 'T3' : (pd < 42 ? 'POSTPARTUM' : (pd < 365 ? 'RECOVERY' : 'PARENTING'))
  }
  if (j.edd) {
    const anchor = j.lmp_date || (j.edd - 280 * DAY)
    const gest = Math.floor((now - anchor) / DAY)
    if (gest < 0) return 'PRECONCEPTION'
    const wk = Math.floor(gest / 7)
    return wk < 14 ? 'T1' : (wk < 28 ? 'T2' : 'T3')
  }
  return 'PRECONCEPTION'
}

module.exports = {
  /** 首屏聚合：旅程视图 + 待办 + 关键指标 latest + 本周体重趋势摘要 */
  async today(params = {}) {
    const uid = await requireUser.call(this)
    if (!uid) return auth.fail('TOKEN_INVALID', '未登录')
    const j = await accessibleJourney.call(this, uid, params.journeyId)
    if (!j) return auth.fail('NOT_FOUND', '旅程不存在')
    // 产品红线：哀伤模式零孕育类待办（docs/03）；保持返回结构完整，前端依赖 journey/latest 字段
    if (j.stage_code === 'MOURNING') {
      return auth.ok({
        journey: {
          _id: j._id, stage: 'MOURNING', edd: j.edd ? dateOf(j.edd) : '', lmpDate: j.lmp_date ? dateOf(j.lmp_date) : '',
          deliveryDate: j.delivery_date ? dateOf(j.delivery_date) : '', fetusCount: j.fetus_count || 1,
          highRisk: !!j.high_risk, title: j.title || ''
        },
        todos: [], latest: {}, weightDelta: null, serverDate: dateOf(Date.now())
      })
    }
    const now = Date.now()
    const horizon = now + 14 * DAY
    const todos = []
    const rules = await db.call(this).collection('lb-reminder-rules').where({ journey_id: j._id, enabled: true }).get()
    const anchor = j.lmp_date || (j.edd ? j.edd - 280 * DAY : 0)
    for (const r of rules.data) {
      let due = 0
      if (r.type === 'absolute') due = /^\d{4}-\d{2}-\d{2}$/.test(r.anchor_date) ? Date.parse(r.anchor_date + 'T12:00:00Z') : 0
      else if (r.type === 'by_week' && anchor) due = anchor + r.week * 7 * DAY
      else if (r.type === 'by_month' && j.delivery_date) due = j.delivery_date + r.month * 30.4375 * DAY
      else if (r.type === 'recurring') due = (r.last_fired || now) + r.interval_days * DAY
      if (due && due - r.lead_days * DAY <= horizon) todos.push({ source: 'rule', ruleId: r._id, title: r.title, dueTs: due, dueDate: dateOf(due), urgent: r.urgent, kind: 'reminder' })
    }
    const plans = await db.call(this).collection('lb-schedule-items').where({ journey_id: j._id, status: 'upcoming' }).orderBy('plan_date', 'asc').limit(10).get()
    for (const p of plans.data) {
      if (p.plan_date <= horizon) todos.push({ source: 'schedule', scheduleId: p._id, title: p.title, dueTs: p.plan_date, dueDate: dateOf(p.plan_date), prep: p.prep || '', kind: p.kind })
    }
    todos.sort((a, b) => a.dueTs - b.dueTs)
    const latest = {}
    for (const code of ['weight', 'blood_pressure', 'blood_glucose']) {
      const r = await db.call(this).collection('lb-daily-logs').where({ journey_id: j._id, code }).orderBy('ts', 'desc').limit(1).get()
      latest[code] = r.data[0] || null
    }
    // 本周体重差（对比上一条）
    let weightDelta = null
    const w = await db.call(this).collection('lb-daily-logs').where({ journey_id: j._id, code: 'weight' }).orderBy('ts', 'desc').limit(2).get()
    if (w.data.length === 2) weightDelta = Math.round((w.data[0].value.kg - w.data[1].value.kg) * 10) / 10
    return auth.ok({
      journey: {
        _id: j._id, stage: stageOf(j, now), edd: j.edd ? dateOf(j.edd) : '',
        lmpDate: j.lmp_date ? dateOf(j.lmp_date) : '', deliveryDate: j.delivery_date ? dateOf(j.delivery_date) : '',
        fetusCount: j.fetus_count || 1, highRisk: !!j.high_risk, title: j.title || ''
      },
      todos, latest, weightDelta, serverDate: dateOf(now)
    })
  },

  async series(params = {}) {
    const uid = await requireUser.call(this)
    if (!uid) return auth.fail('TOKEN_INVALID', '未登录')
    const j = await accessibleJourney.call(this, uid, params.journeyId)
    if (!j) return auth.fail('NOT_FOUND', '旅程不存在')
    const res = await db.call(this).collection('lb-daily-logs')
      .where({ user_id: uid, journey_id: j._id, code: params.code }).orderBy('ts', 'asc').limit(1000).get()
    let data = res.data
    if (params.from || params.to) {
      const from = params.from ? Date.parse(params.from + 'T00:00:00Z') : 0
      const to = params.to ? Date.parse(params.to + 'T23:59:59Z') : Infinity
      data = data.filter(d => d.ts >= from && d.ts <= to)
    }
    const points = data.map(d => ({ date: d.date, ts: d.ts, primary: primaryOf(d.code, d.value), raw: d.value }))
    return auth.ok({ code: params.code, points })
  },

  /** 生命周期时间线：跨记录类型聚合 */
  async timeline(params = {}) {
    const uid = await requireUser.call(this)
    if (!uid) return auth.fail('TOKEN_INVALID', '未登录')
    const j = await accessibleJourney.call(this, uid, params.journeyId)
    if (!j) return auth.fail('NOT_FOUND', '旅程不存在')
    const limit = Math.min(200, +params.limit || 60)
    const events = []
    const metrics = await db.call(this).collection('lb-daily-logs').where({ journey_id: j._id }).orderBy('ts', 'desc').limit(limit).get()
    for (const m of metrics.data) events.push({ ts: m.ts, type: 'metric', code: m.code, value: m.value, sensitivity: m.sensitivity, _owner: m.user_id })
    const cycle = await db.call(this).collection('lb-cycle-events').where({ journey_id: j._id }).orderBy('ts', 'desc').limit(limit).get()
    for (const c of cycle.data) events.push({ ts: c.ts, type: 'cycle', code: c.type, value: c.value, sensitivity: c.sensitivity, _owner: c.user_id })
    const visits = await db.call(this).collection('lb-prenatal-visits').where({ journey_id: j._id }).orderBy('visit_ts', 'desc').limit(limit).get()
    for (const v of visits.data) events.push({ ts: v.visit_ts, type: 'visit', code: 'prenatal_visit', value: { hospital: v.hospital, week: v.week, conclusion: v.conclusion }, sensitivity: v.sensitivity, _owner: v.user_id })
    const milestones = await db.call(this).collection('lb-milestones').where({ journey_id: j._id }).orderBy('achieved_date', 'desc').limit(limit).get()
    for (const m of milestones.data) events.push({ ts: m.achieved_date, type: 'milestone', code: m.code, value: { dim: m.dim }, sensitivity: 'normal', _owner: m.user_id })
    // strict 红线：仅本人可见（不用 role 判断，安全审计 C1/C4）
    const visible = events
      .filter(e => e.sensitivity !== 'strict' || e._owner === uid)
      .map(e => ({ ts: e.ts, type: e.type, code: e.code, value: e.value, sensitivity: e.sensitivity }))
    visible.sort((a, b) => b.ts - a.ts)
    return auth.ok({ events: visible.slice(0, limit) })
  },

  /** 全量导出（数据属于用户）：JSON 结构化包 */
  async exportAll(params = {}) {
    const uid = await requireUser.call(this)
    if (!uid) return auth.fail('TOKEN_INVALID', '未登录')
    const { role, journey } = await auth.resolveJourneyAccess(db.call(this), uid, params.journeyId)
    if (!journey) return auth.fail('NOT_FOUND', '旅程不存在')
    if (role !== 'owner') return auth.fail('NOT_FOUND', '仅旅程主人可导出全量数据')
    const j = journey
    const collections = ['lb-journeys', 'lb-babies', 'lb-cycles', 'lb-cycle-events', 'lb-daily-logs', 'lb-tracker-sessions', 'lb-prenatal-visits', 'lb-schedule-items', 'lb-screenings', 'lb-feedings', 'lb-diaper-changes', 'lb-sleep-sessions', 'lb-growth-samples', 'lb-vaccinations', 'lb-milestones', 'lb-food-logs', 'lb-medication-logs', 'lb-reminder-rules']
    const out = {}
    for (const c of collections) {
      const r = await db.call(this).collection(c).where({ journey_id: j._id }).limit(5000).get()
      // strict 红线：导出同样只含本人数据（安全审计 C4）
      out[c] = auth.visibilityFilter(r.data, uid)
    }
    return auth.ok({ exportedAt: Date.now(), journeyId: j._id, data: out })
  },

  /**
   * 可读摘要（JSON 之外的人类可读版本，docs/03 M6.4）：仅旅程主人可取。
   * 返回纯文本，前端直接展示/复制，不引入 PDF 生成依赖。
   */
  async exportSummary(params = {}) {
    const uid = await requireUser.call(this)
    if (!uid) return auth.fail('TOKEN_INVALID', '未登录')
    const { role, journey } = await auth.resolveJourneyAccess(db.call(this), uid, params.journeyId)
    if (!journey) return auth.fail('NOT_FOUND', '旅程不存在')
    if (role !== 'owner') return auth.fail('NOT_FOUND', '仅旅程主人可导出全量数据')
    const j = journey
    const counts = [
      ['lb-daily-logs', '指标'], ['lb-diaries', '日记'], ['lb-prenatal-visits', '产检'],
      ['lb-feedings', '喂养'], ['lb-diaper-changes', '尿布'], ['lb-sleep-sessions', '睡眠'],
      ['lb-growth-samples', '成长'], ['lb-vaccinations', '疫苗'], ['lb-milestones', '里程碑']
    ]
    const parts = []
    for (const [c, label] of counts) {
      const r = await db.call(this).collection(c).where({ journey_id: j._id }).count()
      if ((r.total || 0) > 0) parts.push(`${label} ${r.total} 条`)
    }
    // strict 红线：摘要中的指标只取本人记录
    const latestWeight = await db.call(this).collection('lb-daily-logs').where({ journey_id: j._id, code: 'weight', user_id: uid }).orderBy('ts', 'desc').limit(1).get()
    const latestBp = await db.call(this).collection('lb-daily-logs').where({ journey_id: j._id, code: 'blood_pressure', user_id: uid }).orderBy('ts', 'desc').limit(1).get()
    const lines = [
      '幸孕记 · 数据摘要',
      `旅程：${j.title || '未命名'}（${stageOf(j)}）`,
      `预产期：${j.edd ? dateOf(j.edd) : '未设置'}　分娩日：${j.delivery_date ? dateOf(j.delivery_date) : '未登记'}`,
      `记录总量：${parts.length > 0 ? parts.join(' · ') : '暂无记录'}`
    ]
    if (latestWeight.data[0]) lines.push(`最近体重：${latestWeight.data[0].value.kg}kg（${latestWeight.data[0].date}）`)
    if (latestBp.data[0]) lines.push(`最近血压：${latestBp.data[0].value.sbp}/${latestBp.data[0].value.dbp} mmHg（${latestBp.data[0].date}）`)
    lines.push(`导出时间：${dateOf(Date.now())}`)
    return auth.ok({ summary: lines.join('\n'), exportedAt: Date.now(), journeyId: j._id })
  }
}
