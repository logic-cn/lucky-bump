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
  'reminder_done', 'export_done', 'family_invite'
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
        uid,
        journey_id: String(e.journeyId || ''),
        event,
        props: safeProps(e.props),
        date: dateOf(ts),
        ts
      })
      accepted++
    }
    return auth.ok({ accepted })
  }
}
