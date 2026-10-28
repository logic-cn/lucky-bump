/**
 * lucky-journey —— 阶段引擎（产品脊柱，docs/02 §4）
 * 职责：旅程 CRUD、预产期计算（LMP/排卵/IVF/B超校正）、孕周换算、阶段推导与切换、
 *       好孕确认、哀伤模式、分娩登记（生成宝宝档案）、多旅程多宝、归档与再备孕。
 * 服务端为唯一事实源：前端 utils/pregnancy.uts 仅为展示镜像。
 */
'use strict'
const auth = require('./common/lucky-auth-common')

const DAY = 24 * 3600 * 1000
const col = 'lb-journeys'

/* ---------------- 日期与孕周工具（全部按日精度，UTC 正午锚定避免时区漂移） ---------------- */
function parseDate(s) {
  if (typeof s !== 'string') return NaN
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s)
  if (!m) return NaN
  const ms = Date.UTC(+m[1], +m[2] - 1, +m[3], 12, 0, 0)
  return Number.isFinite(ms) ? ms : NaN
}
function fmtDate(ms) { const d = new Date(ms); return d.toISOString().slice(0, 10) }
function daysBetween(fromMs, toMs) { return Math.floor((toMs - fromMs) / DAY) }

/** 预产期计算：源类型 lmp/ovulation/ivf/user_edd/ultrasound */
function calcEdd(source, p) {
  switch (source) {
    case 'lmp': return { edd: parseDate(p.lmpDate) + 280 * DAY, eddSource: 'LMP' }
    case 'ovulation': return { edd: parseDate(p.ovulationDate) + 266 * DAY, eddSource: 'OVULATION' }
    case 'ivf': {
      if (p.ivfType === 'D3') return { edd: parseDate(p.ivfTransferDate) + 263 * DAY, eddSource: 'IVF_D3' }
      return { edd: parseDate(p.ivfTransferDate) + 261 * DAY, eddSource: 'IVF_D5' }
    }
    case 'user_edd': return { edd: parseDate(p.edd), eddSource: 'USER' }
    case 'ultrasound': {
      // 输入：ultrasoundDate + ultrasoundWeekDays（B超推算孕周，如 "8+3" → 8*7+3 天）
      const m = /^(\d{1,2})\+(\d{1,2})$/.exec(String(p.ultrasoundWeekDays || ''))
      if (!m) return null
      const gestDays = (+m[1]) * 7 + (+m[2])
      if (gestDays <= 0 || gestDays > 140) return null
      return { edd: parseDate(p.ultrasoundDate) + (280 - gestDays) * DAY, eddSource: 'ULTRASOUND', gestDays }
    }
    default: return null
  }
}
function validateEddInput(source, p) {
  const r = calcEdd(source, p)
  if (!r || !Number.isFinite(r.edd)) return null
  const now = Date.now()
  if (r.edd < now - 400 * DAY || r.edd > now + 400 * DAY) return null
  return r
}

/** 阶段推导。t：journey 关键日期集合 */
function stageOf(j, now = Date.now()) {
  if (j.stage_code === 'MOURNING') return 'MOURNING'
  if (j.stage_code === 'ARCHIVED') return 'ARCHIVED'
  if (j.delivery_date) {
    const pd = daysBetween(j.delivery_date, now)
    if (pd < 0) return 'T3'
    return pd < 42 ? 'POSTPARTUM' : (pd < 365 ? 'RECOVERY' : 'PARENTING')
  }
  if (j.edd) {
    const gest = 280 - daysBetween(now, j.edd) // 距 edd 天数
    const dayOfPreg = gest // 近似：280-edd剩余天数
    const wk = Math.floor(dayOfPreg / 7)
    if (dayOfPreg < 0) return 'PRECONCEPTION'
    if (wk < 14) return 'T1'
    if (wk < 28) return 'T2'
    return 'T3'
  }
  return 'PRECONCEPTION'
}
function weekInfoOf(j, now = Date.now()) {
  const out = { stage: stageOf(j, now), weeks: 0, days: 0, edd: j.edd ? fmtDate(j.edd) : '', daysToEdd: 0, postpartumDays: 0 }
  if (j.edd && ['T1', 'T2', 'T3'].includes(out.stage)) {
    // 统一从 LMP 锚点（无则由预产期反推）向下取整，保证 weeks+days 与 daysToEdd 恒等式 280 天
    const anchor = j.lmp_date || (j.edd - 280 * DAY)
    const gest = Math.max(0, daysBetween(anchor, now))
    out.weeks = Math.floor(gest / 7); out.days = gest % 7
    out.daysToEdd = Math.max(0, 280 - gest)
  }
  if (j.delivery_date && ['POSTPARTUM', 'RECOVERY', 'PARENTING'].includes(out.stage)) {
    out.postpartumDays = daysBetween(j.delivery_date, now)
  }
  return out
}

