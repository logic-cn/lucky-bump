/**
 * lucky-seed —— 部署自检：校验模板数据完整性与关键配置（部署文档步骤 3）
 */
'use strict'
const auth = require('./common/lucky-auth-common')
const T = require('./common/lucky-templates')

module.exports = {
  /** 校验基础模板已随代码部署（模板内置于代码，无需 DB 写入） */
  async verifySeed() {
    const checks = {
      prenatalTemplates: T.PRENATAL_PLAN.length,
      vaccineProgram: T.VACCINE_PROGRAM.length,
      selfPaidVaccines: T.VACCINE_SELF_PAID.length,
      epdsItems: T.EPDS_ITEMS.length,
      milestones: T.MILESTONES.length,
      weightGainProfiles: T.WEIGHT_GAIN.length
    }
    const problems = []
    if (checks.prenatalTemplates < 7) problems.push('产检模板不完整')
    if (checks.vaccineProgram < 22) problems.push('免疫规划疫苗程序表不完整')
    if (checks.epdsItems !== 10) problems.push('EPDS 量表题数错误')
    const secret = auth.loadSecret()
    if (secret.startsWith('lb-dev-secret') || !auth.isUsableSecret(secret)) problems.push('tokenSecret 未配置为正式密钥：请在 uni-config-center 的 uni-id/config.json 配置至少 32 位随机串（上线前必须）')
    return auth.ok(Object.assign({ ok: problems.length === 0, problems }, checks))
  }
}
