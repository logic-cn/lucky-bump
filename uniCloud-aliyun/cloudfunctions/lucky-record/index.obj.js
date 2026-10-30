/**
 * lucky-record —— 备孕/孕期/产后记录引擎
 * 职责：指标白名单校验与落库、周期事件（经期/试纸/BBT/同房/验孕）、排卵预测、
 *       计时器（宫缩/亲喂/吸奶）与 5-1-1 判定、恶露、EPDS 量表、红线提示。
 * 红线约定（docs/03）：只描述现象 + 建议动作，绝不诊断。
 */
'use strict'
const auth = require('./common/lucky-auth-common')
const T = require('./common/lucky-templates')

const DAY = 24 * 3600 * 1000
const LOGS = 'lb-daily-logs'
const EVENTS = 'lb-cycle-events'
const CYCLES = 'lb-cycles'
const TRACKERS = 'lb-tracker-sessions'

function db() { return uniCloud.database() }

/* ---------------- 权限 ---------------- */
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
function parseDate(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ''))
  if (!m) return NaN
  return Date.UTC(+m[1], +m[2] - 1, +m[3], 12, 0, 0)
}

/* ---------------- 指标白名单（docs/03 M2/M4） ---------------- */
// redline: 返回 {level:'warn'|'critical', message, action}
const METRICS = {
  weight: { label: '体重', num: { kg: [30, 300] }, unit: 'kg', sensitivity: 'normal' },
  fetal_movement: { label: '胎动', num: { count: [0, 500], durationMin: [0, 240] }, optional: ['durationMin'], unit: '次' },
  blood_pressure: {
    label: '血压', num: { sbp: [60, 260], dbp: [30, 160], hr: [30, 220] }, unit: 'mmHg',
    redline(v) {
      if (v.sbp >= 160 || v.dbp >= 110) return { level: 'critical', message: `血压 ${v.sbp}/${v.dbp}mmHg 已达重度升高范围`, action: '请立即就医' }
      if (v.sbp >= 140 || v.dbp >= 90) return { level: 'warn', message: `血压 ${v.sbp}/${v.dbp}mmHg 偏高`, action: '静息复测一次，如仍偏高请告知产检医生' }
      return null
    }
  },
  blood_glucose: {
    label: '血糖', num: { mmol: [1, 35] }, unit: 'mmol/L', enum: { slot: ['fasting', '1h', '2h', 'random'] },
    redline(v) {
      if (v.slot === 'fasting' && v.mmol >= 5.1) return { level: 'warn', message: `空腹血糖 ${v.mmol} ≥ 5.1 参考切点`, action: '建议与医生确认 GDM 管理方案' }
      if (v.slot === '1h' && v.mmol >= 10.0) return { level: 'warn', message: `餐后1h血糖 ${v.mmol} ≥ 10.0 参考切点`, action: '建议与医生确认 GDM 管理方案' }
      if (v.slot === '2h' && v.mmol >= 8.5) return { level: 'warn', message: `餐后2h血糖 ${v.mmol} ≥ 8.5 参考切点`, action: '建议与医生确认 GDM 管理方案' }
      return null
    }
  },
  hcg: { label: 'hCG', num: { iu: [0, 10000000] }, unit: 'IU/L' },
  progesterone: { label: '孕酮', num: { ngml: [0, 500] }, unit: 'ng/ml' },
  symptom: { label: '症状', enum: { severity: [1, 2, 3] }, array: 'codes', text: 'note', sensitivity: 'normal', ref: T.SYMPTOMS },
  mood: { label: '情绪', num: { score: [1, 5] }, sensitivity: 'normal' },
  lochia: {
    label: '恶露', enum: { color: ['bright_red', 'dark_red', 'pink', 'white_brown'], amount: ['light', 'medium', 'heavy'] }, bool: ['clots', 'odor'], sensitivity: 'normal',
    redline(v) {
      if (v.amount === 'heavy' && (v.clots || v.color === 'bright_red')) return { level: 'warn', message: '恶露量多伴血块/持续鲜红', action: '如突然大量出血请立即就医；持续超过 2 周请就诊' }
      if (v.odor) return { level: 'warn', message: '恶露异味', action: '如伴发热请尽快就医' }
      return null
    }
  },
  kegel: { label: '凯格尔训练', num: { sets: [1, 20], reps: [1, 100] } },
  water: { label: '饮水', num: { ml: [0, 10000] } },
  medication: { label: '用药', text: 'name', text2: 'dose', sensitivity: 'normal' }
}
const STRICT_SENSITIVE = new Set(['intercourse', 'pregnancy_test', 'epds'])

