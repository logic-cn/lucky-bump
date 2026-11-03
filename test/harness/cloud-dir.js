/** 当前项目使用的 uniCloud 服务商目录（切换云厂商后自动跟随）。 */
const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '../..')
const CLOUD_DIR = fs.existsSync(path.join(ROOT, 'uniCloud-alipay'))
  ? 'uniCloud-alipay'
  : (fs.existsSync(path.join(ROOT, 'uniCloud-aliyun')) ? 'uniCloud-aliyun' : 'uniCloud-tcb')
const CLOUD_ROOT = path.join(ROOT, CLOUD_DIR)

module.exports = { ROOT, CLOUD_DIR, CLOUD_ROOT }