/** 宝宝大小参考（周 → 身长cm/体重g，统计参考值，每周更新；4 周前不展示） */
const BABY_SIZE = [
  [4, 0.2, 0], [5, 0.3, 0], [6, 0.6, 0], [7, 1.3, 1], [8, 1.6, 1], [9, 2.3, 2], [10, 3.1, 4], [11, 4.1, 7],
  [12, 5.4, 14], [13, 7.4, 23], [14, 8.7, 43], [15, 10.1, 70], [16, 11.6, 100], [17, 13, 140], [18, 14.2, 190],
  [19, 15.3, 240], [20, 16.4, 300], [21, 26.7, 360], [22, 27.8, 430], [23, 28.9, 501], [24, 30, 600],
  [25, 34.6, 660], [26, 35.6, 760], [27, 36.6, 875], [28, 37.6, 1005], [29, 38.6, 1153], [30, 39.9, 1319],
  [31, 41.1, 1502], [32, 42.4, 1702], [33, 43.7, 1918], [34, 45, 2146], [35, 46.2, 2383], [36, 47.4, 2622],
  [37, 48.6, 2859], [38, 49.8, 3083], [39, 50.7, 3288], [40, 51.2, 3462]
]
function babySizeRef(week) {
  if (!week || week < 4) return null
  const hit = BABY_SIZE.filter(r => r[0] <= week).pop()
  if (!hit) return null
  return { week: hit[0], lengthCm: hit[1], weightG: hit[2] }
}

/* ---------------- 权限与查询 ---------------- */
async function requireUser() {
  const token = (this.__mockToken != null) ? this.__mockToken : this.getUniIdToken()
  const v = auth.verifyToken(token)
  if (!v.ok) return null
  return v.uid
}
async function ownedJourney(uid, journeyId) {
  const res = await this.uniCloud.database().collection(col).where({ _id: journeyId, user_id: uid }).get()
  return res.data[0] || null
}
function publicView(j, now = Date.now()) {
  const wi = weekInfoOf(j, now)
  return {
    _id: j._id, title: j.title || '', fetusCount: j.fetus_count || 1,
    stage: wi.stage, weeks: wi.weeks, days: wi.days, edd: wi.edd, daysToEdd: wi.daysToEdd,
    postpartumDays: wi.postpartumDays, eddSource: j.edd_source || '', highRisk: !!j.high_risk,
    mourning: j.stage_code === 'MOURNING', archived: j.stage_code === 'ARCHIVED',
    deliveryDate: j.delivery_date ? fmtDate(j.delivery_date) : '',
    babySize: babySizeRef(wi.weeks), lmpDate: j.lmp_date ? fmtDate(j.lmp_date) : ''
  }
}