function validateMetric(code, value) {
  const def = METRICS[code]
  if (!def) return { error: `未知指标 ${code}` }
  if (def.num) {
    for (const [k, [lo, hi]] of Object.entries(def.num)) {
      if (value[k] === undefined) {
        if (def.optional && def.optional.includes(k)) continue
        if (k === 'hr' && code === 'blood_pressure') continue
        return { error: `缺少字段 ${k}` }
      }
      const n = +value[k]
      if (!Number.isFinite(n) || n < lo || n > hi) return { error: `字段 ${k} 超出范围 [${lo}, ${hi}]` }
      value[k] = Math.round(n * 100) / 100
    }
  }
  if (def.enum) for (const [k, allowed] of Object.entries(def.enum)) {
    if (value[k] !== undefined && !allowed.includes(value[k])) return { error: `字段 ${k} 取值无效` }
  }
  if (def.bool) for (const k of def.bool) value[k] = !!value[k]
  if (def.array) {
    if (!Array.isArray(value.codes) || value.codes.length === 0) return { error: '缺少 codes' }
    if (def.ref) {
      const known = new Set(def.ref.map(s => s.code))
      const unknown = value.codes.filter(c => !known.has(c))
      if (unknown.length) return { error: `未知症状码 ${unknown.join(',')}` }
    }
  }
  for (const k of ['text', 'text2']) if (def[k]) value[def[k]] = String(value[def[k]] || '').slice(0, 200)
  return { value }
}

/** 症状红线：出现红线词即返回指引（docs/03 M2.5） */
const SYMPTOM_REDLINE_MAP = {
  bleeding: '孕期出血请立即就医', severe_pain: '剧烈腹痛请立即就医',
  reduced_fm: '胎动明显减少：安静侧卧观察 1 小时，仍少请联系医生或就诊',
  water_broke: '破水：平躺并立即前往医院',
  severe_vomiting: '若无法进食进水超过 12 小时，警惕妊娠剧吐，请就医'
}

/* ---------------- 5-1-1 宫缩判定（docs/03 M2.8） ---------------- */
function evaluate511(sessions, now = Date.now()) {
  // 取最近 4 小时已完成宫缩，按开始时间排序
  const cs = sessions.filter(s => s.type === 'contraction' && s.ended_at).map(s => ({ start: s.started_at, dur: s.ended_at - s.started_at }))
    .filter(s => s.start > now - 4 * 3600 * 1000 && s.dur >= 1000).sort((a, b) => a.start - b.start)
  if (cs.length < 3) return { qualified: false, message: '' }
  let best = { span: 0 }
  for (let i = 0; i < cs.length; i++) {
    let prevEnd = cs[i].start + cs[i].dur
    let j = i
    while (j + 1 < cs.length) {
      const interval = cs[j + 1].start - cs[j].start
      if (interval > 5 * 60 * 1000) break
      if (cs[j + 1].dur < 60 * 1000) break
      prevEnd = cs[j + 1].start + cs[j + 1].dur
      j++
    }
    const span = prevEnd - cs[i].start
    if (span > best.span) best = { span, first: cs[i], count: j - i + 1 }
  }
  if (best.span >= 60 * 60 * 1000 && best.count >= 3) {
    return { qualified: true, message: '宫缩已出现约 5 分钟一次、每次约 1 分钟、持续 1 小时的规律，建议准备前往医院' }
  }
  return { qualified: false, message: '' }
}

