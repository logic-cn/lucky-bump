/**
 * lucky-baby —— 育儿记录引擎
 * 职责：喂养/尿布/睡眠记录与日汇总、成长测量与 WHO 百分位（内置锚点插值，可升级 LMS）、
 *       国家免疫规划疫苗计划生成与接种记录、里程碑、辅食 3 天观察窗、用药记录。
 */
'use strict'
const auth = require('./common/lucky-auth-common')
const T = require('./common/lucky-templates')

const DAY = 24 * 3600 * 1000
const MONTH = 30.4375 * DAY

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
async function ownedBaby(uid, journeyId, babyId) {
  // 旅程访问权已由 accessibleJourney 验证；宝宝按旅程归属校验（家庭成员可读写）
  const r = await db.call(this).collection('lb-babies').where({ _id: babyId, journey_id: journeyId }).get()
  return r.data[0] || null
}
function dateOf(ts) { return new Date(ts).toISOString().slice(0, 10) }
function parseDate(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ''))
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], 12, 0, 0) : NaN
}
/** 日历月龄（如 3 个月 2 天） */
function monthAge(birthMs, atMs) {
  const d = new Date(birthMs), a = new Date(atMs)
  let months = (a.getUTCFullYear() - d.getUTCFullYear()) * 12 + (a.getUTCMonth() - d.getUTCMonth())
  if (a.getUTCDate() < d.getUTCDate()) months -= 1
  const anchor = new Date(d); anchor.setUTCMonth(d.getUTCMonth() + months)
  const days = Math.max(0, Math.floor((atMs - anchor.getTime()) / DAY))
  return { months: Math.max(0, months), days }
}