module.exports = {
  /** 创建旅程。mode: ttc(备孕)/pregnant(已怀孕)/parenting(已有宝宝，需补分娩登记) */
  async createJourney(params = {}) {
    const uid = await requireUser.call(this)
    if (!uid) return auth.fail('TOKEN_INVALID', '未登录')
    const now = Date.now()
    const doc = { user_id: uid, title: String(params.title || '').slice(0, 20), fetus_count: Math.max(1, Math.min(3, +params.fetusCount || 1)), stage_code: 'PRECONCEPTION', created_at: now, updated_at: now, high_risk: !!params.highRisk }
    const mode = params.mode || 'ttc'
    if (mode === 'ttc') {
      if (params.lmpDate && Number.isFinite(parseDate(params.lmpDate))) doc.lmp_date = parseDate(params.lmpDate)
    } else if (mode === 'pregnant') {
      const src = params.eddSource || 'lmp'
      const v = validateEddInput(src, params)
      if (!v) return auth.fail('PARAM_ERROR', '日期参数无效（支持 lmp/ovulation/ivf/user_edd/ultrasound）')
      Object.assign(doc, { edd: v.edd, edd_source: v.eddSource, lmp_date: params.lmpDate ? parseDate(params.lmpDate) : (v.edd - 280 * DAY) })
      if (src === 'ultrasound' && v.gestDays < 14 * 7) doc.ultrasound_locked = true
    } else if (mode === 'parenting') {
      return auth.fail('PARAM_ERROR', '已有宝宝请走分娩登记流程或联系支持')
    } else {
      return auth.fail('PARAM_ERROR', 'mode 无效')
    }
    const res = await this.uniCloud.database().collection(col).add(doc)
    return auth.ok({ journeyId: res.id, view: publicView(Object.assign({ _id: res.id }, doc), now) })
  },

  async listJourneys() {
    const uid = await requireUser.call(this)
    if (!uid) return auth.fail('TOKEN_INVALID', '未登录')
    const res = await this.uniCloud.database().collection(col).where({ user_id: uid }).orderBy('created_at', 'desc').get()
    const now = Date.now()
    const views = res.data.map(j => publicView(j, now))
    // 默认旅程：非归档非哀伤优先
    const current = views.find(v => !v.archived && !v.mourning) || views[0] || null
    return auth.ok({ journeys: views, currentId: current ? current._id : '' })
  },

  async getJourney(params = {}) {
    const uid = await requireUser.call(this)
    if (!uid) return auth.fail('TOKEN_INVALID', '未登录')
    let j
    if (params.journeyId) {
      j = await ownedJourney.call(this, uid, params.journeyId)
    } else {
      const res = await this.uniCloud.database().collection(col).where({ user_id: uid, stage_code: this.uniCloud.database().command.neq('ARCHIVED') }).orderBy('created_at', 'desc').limit(1).get()
      j = res.data[0]
    }
    if (!j) return auth.ok({ journey: null })
    return auth.ok({ journey: publicView(j) })
  },

  /** 更新日期来源（含 B 超校正规则：仅首次孕早期超声自动改写预产期，之后需 confirm=true） */
  async updateDates(params = {}) {
    const uid = await requireUser.call(this)
    if (!uid) return auth.fail('TOKEN_INVALID', '未登录')
    const j = await ownedJourney.call(this, uid, params.journeyId)
    if (!j) return auth.fail('NOT_FOUND', '旅程不存在')
    const patch = { updated_at: Date.now() }
    if (params.fetusCount) patch.fetus_count = Math.max(1, Math.min(3, +params.fetusCount))
    if (params.highRisk !== undefined) patch.high_risk = !!params.highRisk
    if (params.title !== undefined) patch.title = String(params.title).slice(0, 20)
    if (params.eddSource) {
      const v = validateEddInput(params.eddSource, params)
      if (!v) return auth.fail('PARAM_ERROR', '日期参数无效')
      const isFirstTrimesterUS = params.eddSource === 'ultrasound' && v.gestDays <= 13 * 7 + 6
      if (j.edd && params.eddSource === 'ultrasound' && !isFirstTrimesterUS && !params.confirm) {
        return auth.fail('EDD_CONFIRM_NEEDED', '孕中晚期 B 超与预产期差异仅供参考，如确认以医生口径修改请带 confirm=true')
      }
      patch.edd = v.edd; patch.edd_source = v.eddSource
      if (params.eddSource === 'lmp') patch.lmp_date = parseDate(params.lmpDate)
      if (isFirstTrimesterUS) { patch.ultrasound_locked = true; patch.lmp_date = v.edd - 280 * DAY }
    }
    await this.uniCloud.database().collection(col).doc(j._id).update(patch)
    const nj = Object.assign({}, j, patch)
    return auth.ok({ view: publicView(nj) })
  },

  /** 好孕确认（备孕 → 孕期）：需要给出孕周日期源（默认取末次月经） */
  async confirmPregnancy(params = {}) {
    const uid = await requireUser.call(this)
    if (!uid) return auth.fail('TOKEN_INVALID', '未登录')
    const j = await ownedJourney.call(this, uid, params.journeyId)
    if (!j) return auth.fail('NOT_FOUND', '旅程不存在')
    if (j.edd) return auth.fail('STATE_ERROR', '该旅程已在孕期')
    const src = params.eddSource || 'lmp'
    const v = validateEddInput(src, params)
    if (!v) return auth.fail('PARAM_ERROR', '请提供有效孕周日期（如末次月经）')
    const patch = { edd: v.edd, edd_source: v.eddSource, lmp_date: params.lmpDate ? parseDate(params.lmpDate) : (v.edd - 280 * DAY), stage_code: 'PREGNANT', confirmed_at: Date.now(), updated_at: Date.now() }
    await this.uniCloud.database().collection(col).doc(j._id).update(patch)
    const nj = Object.assign({}, j, patch)
    const view = publicView(nj)
    // 好孕仪式包：视图 + 下一步引导
    return auth.ok({ view, welcome: { stage: view.stage, nextSteps: ['生成好孕报（可分享）', '邀请宝宝爸爸加入家庭组', '查看孕期首页与产检计划'] } })
  },

  /** 哀伤模式（流产/胎停）：隐藏一切孕育内容与推送，数据保留。30 天内可撤销。 */
  async registerMourning(params = {}) {
    const uid = await requireUser.call(this)
    if (!uid) return auth.fail('TOKEN_INVALID', '未登录')
    const j = await ownedJourney.call(this, uid, params.journeyId)
    if (!j) return auth.fail('NOT_FOUND', '旅程不存在')
    await this.uniCloud.database().collection(col).doc(j._id).update({ stage_code: 'MOURNING', mourning_since: Date.now(), mourning_reason: String(params.reason || '').slice(0, 20), updated_at: Date.now() })
    return auth.ok({ undoDeadlineDays: 30 })
  },

  async undoMourning(params = {}) {
    const uid = await requireUser.call(this)
    if (!uid) return auth.fail('TOKEN_INVALID', '未登录')
    const j = await ownedJourney.call(this, uid, params.journeyId)
    if (!j || j.stage_code !== 'MOURNING') return auth.fail('STATE_ERROR', '当前不在哀伤模式')
    if (Date.now() - j.mourning_since > 30 * DAY) return auth.fail('STATE_ERROR', '已超过 30 天撤销期')
    await this.uniCloud.database().collection(col).doc(j._id).update({ stage_code: j.edd ? 'PREGNANT' : 'PRECONCEPTION', mourning_since: 0, updated_at: Date.now() })
    return auth.ok()
  },

  /** 再备孕：新建旅程并关联来源（哀伤或已归档旅程） */
  async startNewJourney(params = {}) {
    const uid = await requireUser.call(this)
    if (!uid) return auth.fail('TOKEN_INVALID', '未登录')
    const res = await this.uniCloud.database().collection(col).add({ user_id: uid, title: params.title || '新的旅程', fetus_count: 1, stage_code: 'PRECONCEPTION', created_at: Date.now(), updated_at: Date.now(), from_journey_id: params.fromJourneyId || '' })
    return auth.ok({ journeyId: res.id })
  },

  /** 分娩登记：产褥期时钟启动 + 宝宝档案生成（多胎逐个） */
  async registerDelivery(params = {}) {
    const uid = await requireUser.call(this)
    if (!uid) return auth.fail('TOKEN_INVALID', '未登录')
    const j = await ownedJourney.call(this, uid, params.journeyId)
    if (!j) return auth.fail('NOT_FOUND', '旅程不存在')
    const dd = parseDate(params.deliveryDate)
    if (!Number.isFinite(dd)) return auth.fail('PARAM_ERROR', '分娩日期无效')
    const babies = Array.isArray(params.babies) ? params.babies : []
    if (babies.length === 0) return auth.fail('PARAM_ERROR', '至少登记一位宝宝')
    if (babies.length !== j.fetus_count && j.fetus_count > 1) return auth.fail('PARAM_ERROR', `多胎旅程需登记 ${j.fetus_count} 位宝宝`)
    const dbase = this.uniCloud.database()
    const ids = []
    for (const b of babies) {
      const r = await dbase.collection('lb-babies').add({
        journey_id: j._id, user_id: uid, nickname: String(b.nickname || '宝宝').slice(0, 12),
        sex: ['male', 'female', 'unknown'].includes(b.sex) ? b.sex : 'unknown',
        birth_date: dd, birth_weight_g: Math.max(200, Math.min(8000, +b.weightG || 0)),
        birth_length_cm: Math.max(20, Math.min(80, +b.lengthCm || 0)),
        delivery_mode: ['vaginal', 'c_section', 'assisted'].includes(params.deliveryMode) ? params.deliveryMode : 'vaginal',
        hospital: String(params.hospital || '').slice(0, 40), created_at: Date.now()
      })
      ids.push(r.id)
    }
    const patch = { delivery_date: dd, delivery_mode: params.deliveryMode || 'vaginal', delivery_hospital: String(params.hospital || '').slice(0, 40), baby_ids: ids, stage_code: 'POSTPARTUM', updated_at: Date.now() }
    await dbase.collection(col).doc(j._id).update(patch)
    const nj = Object.assign({}, j, patch)
    return auth.ok({ babyIds: ids, view: publicView(nj), birthCard: { stage: 'POSTPARTUM', deliveredAt: fmtDate(dd) } })
  },

  /** 当前旅程的宝宝列表（多胎/多宝） */
  async listBabies(params = {}) {
    const uid = await requireUser.call(this)
    if (!uid) return auth.fail('TOKEN_INVALID', '未登录')
    let j
    if (params.journeyId) {
      j = await ownedJourney.call(this, uid, params.journeyId)
    } else {
      const res = await this.uniCloud.database().collection(col).where({ user_id: uid }).orderBy('created_at', 'desc').limit(5).get()
      j = res.data.find(x => x.stage_code !== 'ARCHIVED' && x.stage_code !== 'MOURNING') || res.data[0]
    }
    if (!j) return auth.ok({ babies: [] })
    const res2 = await this.uniCloud.database().collection('lb-babies').where({ journey_id: j._id }).orderBy('birth_date', 'asc').get()
    return auth.ok({
      babies: res2.data.map(b => ({
        _id: b._id, nickname: b.nickname, sex: b.sex,
        birthDate: b.birth_date ? new Date(b.birth_date).toISOString().slice(0, 10) : '',
        birthWeightG: b.birth_weight_g || 0, birthLengthCm: b.birth_length_cm || 0
      }))
    })
  },

  async archiveJourney(params = {}) {
    const uid = await requireUser.call(this)
    if (!uid) return auth.fail('TOKEN_INVALID', '未登录')
    const j = await ownedJourney.call(this, uid, params.journeyId)
    if (!j) return auth.fail('NOT_FOUND', '旅程不存在')
    await this.uniCloud.database().collection(col).doc(j._id).update({ stage_code: 'ARCHIVED', updated_at: Date.now() })
    return auth.ok()
  }
}