/* ---------------- EPDS 计分（1/2 题反向，第 10 题特殊） ---------------- */
function scoreEpds(answers) {
  if (!Array.isArray(answers) || answers.length !== 10 || answers.some(a => !Number.isInteger(+a) || +a < 0 || +a > 3)) return null
  const a = answers.map(Number)
  let score = 0
  a.forEach((v, i) => { score += (i === 0 || i === 1) ? 3 - v : v })
  return { score, selfHarm: a[9] > 0 }
}

/* ---------------- 周期预测（docs/03 M1.1/M1.2） ---------------- */
function predictCycle(cycles, events, now = Date.now()) {
  const starts = cycles.map(c => c.start_date).sort()
  if (starts.length === 0) return null
  const lens = []
  for (let i = 1; i < starts.length; i++) lens.push(Math.round((starts[i] - starts[i - 1]) / DAY))
  const avgLen = lens.length ? Math.round(lens.reduce((a, b) => a + b, 0) / lens.length) : 28
  const regular = lens.length >= 2 && lens.every(l => Math.abs(l - avgLen) <= 7)
  const lastStart = starts[starts.length - 1]
  const strongOvu = events.filter(e => e.type === 'ovulation_test' && e.value.result === 'strong_positive').map(e => e.date).sort().pop()
  const nextStart = lastStart + avgLen * DAY
  const ovuDay = strongOvu ? parseDate(strongOvu) : nextStart - 14 * DAY
  return {
    avgCycleLength: avgLen, regular,
    nextPeriodDate: dateOf(nextStart),
    fertileWindow: { from: dateOf(ovuDay - 2 * DAY), to: dateOf(ovuDay + 1 * DAY) },
    ovulationDate: dateOf(ovuDay),
    basedOn: strongOvu ? 'ovulation_test' : 'calendar'
  }
}

