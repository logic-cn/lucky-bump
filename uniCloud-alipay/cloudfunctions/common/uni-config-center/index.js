/**
 * uni-config-center 兼容层（零依赖，接口对齐官方插件：require('uni-config-center')({pluginId}).config()）
 * 配置文件位于本目录下 <pluginId>/config.json；真实密钥文件不入 git（见 .gitignore），部署时随公共模块一并上传。
 */
'use strict'
const fs = require('fs')
const path = require('path')

module.exports = function (options = {}) {
  const pluginId = options.pluginId || ''
  const dir = path.join(__dirname, pluginId)
  return {
    config() {
      try {
        const raw = fs.readFileSync(path.join(dir, 'config.json'), 'utf8')
        return JSON.parse(raw)
      } catch (e) {
        return {}
      }
    },
    configFilePath() { return path.join(dir, 'config.json') }
  }
}
