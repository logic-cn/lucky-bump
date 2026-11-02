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

/** 家庭成员访问留痕（按人/动作/天去重，避免每次进首页都写一条） */
async function logAccess(uid, journeyId, action, date) {
  const dup = await db().collection('lb-audit-logs')
    .where({ journey_id: journeyId, user_id: uid, action, date }).limit(1).get()
  if (dup.data.length > 0) return
  await db().collection('lb-audit-logs').add({ journey_id: journeyId, user_id: uid, action, date, ts: Date.now() })
}

const CODE_LABELS = {
  weight: '体重', blood_pressure: '血压', blood_glucose: '血糖', symptom: '症状', mood: '心情',
  fetal_movement: '胎动', lochia: '恶露', kegel: '盆底肌训练', water: '饮水', medication: '用药',
  hcg: 'hCG', progesterone: '孕酮'
}
function codeLabel(code) { return CODE_LABELS[code] || code }

const SYMPTOM_LABELS = { cramp: '痛经', backache: '腰酸', headache: '头痛', mood: '情绪波动' }
function symptomLabel(code) { return SYMPTOM_LABELS[code] || code }

/** 曲线主数值提取 */
function primaryOf(code, value) {  if (!value) return null
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
    // 与 lucky-journey 同口径：四舍五入到最近一天，当天上午登记也归为产后
    const pd = Math.floor((now - j.delivery_date) / DAY + 0.5)
    return pd < 0 ? 'T3' : (pd < 42 ? 'POSTPARTUM' : (pd < 365 ? 'RECOVERY' : 'PARENTING'))
  }
  if (j.edd) {
    const anchor = j.lmp_date || (j.edd - 280 * DAY)
    const gest = Math.floor((now - anchor) / DAY + 0.5)
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
    const access = await auth.resolveJourneyAccess(db.call(this), uid, params.journeyId)
    if (!access.role || !access.journey) return auth.fail('NOT_FOUND', '旅程不存在')
    const j = access.journey
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
    const dones = await db.call(this).collection('lb-reminder-done').where({ journey_id: j._id }).limit(200).get()
    const doneKeys = new Set(dones.data.map(d => `${d.rule_id}|${d.due_date}`))
    const anchor = j.lmp_date || (j.edd ? j.edd - 280 * DAY : 0)
    for (const r of rules.data) {
      let due = 0
      if (r.type === 'absolute') due = /^\d{4}-\d{2}-\d{2}$/.test(r.anchor_date) ? Date.parse(r.anchor_date + 'T12:00:00Z') : 0
      else if (r.type === 'by_week' && anchor) due = anchor + r.week * 7 * DAY
      else if (r.type === 'by_month' && j.delivery_date) due = j.delivery_date + r.month * 30.4375 * DAY
      else if (r.type === 'recurring') due = (r.last_fired || now) + r.interval_days * DAY
      if (due && due - r.lead_days * DAY <= horizon) {
        const dueDate = dateOf(due)
        if (doneKeys.has(`${r._id}|${dueDate}`)) continue
        todos.push({ source: 'rule', ruleId: r._id, title: r.title, dueTs: due, dueDate, urgent: r.urgent, kind: 'reminder' })
      }
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
    // 产后/育儿期：妈妈日常卡（今日喂养/尿布/睡眠汇总，docs/03 M4.5）
    const stage = stageOf(j, now)
    let momCard = null
    if (['POSTPARTUM', 'RECOVERY', 'PARENTING'].includes(stage)) {
      const todayStr = dateOf(now)
      const feed = await db.call(this).collection('lb-feedings').where({ journey_id: j._id, date: todayStr }).count()
      const diaper = await db.call(this).collection('lb-diaper-changes').where({ journey_id: j._id, date: todayStr }).count()
      const sleeps = await db.call(this).collection('lb-sleep-sessions').where({ journey_id: j._id, date: todayStr }).get()
      let sleepMinutes = 0
      for (const s of sleeps.data) sleepMinutes += Math.max(0, +s.duration_min || 0)
      momCard = { date: todayStr, feedings: feed.total || 0, diapers: diaper.total || 0, sleepMinutes }
    }
    // 本周小结（周报卡）：最近 7 天记录条数 + 体重变化 + 连续记录周数 + 今日待办完成数 + 下一项日程
    const weekAgo = now - 7 * DAY
    const recentLogs = await db.call(this).collection('lb-daily-logs').where({ journey_id: j._id }).orderBy('ts', 'desc').limit(200).get()
    const weekLogs = recentLogs.data.filter(d => d.ts >= weekAgo).length
    const recentDiaries = await db.call(this).collection('lb-diaries').where({ journey_id: j._id }).orderBy('ts', 'desc').limit(100).get()
    const weekDiaries = recentDiaries.data.filter(d => d.ts >= weekAgo).length
    // 连续记录周数（含本周）：按 7 天桶往前数，中断即止；数据资产感的量化表达
    const WEEK = 7 * DAY
    const buckets = new Set()
    for (const d of recentLogs.data.concat(recentDiaries.data)) {
      if (d.ts >= now - 8 * WEEK) buckets.add(Math.floor((now - d.ts) / WEEK))
    }
    let streakWeeks = 0
    while (streakWeeks < 8 && buckets.has(streakWeeks)) streakWeeks++
    // 今日待办完成数（已完成的不出现在 todos 里，从完成表还原）
    const todayStr2 = dateOf(now)
    let todayDone = 0
    for (const d of dones.data) { if (d.due_date === todayStr2) todayDone++ }
    // 下一项日程（产检等）：取 14 天内最近一项
    let nextVisit = null
    if (plans.data.length > 0) nextVisit = { title: plans.data[0].title || '', date: dateOf(plans.data[0].plan_date) }
    const weekStats = { records: weekLogs + weekDiaries, weightDelta, streakWeeks, todayDone, nextVisit }
    // 留痕：仅家庭成员访问记录，主人本人操作不写（docs/03 M7.2）
    if (access.memberRole && access.memberRole !== 'owner') {
      await logAccess(uid, j._id, 'today', dateOf(now))
    }
    // 家人视角（爸爸端）经 today 拉旅程视图，需带齐孕周/产后天数等展示字段（与 lucky-journey.publicView 对齐）
    const anchor2 = j.lmp_date || (j.edd ? j.edd - 280 * DAY : 0)
    const gestDays = anchor2 ? Math.max(0, Math.floor((now - anchor2) / DAY)) : 0
    return auth.ok({
      journey: {
        _id: j._id, stage: stageOf(j, now), edd: j.edd ? dateOf(j.edd) : '',
        lmpDate: j.lmp_date ? dateOf(j.lmp_date) : '', deliveryDate: j.delivery_date ? dateOf(j.delivery_date) : '',
        fetusCount: j.fetus_count || 1, highRisk: !!j.high_risk, title: j.title || '',
        weeks: j.delivery_date ? 0 : Math.min(42, Math.floor(gestDays / 7)), days: j.delivery_date ? 0 : gestDays % 7,
        daysToEdd: j.edd ? Math.max(0, Math.round((j.edd - now) / DAY)) : 0,
        postpartumDays: j.delivery_date ? Math.max(0, Math.floor((now - j.delivery_date) / DAY)) : 0
      },
      todos, latest, weightDelta, momCard, weekStats, serverDate: dateOf(now)
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
    const meds = await db.call(this).collection('lb-medication-logs').where({ journey_id: j._id }).orderBy('ts', 'desc').limit(limit).get()
    for (const m of meds.data) events.push({ ts: m.ts, type: 'medication', code: 'medication', value: { name: m.name, dose: m.dose }, sensitivity: 'normal', _owner: m.user_id })
    // strict 红线：仅本人可见（不用 role 判断，安全审计 C1/C4）
    const visible = events
      .filter(e => e.sensitivity !== 'strict' || e._owner === uid)
      .map(e => ({ ts: e.ts, type: e.type, code: e.code, value: e.value, sensitivity: e.sensitivity }))
    visible.sort((a, b) => b.ts - a.ts)
    return auth.ok({ events: visible.slice(0, limit) })
  },

  /** 报告（docs/05 V1.3）：周期报告 / 年度生命报告；仅旅程主人可看 */
  async report(params = {}) {
    const uid = await requireUser.call(this)
    if (!uid) return auth.fail('TOKEN_INVALID', '未登录')
    const { role, journey } = await auth.resolveJourneyAccess(db.call(this), uid, params.journeyId)
    if (!journey) return auth.fail('NOT_FOUND', '旅程不存在')
    if (role !== 'owner') return auth.fail('PERMISSION_DENIED', '报告仅旅程主人可查看')
    const j = journey
    const dbase = db.call(this)
    const now = Date.now()
    const type = params.type === 'annual' ? 'annual' : (params.type === 'stage' ? 'stage' : 'cycle')
    await auth.logEvent(dbase, { userId: uid, journeyId: j._id, event: 'report_view', props: { type } })
    const stats = []
    const lines = []

    if (type === 'cycle') {
      const cyclesRes = await dbase.collection('lb-cycles').where({ journey_id: j._id }).orderBy('start_date', 'asc').limit(100).get()
      const starts = cyclesRes.data.map(c => c.start_date).sort((a, b) => a - b)
      const lens = []
      for (let i = 1; i < starts.length; i++) lens.push(Math.round((starts[i] - starts[i - 1]) / DAY))
      const recent = lens.slice(-6)
      const avg = recent.length > 0 ? Math.round(recent.reduce((a, b) => a + b, 0) / recent.length) : 0
      const shortest = lens.length > 0 ? Math.min(...lens) : 0
      const longest = lens.length > 0 ? Math.max(...lens) : 0
      let variance = 0
      for (const l of lens) variance += (l - avg) * (l - avg)
      const std = lens.length >= 2 ? Math.sqrt(variance / lens.length) : 0
      const regular = lens.length >= 2 && std <= 4
      const lastStart = starts.length > 0 ? new Date(starts[starts.length - 1]).toISOString().slice(0, 10) : ''

      // 经期伴随症状统计（仅 period_start 的 symptoms 数组）
      const evRes = await dbase.collection('lb-cycle-events').where({ journey_id: j._id, type: 'period_start' }).limit(200).get()
      const symCount = {}
      for (const e of evRes.data) {
        const arr = (e.value && e.value.symptoms) || []
        for (const s of arr) symCount[s] = (symCount[s] || 0) + 1
      }
      const symPairs = Object.keys(symCount).map(k => [k, symCount[k]]).sort((a, b) => b[1] - a[1]).slice(0, 3)

      const since = now - 90 * DAY
      const logsRes = await dbase.collection('lb-daily-logs').where({ journey_id: j._id }).orderBy('ts', 'desc').limit(500).get()
      const logs90 = logsRes.data.filter(x => x.ts >= since).length

      stats.push({ label: '记录周期', value: `${starts.length} 个` })
      stats.push({ label: '近 6 周期平均', value: avg > 0 ? `${avg} 天` : '—' })
      stats.push({ label: '最短 / 最长', value: lens.length > 0 ? `${shortest} / ${longest} 天` : '—' })
      stats.push({ label: '近 90 天记录', value: `${logs90} 条` })
      lines.push(starts.length >= 2 ? `你的周期${regular ? '整体规律' : '有一定波动'}，近 6 个周期平均 ${avg} 天。` : '再记录 1 个完整周期，就能看到周期规律了。')
      if (symPairs.length > 0) lines.push(`经期最常见的陪伴是：${symPairs.map(p => `${symptomLabel(p[0])}（${p[1]} 次）`).join('、')}。`)
      lines.push('预测会随着记录增多而收敛；如果周期持续短于 21 天或长于 35 天，建议带着这份记录就医。')
      return auth.ok({
        type, title: '周期报告', subtitle: lastStart.length > 0 ? `最近一次经期开始 ${lastStart}` : '还没有经期记录',
        stats, lines, generatedAt: now
      })
    }

    if (type === 'stage') {
      const stage = stageOf(j, now)
      let from = now - 30 * DAY
      let stageName = '近 30 天'
      if (j.delivery_date) {
        const pd = Math.floor((now - j.delivery_date) / DAY)
        if (pd < 42) { from = j.delivery_date; stageName = '产褥期' }
        else if (pd < 365) { from = j.delivery_date + 42 * DAY; stageName = '产后恢复期' }
        else { from = j.delivery_date + 365 * DAY; stageName = '育儿期' }
      } else if (j.edd && stage !== 'PRECONCEPTION') {
        const anchor = j.lmp_date || (j.edd - 280 * DAY)
        const gest = Math.floor((now - anchor) / DAY)
        if (gest < 98) { from = anchor; stageName = '孕早期' }
        else if (gest < 196) { from = anchor + 98 * DAY; stageName = '孕中期' }
        else { from = anchor + 196 * DAY; stageName = '孕晚期' }
      } else if (j.lmp_date) {
        from = Math.max(j.lmp_date, now - 90 * DAY)
        stageName = '备孕期'
      }
      const logsRes = await dbase.collection('lb-daily-logs').where({ journey_id: j._id }).orderBy('ts', 'desc').limit(2000).get()
      const logs = logsRes.data.filter(x => x.ts >= from && x.ts <= now)
      const daySet = new Set(logs.map(x => x.date))
      const weights = logs.filter(x => x.code === 'weight' && x.value && x.value.kg).map(x => ({ ts: x.ts, kg: x.value.kg })).sort((a, b) => a.ts - b.ts)
      const weightDelta = weights.length >= 2 ? Math.round((weights[weights.length - 1].kg - weights[0].kg) * 10) / 10 : null
      const visitRes = await dbase.collection('lb-prenatal-visits').where({ journey_id: j._id }).limit(200).get()
      const visits = visitRes.data.filter(v => v.visit_ts >= from && v.visit_ts <= now).length
      const msRes = await dbase.collection('lb-milestones').where({ journey_id: j._id }).limit(200).get()
      const ms = msRes.data.filter(m => m.achieved_date >= from && m.achieved_date <= now).length
      const days = Math.max(1, Math.floor((now - from) / DAY))

      stats.push({ label: '记录天数', value: `${daySet.size} / ${days} 天` })
      stats.push({ label: '记录条数', value: `${logs.length} 条` })
      stats.push({ label: '产检', value: `${visits} 次` })
      stats.push({ label: '里程碑', value: `${ms} 个` })
      if (weightDelta !== null) stats.push({ label: '体重变化', value: `${weightDelta > 0 ? '+' : ''}${weightDelta} kg` })

      lines.push(`${stageName}里，你在 ${days} 天中完成了 ${daySet.size} 天的记录。`)
      if (weightDelta !== null) lines.push(`体重变化 ${weightDelta > 0 ? '+' : ''}${weightDelta} kg，趋势比单次数字更重要。`)
      if (visits > 0) lines.push(`完成了 ${visits} 次产检/儿保随访，检查结果都留在记录里。`)
      if (ms > 0) lines.push(`宝宝点亮了 ${ms} 个成长里程碑。`)
      lines.push('阶段会过去，记录会留下；下一阶段的本周要点会自动更新。')
      return auth.ok({ type, title: '阶段报告', subtitle: `${stageName} · ${dateOf(from)} 至今`, stats, lines, generatedAt: now })
    }

    // 年度报告：近 365 天的记录密度与生命事件
    const since = now - 365 * DAY
    const logsRes = await dbase.collection('lb-daily-logs').where({ journey_id: j._id }).orderBy('ts', 'desc').limit(5000).get()
    const logs = logsRes.data.filter(x => x.ts >= since)
    const daySet = new Set(logs.map(x => x.date))
    const codeCount = {}
    for (const x of logs) codeCount[x.code] = (codeCount[x.code] || 0) + 1
    const topCodes = Object.keys(codeCount).map(k => [k, codeCount[k]]).sort((a, b) => b[1] - a[1]).slice(0, 3)

    const msRes = await dbase.collection('lb-milestones').where({ journey_id: j._id }).limit(200).get()
    const msYear = msRes.data.filter(m => m.achieved_date >= since)
    const photoRes = await dbase.collection('lb-album').where({ journey_id: j._id }).limit(1000).get()
    const photosYear = photoRes.data.filter(x => x.ts >= since)
    const foodRes = await dbase.collection('lb-food-logs').where({ journey_id: j._id }).limit(1000).get()
    const medRes = await dbase.collection('lb-medication-logs').where({ journey_id: j._id }).limit(1000).get()
    const feedRes = await dbase.collection('lb-feedings').where({ journey_id: j._id }).limit(5000).get()
    const feeds = feedRes.data.filter(x => x.ts >= since).length
    const triedFoods = [...new Set(foodRes.data.map(x => x.name))].length
    const anchor = j.lmp_date || j.delivery_date || j.created_at || now
    const journeyDays = Math.min(365, Math.max(1, Math.floor((now - anchor) / DAY)))

    stats.push({ label: '记录天数', value: `${daySet.size} 天` })
    stats.push({ label: '总记录', value: `${logs.length} 条` })
    stats.push({ label: '喂养记录', value: `${feeds} 次` })
    stats.push({ label: '成长里程碑', value: `${msYear.length} 个` })
    stats.push({ label: '照片', value: `${photosYear.length} 张` })
    stats.push({ label: '尝试食物', value: `${triedFoods} 种` })

    lines.push(`这一年，你在 ${journeyDays} 天里留下了 ${logs.length} 条记录、${photosYear.length} 张照片。`)
    if (topCodes.length > 0) lines.push(`记录最多的是：${topCodes.map(p => `${codeLabel(p[0])}（${p[1]} 次）`).join('、')}。`)
    if (msYear.length > 0) lines.push(`宝宝达成了 ${msYear.length} 个成长里程碑，每一个"第一次"都被记住了。`)
    if (triedFoods > 0) lines.push(`一起尝试了 ${triedFoods} 种食物，记录让过敏排查有据可查。`)
    if (medRes.data.length > 0) lines.push(`记录了 ${medRes.data.length} 次用药，就诊回溯更从容。`)
    lines.push('数据属于你：可随时导出、可彻底删除，也可以打印成一份给医生看。')
    return auth.ok({ type, title: '年度报告', subtitle: `${daySet.size} 天有记录 · 从 ${dateOf(anchor)} 到今天`, stats, lines, generatedAt: now })
  },

  async exportAll(params = {}) {
    const uid = await requireUser.call(this)
    if (!uid) return auth.fail('TOKEN_INVALID', '未登录')
    const { role, journey } = await auth.resolveJourneyAccess(db.call(this), uid, params.journeyId)
    if (!journey) return auth.fail('NOT_FOUND', '旅程不存在')
    if (role !== 'owner') return auth.fail('NOT_FOUND', '仅旅程主人可导出全量数据')
    const j = journey
    const collections = ['lb-journeys', 'lb-babies', 'lb-cycles', 'lb-cycle-events', 'lb-daily-logs', 'lb-tracker-sessions', 'lb-prenatal-visits', 'lb-schedule-items', 'lb-screenings', 'lb-feedings', 'lb-diaper-changes', 'lb-sleep-sessions', 'lb-growth-samples', 'lb-vaccinations', 'lb-milestones', 'lb-food-logs', 'lb-medication-logs', 'lb-child-health', 'lb-reminder-rules', 'lb-feedback', 'lb-events']
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
  },

  /** 访问留痕列表：仅旅程主人可见（docs/03 M7.2「谁在什么时间看了什么」） */
  async listAuditLogs(params = {}) {
    const uid = await requireUser.call(this)
    if (!uid) return auth.fail('TOKEN_INVALID', '未登录')
    const { journey } = await auth.resolveJourneyAccess(db.call(this), uid, params.journeyId)
    if (!journey || journey.user_id !== uid) return auth.fail('NOT_FOUND', '仅旅程主人可查看访问记录')
    const logs = await db.call(this).collection('lb-audit-logs')
      .where({ journey_id: journey._id }).orderBy('ts', 'desc').limit(30).get()
    // 昵称来自家庭组成员表，便于主人识别"谁看过"
    const fams = await db.call(this).collection('lb-families').where({ journey_id: journey._id }).get()
    const nameMap = {}
    for (const f of fams.data) {
      const ms = await db.call(this).collection('lb-family-members').where({ family_id: f._id }).get()
      for (const m of ms.data) nameMap[m.user_id] = m.nickname || '家人'
    }
    return auth.ok({
      logs: logs.data.map(l => ({
        nickname: nameMap[l.user_id] || '家人', action: l.action, date: l.date, ts: l.ts
      }))
    })
  }
}