/* WHO 0-36 月关键百分位锚点（kg / cm，近似 WHO 2006 标准值，用于插值展示；红线条带 3rd/97th） */
const WHO = {
  weight: {
    female: { months: [0, 1, 2, 3, 6, 9, 12, 18, 24, 36], p: { 3: [2.4, 3.4, 4.2, 4.8, 5.8, 6.9, 7.8, 9.1, 10.2, 11.9], 15: [2.8, 3.9, 4.7, 5.3, 6.5, 7.7, 8.7, 10.2, 11.5, 13.5], 50: [3.2, 4.2, 5.1, 5.8, 7.3, 8.5, 9.6, 11.5, 12.9, 14.8], 85: [3.7, 4.8, 5.7, 6.5, 8.1, 9.6, 10.8, 13.2, 14.8, 17.3], 97: [4.2, 5.5, 6.6, 7.5, 9.3, 11.0, 12.4, 15.3, 17.1, 20.2] } },
    male: { months: [0, 1, 2, 3, 6, 9, 12, 18, 24, 36], p: { 3: [2.5, 3.6, 4.5, 5.0, 6.4, 7.5, 8.4, 9.8, 10.8, 12.3], 15: [3.0, 4.1, 5.0, 5.6, 7.1, 8.4, 9.4, 11.1, 12.3, 14.0], 50: [3.3, 4.5, 5.6, 6.4, 7.9, 9.2, 10.2, 12.2, 13.6, 15.3], 85: [3.9, 5.2, 6.3, 7.2, 9.0, 10.5, 11.7, 14.0, 15.7, 18.0], 97: [4.4, 6.0, 7.1, 8.0, 10.0, 11.8, 13.3, 16.0, 17.8, 20.7] } }
  },
  height: {
    female: { months: [0, 1, 2, 3, 6, 9, 12, 18, 24, 36], p: { 3: [46.0, 50.0, 53.0, 55.4, 60.2, 65.0, 69.9, 76.7, 81.4, 88.5], 50: [49.1, 53.7, 57.1, 59.8, 65.7, 70.1, 74.0, 80.7, 85.7, 95.1], 97: [52.1, 57.4, 61.1, 64.1, 71.2, 75.1, 78.1, 84.7, 89.8, 101.3] } },
    male: { months: [0, 1, 2, 3, 6, 9, 12, 18, 24, 36], p: { 3: [46.1, 51.1, 54.4, 57.0, 61.8, 66.4, 71.0, 77.7, 82.3, 89.4], 50: [49.9, 54.7, 58.4, 61.4, 67.6, 72.0, 75.7, 82.3, 87.1, 96.1], 97: [53.7, 58.6, 62.4, 65.8, 73.5, 77.5, 80.5, 87.1, 92.0, 102.7] } }
  },
  head: {
    female: { months: [0, 3, 6, 12, 24, 36], p: { 3: [31.5, 37.3, 39.5, 42.2, 44.5, 45.3], 50: [33.9, 40.2, 42.2, 44.9, 47.2, 48.1], 97: [36.2, 43.0, 44.9, 47.6, 49.8, 50.8] } },
    male: { months: [0, 3, 6, 12, 24, 36], p: { 3: [32.4, 38.0, 40.3, 43.1, 45.5, 46.4], 50: [34.9, 41.0, 43.3, 45.9, 48.3, 49.2], 97: [37.4, 43.9, 46.1, 48.7, 51.0, 52.0] } }
  }
}
/** 值 → 百分位估计（锚点间线性插值） */
function percentileOf(metric, sex, months, value) {
  const table = WHO[metric] && WHO[metric][sex]
  if (!table || !Number.isFinite(value)) return null
  const ms = table.months
  const m = Math.min(Math.max(months, ms[0]), ms[ms.length - 1])
  const pctLevels = [3, 50, 97].filter(p => table.p[p])
  // 在锚点月龄间插值得到各百分位对应值，再在百分位轴上线性插值
  const vals = pctLevels.map(p => {
    const arr = table.p[p]
    for (let i = 1; i < ms.length; i++) {
      if (m <= ms[i]) {
        const t = (m - ms[i - 1]) / (ms[i] - ms[i - 1] || 1)
        return arr[i - 1] + t * (arr[i] - arr[i - 1])
      }
    }
    return arr[arr.length - 1]
  })
  if (value < vals[0]) return 1.5
  if (value > vals[vals.length - 1]) return 98.5
  for (let i = 1; i < vals.length; i++) {
    if (value <= vals[i]) {
      const t = (value - vals[i - 1]) / (vals[i] - vals[i - 1] || 1)
      return Math.round((pctLevels[i - 1] + t * (pctLevels[i] - pctLevels[i - 1])) * 10) / 10
    }
  }
  return 50
}

