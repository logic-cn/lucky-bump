'use strict'
function db() { return this.uniCloud.database() }
module.exports = {
  async probe(params = {}) {
    let thisType, thisKeys = [], hasUniCloud = false, hasGetToken = false
    try { thisType = typeof this } catch (e) { thisType = 'ERR' }
    try { if (this && typeof this === 'object') thisKeys = Object.getOwnPropertyNames(Object.getPrototypeOf(this) || {}).slice(0, 20) } catch (e) {}
    try { hasUniCloud = !!(this && this.uniCloud) } catch (e) {}
    try { hasGetToken = !!(this && typeof this.getUniIdToken === 'function') } catch (e) {}
    let dbViaThis = 'N/A', dbViaGlobal = 'N/A'
    try { dbViaThis = typeof db.call(this) } catch (e) { dbViaThis = 'ERR:' + e.message }
    try { dbViaGlobal = typeof uniCloud.database() } catch (e) { dbViaGlobal = 'ERR:' + e.message }
    let argsInfo = 'N/A'
    try { argsInfo = JSON.stringify({ argc: arguments.length, p0: typeof arguments[0], keys: arguments[0] && typeof arguments[0] === 'object' ? Object.keys(arguments[0]).slice(0, 8) : null }) } catch (e) { argsInfo = 'ERR' }
    return { ok: true, thisType, thisKeys, hasUniCloud, hasGetToken, dbViaThis, dbViaGlobal, argsInfo, paramsEcho: params }
  }
}
