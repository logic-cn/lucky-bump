/**
 * lucky-analytics —— 最小埋点接收端（docs/05 成功指标）
 * 只采集行为事件与聚合属性，不接收健康内容/文本；事件白名单校验，批量写入 lb-events。
 */
'use strict'
const auth = require('./common/lucky-auth-common')

const COL = 'lb-events'
const MAX_BATCH = 20
const ALLOWED = new Set([
  'app_launch', 'onboarding_complete', 'record_create',
  'reminder_done', 'export_done', 'family_invite', 'family_join',
  'report_view', 'report_share', 'reminder_due', 'reminder_open',
  'journey_switch', 'feedback_submit'
])

function db() { return uniCloud.database() }
async function requireUser() {
  const token = (this.__mockToken != null) ? this.__mockToken : this.getUniIdToken()
  const r = await auth.requireUser(db.call(this), token)
  return r.ok ? r.uid : null
}
function dateOf(ts) { return new Date(ts).toISOString().slice(0, 10) }

/** 只保留短字符串/数字/布尔属性，拒绝任何长文本，避免把健康内容带进事件表 */
function safeProps(props) {
  const out = {}
  if (!props || typeof props !== 'object') return out
  for (const k of Object.keys(props)) {
    if (Object.keys(out).length >= 5) break
    const v = props[k]
    const t = typeof v
    if (t === 'string') out[k] = String(v).slice(0, 24)
    else if (t === 'number' || t === 'boolean') out[k] = v
  }
  return out
}

module.exports = {
  /** 批量上报：events = [{ event, journeyId, props, ts }] */
  async report(params = {}) {
    const uid = await requireUser.call(this)
    if (!uid) return auth.fail('TOKEN_INVALID', '未登录')
    const events = Array.isArray(params.events) ? params.events.slice(0, MAX_BATCH) : []
    const now = Date.now()
    let accepted = 0
    for (const e of events) {
      if (!e || typeof e !== 'object') continue
      const event = String(e.event || '')
      if (!ALLOWED.has(event)) continue
      const ts = Number(e.ts) || now
      await db.call(this).collection(COL).add({
        user_id: uid,
        journey_id: String(e.journeyId || ''),
        event,
        props: safeProps(e.props),
        date: dateOf(ts),
        ts
      })
      accepted++
    }
    return auth.ok({ accepted })
  },

  /**
   * 运营看板（仅 lucky-ops 管理员）：近 7/30 天活跃、记录类型分布、关键事件与激活漏斗。
   * 数据来自 lb-events 与各业务表计数；只读，不返回任何健康内容。
   */
  async opsSummary() {
    const uid = await requireUser.call(this)
    if (!uid) return auth.fail('TOKEN_INVALID', '未登录')
    const ops = auth.readConfig('lucky-ops')
    const admins = Array.isArray(ops.adminUserIds) ? ops.adminUserIds : []
    if (admins.indexOf(uid) < 0) return auth.fail('PERMISSION_DENIED', '仅运营管理员可查看')
    const dbase = db.call(this)
    const now = Date.now()
    const DAY = 24 * 3600 * 1000
    const since7 = now - 7 * DAY
    const since30 = now - 30 * DAY
    const evRes = await dbase.collection(COL).orderBy('ts', 'desc').limit(5000).get()
    const events = evRes.data
    const in7 = events.filter(e => e.ts >= since7)
    const in30 = events.filter(e => e.ts >= since30)
    const uniqUsers = (arr) => {
      const set = new Set()
      for (const e of arr) { const u = e.user_id || e.uid || ''; if (u) set.add(u) }
      return set
    }
    const countEvent = (arr, name) => arr.filter(e => e.event === name).length
    const recordTypes = {}
    for (const e of in30) {
      if (e.event !== 'record_create') continue
      const t = (e.props && e.props.type) || 'unknown'
      recordTypes[t] = (recordTypes[t] || 0) + 1
    }
    const typeRows = Object.keys(recordTypes).map(k => ({ type: k, count: recordTypes[k] })).sort((a, b) => b.count - a.count).slice(0, 12)

    const usersTotal = await dbase.collection('uni-id-users').count()
    const journeysTotal = await dbase.collection('lb-journeys').count()
    const babiesTotal = await dbase.collection('lb-babies').count()
    const feedbackOpen = await dbase.collection('lb-feedback').where({ status: 'open' }).count()

    const onboarded = countEvent(events, 'onboarding_complete')
    const recorded = countEvent(events, 'record_create')
    const activated = Math.min(onboarded, recorded) // 近似：两者都发生的用户数需要逐用户求交，这里取保守下界
    const stats = [
      { label: '用户总数', value: `${usersTotal.total}` },
      { label: '旅程总数', value: `${journeysTotal.total}` },
      { label: '宝宝档案', value: `${babiesTotal.total}` },
      { label: '近 7 天活跃（去重）', value: `${uniqUsers(in7).size}` },
      { label: '近 30 天活跃（去重）', value: `${uniqUsers(in30).size}` },
      { label: '近 7 天记录事件', value: `${countEvent(in7, 'record_create')}` },
      { label: '近 30 天记录事件', value: `${countEvent(in30, 'record_create')}` },
      { label: '提醒完成', value: `${countEvent(in30, 'reminder_done')}` },
      { label: '家庭邀请 / 加入', value: `${countEvent(in30, 'family_invite')} / ${countEvent(in30, 'family_join')}` },
      { label: '报告查看', value: `${countEvent(in30, 'report_view')}` },
      { label: '待处理反馈', value: `${feedbackOpen.total}` }
    ]
    const funnel = [
      { label: '完成建档', value: onboarded },
      { label: '产生记录', value: recorded },
      { label: '两者都完成（下界）', value: activated }
    ]
    return auth.ok({ stats, recordTypes: typeRows, funnel, generatedAt: now })
  }
}
