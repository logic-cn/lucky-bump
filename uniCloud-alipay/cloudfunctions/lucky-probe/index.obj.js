'use strict'

/**
 * 调试探测对象。生产环境禁止暴露运行时信息与任意参数回显。
 * 如需本地排查，请直接使用 test/harness 或在开发空间临时启用。
 */
module.exports = {
  async probe() {
    return { errCode: 'FORBIDDEN', errMsg: 'probe 已禁用' }
  }
}