module.exports = {
  /**
   * 能力探测：客户端据此判断能否安全重放离线队列。
   * 未部署本版本时该方法不存在，客户端会保持队列不重放，避免重复记录。
   */
  async capabilities() {
    return auth.ok({ offlineQueue: true, clientId: true })
  },

  /** 添加指标记录。value 结构按 METRICS 白名单校验 */
  async addMetric(params = {}) {
    const uid = await requireUser.call(this)
    if (!uid) return auth.fail('TOKEN_INVALID', '未登录')
    const j = await accessibleJourney.call(this, uid, params.journeyId, 'write')
    if (!j) return auth.fail('NOT_FOUND', '旅程不存在')
    const code = params.code
    const v = validateMetric(code, params.value || {})
    if (v.error) return auth.fail('PARAM_ERROR', v.error)
    const ts = params.ts || Date.now()
    const clientId = String(params.clientId || '').slice(0, 64)
    // 离线补写幂等：同一 clientId 只落一条（客户端断网重放不会产生重复记录）
    if (clientId) {
      const dup = await db.call(this).collection(LOGS).where({ journey_id: j._id, client_id: clientId }).limit(1).get()
      if (dup.data[0]) return auth.ok({ recordId: dup.data[0]._id, redline: null, duplicated: true })
    }
    const doc = {
      user_id: uid, journey_id: j._id, code, value: v.value,
      date: params.date || dateOf(ts), ts, client_id: clientId,
      stage_snapshot: j.edd && !j.delivery_date ? `W${Math.floor(Math.max(0, daysBetween2(j.lmp_date || (j.edd - 280 * DAY), ts)) / 7)}` : '',
      sensitivity: (METRICS[code] && METRICS[code].sensitivity) || 'normal',
      created_at: Date.now()
    }
    const res = await db.call(this).collection(LOGS).add(doc)
    // 红线判定
    let redline = null
    if (METRICS[code].redline) redline = METRICS[code].redline(v.value)
    if (code === 'symptom') {
      const hits = v.value.codes.filter(c => SYMPTOM_REDLINE_MAP[c])
      if (hits.length) redline = { level: 'critical', message: SYMPTOM_REDLINE_MAP[hits[0]], action: '查看就医指引' }
    }
    return auth.ok({ recordId: res.id, redline })
  },

  async listMetrics(params = {}) {
    const uid = await requireUser.call(this)
    if (!uid) return auth.fail('TOKEN_INVALID', '未登录')
    const j = await accessibleJourney.call(this, uid, params.journeyId)
    if (!j) return auth.fail('NOT_FOUND', '旅程不存在')
    const q = { journey_id: j._id }
    if (params.code) q.code = params.code
    const res = await db.call(this).collection(LOGS).where(q).orderBy('ts', 'desc').limit(Math.min(500, +params.limit || 100)).get()
    // strict 红线：只保留本人（安全审计 C2/C4）
    let data = auth.visibilityFilter(res.data, uid)
    if (params.from || params.to) {
      const from = params.from ? parseDate(params.from) : 0
      const to = params.to ? parseDate(params.to) + DAY : Infinity
      data = data.filter(d => d.ts >= from && d.ts < to)
    }
    return auth.ok({ records: data })
  },

  async latestMetrics(params = {}) {
    const uid = await requireUser.call(this)
    if (!uid) return auth.fail('TOKEN_INVALID', '未登录')
    const j = await accessibleJourney.call(this, uid, params.journeyId)
    if (!j) return auth.fail('NOT_FOUND', '旅程不存在')
    const out = {}
    for (const code of params.codes || []) {
      // 取 5 条再过滤：strict 记录被剔除后仍能取到下一条可见记录
      const r = await db.call(this).collection(LOGS).where({ journey_id: j._id, code }).orderBy('ts', 'desc').limit(5).get()
      out[code] = auth.visibilityFilter(r.data, uid)[0] || null
    }
    return auth.ok({ latest: out })
  },

  /** 周期事件：period_start/period_end/ovulation_test/bbt/intercourse/pregnancy_test */
  async addCycleEvent(params = {}) {
    const uid = await requireUser.call(this)
    if (!uid) return auth.fail('TOKEN_INVALID', '未登录')
    const j = await accessibleJourney.call(this, uid, params.journeyId, 'write')
    if (!j) return auth.fail('NOT_FOUND', '旅程不存在')
    const type = params.type
    if (!['period_start', 'period_end', 'ovulation_test', 'bbt', 'intercourse', 'pregnancy_test'].includes(type)) {
      return auth.fail('PARAM_ERROR', 'type 无效')
    }
    const ts = params.ts || Date.now()
    const value = params.value || {}
    const doc = { user_id: uid, journey_id: j._id, type, value, date: params.date || dateOf(ts), ts, sensitivity: STRICT_SENSITIVE.has(type) ? 'strict' : 'normal', created_at: Date.now() }
    if (type === 'ovulation_test' && !['weak_positive', 'strong_positive', 'negative'].includes(value.result)) return auth.fail('PARAM_ERROR', '试纸结果无效')
    if (type === 'bbt') { const t = +value.tempC; if (!(t >= 34 && t <= 42)) return auth.fail('PARAM_ERROR', '体温超出范围') }
    if (type === 'pregnancy_test' && !['negative', 'faint', 'positive'].includes(value.result)) return auth.fail('PARAM_ERROR', '验孕结果无效')
    const res = await db.call(this).collection(EVENTS).add(doc)
    // 经期开始：登记周期
    if (type === 'period_start') {
      await db.call(this).collection(CYCLES).add({ user_id: uid, journey_id: j._id, start_date: parseDate(doc.date), end_date: 0, created_at: Date.now() })
    }
    if (type === 'period_end') {
      const openCycles = await db.call(this).collection(CYCLES).where({ journey_id: j._id, end_date: 0 }).orderBy('start_date', 'desc').limit(1).get()
      if (openCycles.data[0]) await db.call(this).collection(CYCLES).doc(openCycles.data[0]._id).update({ end_date: parseDate(doc.date) })
    }
    return auth.ok({ recordId: res.id, pregnancyPositive: type === 'pregnancy_test' && value.result !== 'negative' })
  },

  async listCycleEvents(params = {}) {
    const uid = await requireUser.call(this)
    if (!uid) return auth.fail('TOKEN_INVALID', '未登录')
    const j = await accessibleJourney.call(this, uid, params.journeyId)
    if (!j) return auth.fail('NOT_FOUND', '旅程不存在')
    const res = await db.call(this).collection(EVENTS).where({ journey_id: j._id }).orderBy('ts', 'desc').limit(200).get()
    const cycles = await db.call(this).collection(CYCLES).where({ user_id: uid, journey_id: j._id }).orderBy('start_date', 'asc').get()
    // strict 红线：只保留本人（安全审计 C3/C4）
    const events = auth.visibilityFilter(res.data, uid)
    return auth.ok({ events, cycles: cycles.data, prediction: predictCycle(cycles.data, events) })
  },

  /** 计时器开始（宫缩/亲喂/吸奶） */
  async startTracker(params = {}) {
    const uid = await requireUser.call(this)
    if (!uid) return auth.fail('TOKEN_INVALID', '未登录')
    const j = await accessibleJourney.call(this, uid, params.journeyId, 'write')
    if (!j) return auth.fail('NOT_FOUND', '旅程不存在')
    if (!['contraction', 'nursing', 'pumping'].includes(params.type)) return auth.fail('PARAM_ERROR', 'type 无效')
    const started = params.startedAt || Date.now()
    const res = await db.call(this).collection(TRACKERS).add({
      user_id: uid, journey_id: j._id, type: params.type,
      side: ['left', 'right'].includes(params.side) ? params.side : '',
      started_at: started, ended_at: 0, amount_ml: 0, created_at: Date.now()
    })
    return auth.ok({ sessionId: res.id, startedAt: started })
  },

  async stopTracker(params = {}) {
    const uid = await requireUser.call(this)
    if (!uid) return auth.fail('TOKEN_INVALID', '未登录')
    const r = await db.call(this).collection(TRACKERS).doc(String(params.sessionId)).get()
    const s = r.data[0]
    if (!s || s.user_id !== uid) return auth.fail('NOT_FOUND', '计时不存在')
    const ended = params.endedAt || Date.now()
    const patch = { ended_at: Math.max(ended, s.started_at + 1000), amount_ml: Math.max(0, Math.min(2000, +params.amountMl || 0)) }
    await db.call(this).collection(TRACKERS).doc(String(params.sessionId)).update(patch)
    // 亲喂换边提醒：连续 3 次同侧（docs/03 M5.1）
    let hint = null
    if (s.type === 'nursing' && patch.sideHint !== false) {
      const recent = await db.call(this).collection(TRACKERS).where({ user_id: uid, type: 'nursing' }).orderBy('started_at', 'desc').limit(3).get()
      const sides = recent.data.map(x => x.side).filter(Boolean)
      if (sides.length === 3 && sides.every(x => x === sides[0])) hint = `连续 ${sides.length} 次同一侧，记得换边`
    }
    return auth.ok(Object.assign({ session: Object.assign(s, patch) }, hint ? { hint } : {}))
  },

  async listTrackers(params = {}) {
    const uid = await requireUser.call(this)
    if (!uid) return auth.fail('TOKEN_INVALID', '未登录')
    const j = await accessibleJourney.call(this, uid, params.journeyId)
    if (!j) return auth.fail('NOT_FOUND', '旅程不存在')
    const q = { journey_id: j._id }
    if (params.type) q.type = params.type
    if (params.activeOnly) q.ended_at = 0
    const res = await db.call(this).collection(TRACKERS).where(q).orderBy('started_at', 'desc').limit(200).get()
    return auth.ok({ sessions: res.data })
  },

  /** 5-1-1 就医提示判定 */
  async contractionAdvice(params = {}) {
    const uid = await requireUser.call(this)
    if (!uid) return auth.fail('TOKEN_INVALID', '未登录')
    const j = await accessibleJourney.call(this, uid, params.journeyId)
    if (!j) return auth.fail('NOT_FOUND', '旅程不存在')
    const res = await db.call(this).collection(TRACKERS).where({ journey_id: j._id, type: 'contraction' }).orderBy('started_at', 'desc').limit(100).get()
    return auth.ok(evaluate511(res.data))
  },

  /** EPDS 产后情绪自评。结果绝对私密：仅本人可见（产品级硬约束）。 */
  async submitEpds(params = {}) {
    const uid = await requireUser.call(this)
    if (!uid) return auth.fail('TOKEN_INVALID', '未登录')
    const j = await accessibleJourney.call(this, uid, params.journeyId, 'write')
    if (!j || j.user_id !== uid) return auth.fail('PERMISSION_DENIED', '情绪自评仅本人可用')
    if (!j) return auth.fail('NOT_FOUND', '旅程不存在')
    const s = scoreEpds(params.answers)
    if (!s) return auth.fail('PARAM_ERROR', '答案需为 10 项 0-3 分值')
    await db.call(this).collection('lb-screenings').add({
      user_id: uid, journey_id: j._id, type: 'epds', answers: params.answers,
      score: s.score, self_harm: s.selfHarm, ts: Date.now(), sensitivity: 'strict'
    })
    let action = s.score >= 13 ? '可能存在产后情绪困扰，建议与家人沟通并寻求专业帮助'
      : (s.score >= 10 ? '情绪状态值得关注，多休息、多倾诉，2 周后可复测' : '当前状态平稳，继续保持记录与休息')
    if (s.selfHarm) action = '你此刻的感受很重要：请立即联系信任的家人，或拨打心理援助热线寻求帮助'
    return auth.ok({ score: s.score, selfHarm: s.selfHarm, action, disclaimer: '本量表为自我参考工具，不构成诊断' })
  },

  /** 孕期日记：文本 + 媒体占位（docs/03 M2.9） */
  async addDiary(params = {}) {
    const uid = await requireUser.call(this)
    if (!uid) return auth.fail('TOKEN_INVALID', '未登录')
    const j = await accessibleJourney.call(this, uid, params.journeyId, 'write')
    if (!j) return auth.fail('NOT_FOUND', '旅程不存在')
    const text = String(params.text || '').trim().slice(0, 2000)
    if (!text) return auth.fail('PARAM_ERROR', '日记内容不能为空')
    const ts = params.ts || Date.now()
    const clientId = String(params.clientId || '').slice(0, 64)
    if (clientId) {
      const dup = await db.call(this).collection('lb-diaries').where({ journey_id: j._id, client_id: clientId }).limit(1).get()
      if (dup.data[0]) return auth.ok({ recordId: dup.data[0]._id, duplicated: true })
    }
    const res = await db.call(this).collection('lb-diaries').add({
      user_id: uid, journey_id: j._id, text,
      mood: ['great', 'good', 'normal', 'low', 'bad'].includes(params.mood) ? params.mood : 'normal',
      media_ids: Array.isArray(params.mediaIds) ? params.mediaIds.slice(0, 9) : [],
      date: params.date || dateOf(ts), ts, client_id: clientId, sensitivity: 'normal', created_at: Date.now()
    })
    return auth.ok({ recordId: res.id })
  },

  async listDiaries(params = {}) {
    const uid = await requireUser.call(this)
    if (!uid) return auth.fail('TOKEN_INVALID', '未登录')
    const j = await accessibleJourney.call(this, uid, params.journeyId)
    if (!j) return auth.fail('NOT_FOUND', '旅程不存在')
    const res = await db.call(this).collection('lb-diaries').where({ journey_id: j._id }).orderBy('ts', 'desc').limit(50).get()
    return auth.ok({ diaries: res.data })
  },

  async listEpds(params = {}) {
    const uid = await requireUser.call(this)
    if (!uid) return auth.fail('TOKEN_INVALID', '未登录')
    const res = await db.call(this).collection('lb-screenings').where({ journey_id: params.journeyId, type: 'epds', user_id: uid }).orderBy('ts', 'desc').limit(50).get()
    return auth.ok({ screenings: res.data })
  }
}

/* daysBetween2: 供快照使用的日差（与服务端同口径） */
function daysBetween2(fromMs, toMs) { return Math.floor((toMs - fromMs) / DAY) }
