'use strict'
/**
 * lucky-maintenance —— 账号注销冷静期满后的物理删除（docs/03 M6.4 数据权利）
 *
 * 触发方式：uniCloud 定时触发器（package.json → cloudfunction-config.triggers），每日 03:00。
 * 职责：扫描 uni-id-users 中 status=pending_deletion 且 purge_at <= now 的账号，
 *       按旅程级联删除全部业务数据、家庭关系、token，最后删除账号本身。
 * 说明：本函数零第三方依赖，不引用公共模块，便于独立部署与本地测试。
 */

/** 以 journey_id 归属的业务集合（与 lucky-data.exportAll 的清单保持同步） */
const JOURNEY_COLLECTIONS = [
  'lb-babies', 'lb-cycles', 'lb-cycle-events', 'lb-daily-logs', 'lb-tracker-sessions',
  'lb-prenatal-visits', 'lb-schedule-items', 'lb-screenings', 'lb-feedings',
  'lb-diaper-changes', 'lb-sleep-sessions', 'lb-growth-samples', 'lb-vaccinations',
  'lb-milestones', 'lb-food-logs', 'lb-medication-logs', 'lb-reminder-rules',
  'lb-diaries', 'lb-families', 'lb-family-invites', 'lb-child-health', 'lb-events'
]

async function removeWhere(db, collection, where) {
  const res = await db.collection(collection).where(where).remove()
  return res && res.removed ? res.removed : 0
}

/**
 * 物理删除单个账号。
 * 顺序：家庭关系 → 旅程数据 → 旅程 → token → 账号。
 * 返回 { uid, journeys, families, removed }，便于定时任务日志与测试断言。
 */
async function purgeOne(db, uid, now) {
  let removed = 0
  const journeys = await db.collection('lb-journeys').where({ user_id: uid }).get()
  const journeyIds = journeys.data.map(j => j._id)
  const families = await db.collection('lb-families').where({ owner_id: uid }).get()
  const familyIds = families.data.map(f => f._id)

  // 1) 家庭关系：自己创建的家庭成员/邀请 + 自己作为成员加入的他人家庭
  for (const fid of familyIds) {
    removed += await removeWhere(db, 'lb-family-members', { family_id: fid })
    removed += await removeWhere(db, 'lb-family-invites', { family_id: fid })
  }
  removed += await removeWhere(db, 'lb-family-members', { user_id: uid })

  // 2) 旅程级联业务数据
  for (const jid of journeyIds) {
    for (const c of JOURNEY_COLLECTIONS) {
      removed += await removeWhere(db, c, { journey_id: jid })
    }
  }

  // 3) 旅程本体 + 本人创建的家庭
  removed += await removeWhere(db, 'lb-journeys', { user_id: uid })
  removed += await removeWhere(db, 'lb-families', { owner_id: uid })

  // 4) 反馈、短信验证码、token 与账号
  removed += await removeWhere(db, 'lb-feedback', { user_id: uid })
  const userRes = await db.collection('uni-id-users').doc(uid).get()
  const mobile = (userRes.data[0] && userRes.data[0].mobile) || ''
  if (mobile) removed += await removeWhere(db, 'lb-sms-codes', { phone: mobile })
  removed += await removeWhere(db, 'lb-token', { uid })
  removed += await removeWhere(db, 'uni-id-users', { _id: uid })

  return { uid, journeys: journeyIds.length, families: familyIds.length, removed, purgedAt: now }
}

/**
 * 扫描并清理所有到期账号。db 由调用方注入（云端为 uniCloud.database()，测试为内存 mock）。
 * 返回 { scanned, purged: [...], errors: [...] }。
 */
async function purgeDueUsers(db, now = Date.now()) {
  const res = await db.collection('uni-id-users').where({ status: 'pending_deletion' }).get()
  const due = (res.data || []).filter(u => (u.purge_at || 0) > 0 && u.purge_at <= now)
  const purged = []
  const errors = []
  for (const u of due) {
    try {
      purged.push(await purgeOne(db, u._id, now))
    } catch (e) {
      // 单个账号失败不影响其余账号；错误上报到定时任务日志
      errors.push({ uid: u._id, message: e && e.message ? e.message : String(e) })
    }
  }
  return { scanned: (res.data || []).length, purged, errors }
}

exports.purgeDueUsers = purgeDueUsers

/** 定时触发入口（uniCloud 云函数约定：exports.main） */
exports.main = async () => {
  const result = await purgeDueUsers(uniCloud.database(), Date.now())
  console.log('[lucky-maintenance] 注销清理完成', JSON.stringify(result))
  return result
}