module.exports = {
  /* ---------------- 喂养 / 尿布 / 睡眠 ---------------- */
  async addFeeding(params = {}) {
    const uid = await requireUser.call(this)
    if (!uid) return auth.fail('TOKEN_INVALID', '未登录')
    const j = await accessibleJourney.call(this, uid, params.journeyId, 'write')
    if (!j) return auth.fail('NOT_FOUND', '旅程不存在')
    const b = await ownedBaby.call(this, uid, params.journeyId, params.babyId)
    if (!b) return auth.fail('NOT_FOUND', '宝宝不存在')
    const mode = params.mode
    if (!['nursing', 'breastmilk_bottle', 'formula', 'mixed'].includes(mode)) return auth.fail('PARAM_ERROR', '喂养方式无效')
    const ts = params.ts || Date.now()
    if (ts > Date.now() + 60 * 1000) return auth.fail('PARAM_ERROR', '记录时间不能在未来')
    const res = await db.call(this).collection('lb-feedings').add({
      user_id: uid, journey_id: j._id, baby_id: b._id, mode,
      side: ['left', 'right'].includes(params.side) ? params.side : '',
      ml: Math.max(0, Math.min(1000, +params.ml || 0)),
      duration_sec: Math.max(0, Math.min(7200, +params.durationSec || 0)),
      date: params.date || dateOf(ts), ts, created_at: Date.now()
    })
    await auth.logEvent(db.call(this), { userId: uid, journeyId: j._id, event: 'record_create', props: { type: 'feeding' } })
    return auth.ok({ recordId: res.id })
  },

  async addDiaper(params = {}) {
    const uid = await requireUser.call(this)
    if (!uid) return auth.fail('TOKEN_INVALID', '未登录')
    const j = await accessibleJourney.call(this, uid, params.journeyId, 'write')
    if (!j) return auth.fail('NOT_FOUND', '旅程不存在')
    const b = await ownedBaby.call(this, uid, params.journeyId, params.babyId)
    if (!b) return auth.fail('NOT_FOUND', '宝宝不存在')
    const kind = params.kind
    if (!['pee', 'poop', 'both'].includes(kind)) return auth.fail('PARAM_ERROR', 'kind 无效')
    const ts = params.ts || Date.now()
    let redline = null
    if (kind !== 'pee') {
      if (params.color === 'blood_streak') redline = { level: 'critical', message: '大便带血丝', action: '请尽快就医' }
      else if (params.color === 'white') redline = { level: 'critical', message: '大便呈陶土色（白）', action: '请尽快就医' }
      else if (params.texture === 'watery') redline = { level: 'warn', message: '水样便', action: '如伴精神差/发热请就医，注意补水' }
    }
    const res = await db.call(this).collection('lb-diaper-changes').add({
      user_id: uid, journey_id: j._id, baby_id: b._id, kind,
      texture: params.texture || '', color: params.color || '',
      date: params.date || dateOf(ts), ts, created_at: Date.now()
    })
    await auth.logEvent(db.call(this), { userId: uid, journeyId: j._id, event: 'record_create', props: { type: 'diaper' } })
    return auth.ok({ recordId: res.id, redline })
  },

  async addSleep(params = {}) {
    const uid = await requireUser.call(this)
    if (!uid) return auth.fail('TOKEN_INVALID', '未登录')
    const j = await accessibleJourney.call(this, uid, params.journeyId, 'write')
    if (!j) return auth.fail('NOT_FOUND', '旅程不存在')
    const b = await ownedBaby.call(this, uid, params.journeyId, params.babyId)
    if (!b) return auth.fail('NOT_FOUND', '宝宝不存在')
    const start = +params.startTs || 0, end = +params.endTs || 0
    if (!(start > 0 && end > start)) return auth.fail('PARAM_ERROR', '起止时间无效')
    const res = await db.call(this).collection('lb-sleep-sessions').add({
      user_id: uid, journey_id: j._id, baby_id: b._id,
      kind: params.kind === 'night' ? 'night' : 'nap',
      start_ts: start, end_ts: end, duration_min: Math.round((end - start) / 60000),
      night_wakings: Math.max(0, Math.min(20, +params.nightWakings || 0)),
      date: dateOf(end), created_at: Date.now()
    })
    await auth.logEvent(db.call(this), { userId: uid, journeyId: j._id, event: 'record_create', props: { type: 'sleep' } })
    return auth.ok({ recordId: res.id })
  },

  /** 某日宝宝记录汇总（喂养/尿布/睡眠） */
  async dailySummary(params = {}) {
    const uid = await requireUser.call(this)
    if (!uid) return auth.fail('TOKEN_INVALID', '未登录')
    const j = await accessibleJourney.call(this, uid, params.journeyId)
    if (!j) return auth.fail('NOT_FOUND', '旅程不存在')
    const b = await ownedBaby.call(this, uid, params.journeyId, params.babyId)
    if (!b) return auth.fail('NOT_FOUND', '宝宝不存在')
    const date = params.date || dateOf(Date.now())
    const f = await db.call(this).collection('lb-feedings').where({ baby_id: b._id, date }).get()
    const d = await db.call(this).collection('lb-diaper-changes').where({ baby_id: b._id, date }).get()
    const s = await db.call(this).collection('lb-sleep-sessions').where({ baby_id: b._id, date }).get()
    const feedings = f.data
    const totalMl = feedings.reduce((a, x) => a + (x.ml || 0), 0)
    const nursingSec = feedings.filter(x => x.mode === 'nursing').reduce((a, x) => a + (x.duration_sec || 0), 0)
    const poopCount = d.data.filter(x => x.kind !== 'pee').length
    const sleepMin = s.data.reduce((a, x) => a + (x.duration_min || 0), 0)
    return auth.ok({
      date,
      feeding: { count: feedings.length, totalMl, nursingSec, items: feedings },
      diaper: { count: d.data.length, poopCount, items: d.data },
      sleep: { totalMin: sleepMin, nightWakings: s.data.reduce((a, x) => a + (x.night_wakings || 0), 0), items: s.data }
    })
  },

  /* ---------------- 成长与百分位 ---------------- */
  async addGrowth(params = {}) {
    const uid = await requireUser.call(this)
    if (!uid) return auth.fail('TOKEN_INVALID', '未登录')
    const j = await accessibleJourney.call(this, uid, params.journeyId, 'write')
    if (!j) return auth.fail('NOT_FOUND', '旅程不存在')
    const b = await ownedBaby.call(this, uid, params.journeyId, params.babyId)
    if (!b) return auth.fail('NOT_FOUND', '宝宝不存在')
    const measureDate = params.measureDate ? parseDate(params.measureDate) : parseDate(dateOf(Date.now()))
    if (!Number.isFinite(measureDate)) return auth.fail('PARAM_ERROR', '测量日期无效')
    const age = monthAge(b.birth_date, measureDate)
    const sex = b.sex === 'male' ? 'male' : 'female'
    const weightKg = +params.weightKg, heightCm = +params.heightCm, headCm = +params.headCm
    if (weightKg && !(weightKg > 0.5 && weightKg < 40)) return auth.fail('PARAM_ERROR', '体重超出范围')
    if (heightCm && !(heightCm > 20 && heightCm < 150)) return auth.fail('PARAM_ERROR', '身高超出范围')
    if (headCm && !(headCm > 20 && headCm < 70)) return auth.fail('PARAM_ERROR', '头围超出范围')
    const res = await db.call(this).collection('lb-growth-samples').add({
      user_id: uid, journey_id: j._id, baby_id: b._id,
      measure_date: measureDate, month_age: age.months, corrected: !!params.corrected,
      weight_kg: weightKg || 0, height_cm: heightCm || 0, head_cm: headCm || 0,
      source: ['manual', 'checkup', 'ai_scan'].includes(params.source) ? params.source : 'manual',
      created_at: Date.now()
    })
    await auth.logEvent(db.call(this), { userId: uid, journeyId: j._id, event: 'record_create', props: { type: 'growth' } })
    const pct = {
      weightPct: weightKg ? percentileOf('weight', sex, age.months, weightKg) : null,
      heightPct: heightCm ? percentileOf('height', sex, age.months, heightCm) : null,
      headPct: headCm ? percentileOf('head', sex, age.months, headCm) : null
    }
    const alerts = []
    for (const [k, v] of Object.entries(pct)) {
      if (v !== null && (v <= 3 || v >= 97)) alerts.push('有指标位于第 3 百分位之外，建议儿保时与医生沟通生长趋势')
      break
    }
    return auth.ok(Object.assign({ recordId: res.id, monthAge: age.months, percentiles: pct, alerts: [...new Set(alerts)], disclaimer: '百分位为参考趋势，不构成诊断' }))
  },

  async getGrowthSeries(params = {}) {
    const uid = await requireUser.call(this)
    if (!uid) return auth.fail('TOKEN_INVALID', '未登录')
    const j = await accessibleJourney.call(this, uid, params.journeyId)
    if (!j) return auth.fail('NOT_FOUND', '旅程不存在')
    const b = await ownedBaby.call(this, uid, params.journeyId, params.babyId)
    if (!b) return auth.fail('NOT_FOUND', '宝宝不存在')
    const res = await db.call(this).collection('lb-growth-samples').where({ baby_id: b._id }).orderBy('measure_date', 'asc').get()
    return auth.ok({ samples: res.data, sex: b.sex, birthDate: dateOf(b.birth_date) })
  },

  /* ---------------- 疫苗 ---------------- */
  async getVaccinePlan(params = {}) {
    const uid = await requireUser.call(this)
    if (!uid) return auth.fail('TOKEN_INVALID', '未登录')
    const j = await accessibleJourney.call(this, uid, params.journeyId)
    if (!j) return auth.fail('NOT_FOUND', '旅程不存在')
    const b = await ownedBaby.call(this, uid, params.journeyId, params.babyId)
    if (!b) return auth.fail('NOT_FOUND', '宝宝不存在')
    const records = await db.call(this).collection('lb-vaccinations').where({ baby_id: b._id }).get()
    const doneMap = new Map(records.data.map(r => [`${r.code}#${r.dose}`, r]))
    const now = Date.now()
    const plan = T.VACCINE_PROGRAM.map(v => {
      const dueTs = b.birth_date + v.ageMonths * MONTH
      const rec = doneMap.get(`${v.code}#${v.dose}`)
      const status = rec ? 'done' : (dueTs <= now ? 'due' : 'upcoming')
      return { code: v.code, name: v.name, dose: v.dose, ageMonths: v.ageMonths, free: v.free, dueDate: dateOf(dueTs), status, record: rec ? { date: dateOf(rec.date), lotNo: rec.lot_no, reaction: rec.reaction_note } : null }
    })
    return auth.ok({ plan, selfPaidCatalog: T.VACCINE_SELF_PAID, doneCount: [...doneMap.values()].length })
  },

  async recordVaccine(params = {}) {
    const uid = await requireUser.call(this)
    if (!uid) return auth.fail('TOKEN_INVALID', '未登录')
    const j = await accessibleJourney.call(this, uid, params.journeyId, 'write')
    if (!j) return auth.fail('NOT_FOUND', '旅程不存在')
    const b = await ownedBaby.call(this, uid, params.journeyId, params.babyId)
    if (!b) return auth.fail('NOT_FOUND', '宝宝不存在')
    const vDate = parseDate(params.date || dateOf(Date.now()))
    if (!Number.isFinite(vDate)) return auth.fail('PARAM_ERROR', '接种日期无效')
    const res = await db.call(this).collection('lb-vaccinations').add({
      user_id: uid, journey_id: j._id, baby_id: b._id,
      code: String(params.code || 'custom').slice(0, 24), name: String(params.name || '').slice(0, 30),
      dose: Math.max(1, +params.dose || 1), free: params.free === undefined ? true : !!params.free,
      date: vDate, lot_no: String(params.lotNo || '').slice(0, 30), site: String(params.site || '').slice(0, 30),
      reaction_note: String(params.reactionNote || '').slice(0, 200), created_at: Date.now()
    })
    await auth.logEvent(db.call(this), { userId: uid, journeyId: j._id, event: 'record_create', props: { type: 'vaccine' } })
    return auth.ok({ recordId: res.id, redline: /38\.5/.test(String(params.reactionNote)) ? { level: 'warn', message: '接种后高热记录', action: '持续 >38.5℃ 或精神差请就医' } : null })
  },

  /* ---------------- 里程碑 ---------------- */
  async addMilestone(params = {}) {
    const uid = await requireUser.call(this)
    if (!uid) return auth.fail('TOKEN_INVALID', '未登录')
    const j = await accessibleJourney.call(this, uid, params.journeyId, 'write')
    if (!j) return auth.fail('NOT_FOUND', '旅程不存在')
    const b = await ownedBaby.call(this, uid, params.journeyId, params.babyId)
    if (!b) return auth.fail('NOT_FOUND', '宝宝不存在')
    if (!['gross', 'fine', 'language', 'social'].includes(params.dim)) return auth.fail('PARAM_ERROR', '维度无效')
    const achieved = parseDate(params.achievedDate || dateOf(Date.now()))
    const res = await db.call(this).collection('lb-milestones').add({
      user_id: uid, journey_id: j._id, baby_id: b._id, dim: params.dim,
      code: String(params.code || '').slice(0, 24), achieved_date: achieved,
      note: String(params.note || '').slice(0, 200), media_ids: Array.isArray(params.mediaIds) ? params.mediaIds.slice(0, 9) : [],
      created_at: Date.now()
    })
    await auth.logEvent(db.call(this), { userId: uid, journeyId: j._id, event: 'record_create', props: { type: 'milestone' } })
    return auth.ok({ recordId: res.id })
  },

  async listMilestones(params = {}) {
    const uid = await requireUser.call(this)
    if (!uid) return auth.fail('TOKEN_INVALID', '未登录')
    const j = await accessibleJourney.call(this, uid, params.journeyId)
    if (!j) return auth.fail('NOT_FOUND', '旅程不存在')
    const b = await ownedBaby.call(this, uid, params.journeyId, params.babyId)
    if (!b) return auth.fail('NOT_FOUND', '宝宝不存在')
    const res = await db.call(this).collection('lb-milestones').where({ baby_id: b._id }).orderBy('achieved_date', 'asc').get()
    const age = monthAge(b.birth_date, Date.now())
    const catalog = T.MILESTONES.map(m => {
      const done = res.data.find(x => x.code === m.code)
      const overdue = !done && age.months > m.months[1]
      return Object.assign({}, m, {
        monthFrom: m.months[0], monthTo: m.months[1],
        achieved: !!done, achievedDate: done ? dateOf(done.achieved_date) : '', note: done ? done.note : '',
        status: done ? 'achieved' : (overdue ? 'watch' : 'upcoming'),
        watchText: overdue ? '每个宝宝节奏不同，如仍无此表现，建议儿保时和医生聊聊' : ''
      })
    })
    return auth.ok({ catalog, achieved: res.data.length, monthAge: age.months })
  },

  /* ---------------- 辅食（3 天观察法） ---------------- */
  async addFood(params = {}) {
    const uid = await requireUser.call(this)
    if (!uid) return auth.fail('TOKEN_INVALID', '未登录')
    const j = await accessibleJourney.call(this, uid, params.journeyId, 'write')
    if (!j) return auth.fail('NOT_FOUND', '旅程不存在')
    const b = await ownedBaby.call(this, uid, params.journeyId, params.babyId)
    if (!b) return auth.fail('NOT_FOUND', '宝宝不存在')
    const name = String(params.name || '').trim().slice(0, 20)
    if (!name) return auth.fail('PARAM_ERROR', '食物名称不能为空')
    const ts = params.ts || Date.now()
    const existing = await db.call(this).collection('lb-food-logs').where({ baby_id: b._id, name }).orderBy('ts', 'desc').limit(1).get()
    const isFirst = existing.data.length === 0 || (existing.data[0].confirmed_allergy || Date.now() - existing.data[0].ts > 60 * DAY)
    const res = await db.call(this).collection('lb-food-logs').add({
      user_id: uid, journey_id: j._id, baby_id: b._id, name, ts, date: dateOf(ts),
      first: isFirst, reaction: '', confirmed_allergy: false, created_at: Date.now()
    })
    await auth.logEvent(db.call(this), { userId: uid, journeyId: j._id, event: 'record_create', props: { type: 'food' } })
    return auth.ok({ recordId: res.id, first: isFirst, observation: isFirst ? { foodLogId: res.id, days: ['day1', 'day2', 'day3'], guide: '新增食物连续观察 3 天，标记反应' } : null, forbidden: ['1 岁内不加盐/糖/蜂蜜/整颗坚果/鲜牛奶', '3 岁内整颗坚果与果冻有窒息风险'] })
  },

  async logFoodReaction(params = {}) {
    const uid = await requireUser.call(this)
    if (!uid) return auth.fail('TOKEN_INVALID', '未登录')
    const r = await db.call(this).collection('lb-food-logs').doc(String(params.foodLogId)).get()
    const rec = r.data[0]
    if (!rec) return auth.fail('NOT_FOUND', '记录不存在')
    const j = await accessibleJourney.call(this, uid, rec.journey_id, 'write')
    if (!j) return auth.fail('PERMISSION_DENIED', '无权修改该记录')
    const reaction = ['none', 'rash', 'vomiting', 'diarrhea', 'other'].includes(params.reaction) ? params.reaction : 'none'
    const bad = reaction !== 'none'
    await db.call(this).collection('lb-food-logs').doc(String(params.foodLogId)).update({ reaction, confirmed_allergy: bad, ts: Date.now() })
    return auth.ok({ reaction, alert: bad ? `「${rec.name}」已标记为待复试：本次反应 ${reaction}，暂停添加，建议 1-2 周后少量复试并咨询医生` : null })
  },

  async foodDashboard(params = {}) {
    const uid = await requireUser.call(this)
    if (!uid) return auth.fail('TOKEN_INVALID', '未登录')
    const j = await accessibleJourney.call(this, uid, params.journeyId)
    if (!j) return auth.fail('NOT_FOUND', '旅程不存在')
    const b = await ownedBaby.call(this, uid, params.journeyId, params.babyId)
    if (!b) return auth.fail('NOT_FOUND', '宝宝不存在')
    const res = await db.call(this).collection('lb-food-logs').where({ baby_id: b._id }).orderBy('ts', 'desc').limit(200).get()
    const allergens = res.data.filter(x => x.confirmed_allergy).map(x => x.name)
    const tried = [...new Set(res.data.map(x => x.name))]
    return auth.ok({ allergens: [...new Set(allergens)], triedFoods: tried, logs: res.data.slice(0, 50) })
  },

  async addMedication(params = {}) {
    const uid = await requireUser.call(this)
    if (!uid) return auth.fail('TOKEN_INVALID', '未登录')
    const j = await accessibleJourney.call(this, uid, params.journeyId, 'write')
    if (!j) return auth.fail('NOT_FOUND', '旅程不存在')
    const b = params.babyId ? await ownedBaby.call(this, uid, params.journeyId, params.babyId) : null
    const name = String(params.name || '').trim().slice(0, 40)
    if (!name) return auth.fail('PARAM_ERROR', '药名不能为空')
    const ts = params.ts || Date.now()
    const res = await db.call(this).collection('lb-medication-logs').add({
      user_id: uid, journey_id: j._id, baby_id: b ? b._id : '', name,
      dose: String(params.dose || '').slice(0, 40), ts, date: dateOf(ts),
      note: String(params.note || '').slice(0, 200), created_at: Date.now()
    })
    await auth.logEvent(db.call(this), { userId: uid, journeyId: j._id, event: 'record_create', props: { type: 'medication' } })
    return auth.ok({ recordId: res.id, disclaimer: '本应用不做剂量建议，请以说明书与医嘱为准' })
  },

  /** 用药记录列表（母亲与宝宝共用一条时间轴，按旅程查询） */
  async listMedications(params = {}) {
    const uid = await requireUser.call(this)
    if (!uid) return auth.fail('TOKEN_INVALID', '未登录')
    const j = await accessibleJourney.call(this, uid, params.journeyId)
    if (!j) return auth.fail('NOT_FOUND', '旅程不存在')
    const res = await db.call(this).collection('lb-medication-logs').where({ journey_id: j._id }).orderBy('ts', 'desc').limit(100).get()
    const logs = res.data.map(x => ({
      _id: x._id, name: x.name, dose: x.dose, note: x.note, ts: x.ts, date: x.date, babyId: x.baby_id || ''
    }))
    // strict 红线：仅本人可见（与时间线一致）
    return auth.ok({ logs: auth.visibilityFilter(logs, uid) })
  },

  /* ---------------- 成长相册 ---------------- */

  /** 添加照片：先由客户端 uploadFile 得到 fileId，再登记到相册 */
  async addPhoto(params = {}) {
    const uid = await requireUser.call(this)
    if (!uid) return auth.fail('TOKEN_INVALID', '未登录')
    const j = await accessibleJourney.call(this, uid, params.journeyId, 'write')
    if (!j) return auth.fail('NOT_FOUND', '旅程不存在')
    const b = params.babyId ? await ownedBaby.call(this, uid, params.journeyId, params.babyId) : null
    const fileId = String(params.fileId || '').trim().slice(0, 200)
    if (!fileId) return auth.fail('PARAM_ERROR', '缺少图片')
    const ts = params.ts || Date.now()
    const res = await db.call(this).collection('lb-album').add({
      user_id: uid, journey_id: j._id, baby_id: b ? b._id : '',
      file_id: fileId, caption: String(params.caption || '').trim().slice(0, 40),
      date: params.date || dateOf(ts), ts, created_at: Date.now()
    })
    await auth.logEvent(db.call(this), { userId: uid, journeyId: j._id, event: 'record_create', props: { type: 'photo' } })
    return auth.ok({ photoId: res.id })
  },

  async listPhotos(params = {}) {
    const uid = await requireUser.call(this)
    if (!uid) return auth.fail('TOKEN_INVALID', '未登录')
    const j = await accessibleJourney.call(this, uid, params.journeyId)
    if (!j) return auth.fail('NOT_FOUND', '旅程不存在')
    const q = { journey_id: j._id }
    if (params.babyId) q.baby_id = String(params.babyId)
    const res = await db.call(this).collection('lb-album').where(q).orderBy('ts', 'desc').limit(Math.min(200, +params.limit || 50)).get()
    // mine 供客户端判断是否显示删除入口（最终权限仍由 removePhoto 校验）
    let photos = res.data.map(p => Object.assign({}, p, { mine: p.user_id === uid }))
    // 服务端换取临时访问地址，客户端直接渲染（临时地址约 2 小时有效，每次进入刷新）
    try {
      const ids = photos.map(p => p.file_id).filter(Boolean)
      if (ids.length > 0) {
        const tmp = await uniCloud.getTempFileURL({ fileList: ids })
        const map = {}
        for (const f of (tmp.fileList || [])) {
          if (f.fileID && f.tempFileURL) map[f.fileID] = f.tempFileURL
        }
        photos = photos.map(p => Object.assign({}, p, { url: map[p.file_id] || '' }))
      }
    } catch (e) { /* 取地址失败时保留 file_id，不阻塞列表 */ }
    return auth.ok({ photos })
  },

  /** 删除照片：仅上传者本人可删（家庭成员可看不可删） */
  async removePhoto(params = {}) {
    const uid = await requireUser.call(this)
    if (!uid) return auth.fail('TOKEN_INVALID', '未登录')
    const j = await accessibleJourney.call(this, uid, params.journeyId, 'write')
    if (!j) return auth.fail('NOT_FOUND', '旅程不存在')
    const r = await db.call(this).collection('lb-album').doc(String(params.photoId)).get()
    const p = r.data[0]
    if (!p || p.journey_id !== j._id) return auth.fail('NOT_FOUND', '照片不存在')
    if (p.user_id !== uid) return auth.fail('PERMISSION_DENIED', '只有上传者可以删除')
    await db.call(this).collection('lb-album').doc(p._id).remove()
    return auth.ok()
  }
}
