/**
 * 内存版 uniCloud 运行时（测试底座）
 * 实现 cloud objects 依赖的传统 DB API 子集 + 云对象调用协议，让全部业务逻辑可本地验证。
 * 覆盖：collection().add / doc().get/update / where().get/count/update / orderBy/limit/skip / command.neq
 */
'use strict'
const path = require('path')

const OBJ_DIR = path.resolve(__dirname, '../../uniCloud-aliyun/cloudfunctions')

class MockCollection {
  constructor(store, name) {
    this._store = store // { data: Map }
    this._name = name
    if (!store.has(name)) store.set(name, new Map())
    this._ops = []
  }
  get _docs() { return this._store.get(this._name) }
  _chain() {
    const api = {}
    let filter = null
    let orderByField = null, orderByDir = 'asc'
    let limitN = 100, skipN = 0
    const match = (doc) => {
      if (!filter) return true
      return Object.entries(filter).every(([k, v]) => {
        if (v && typeof v === 'object' && v.__cmd === 'neq') return doc[k] !== v.val
        return doc[k] === v
      })
    }
    const matched = () => {
      let rows = [...this._docs.entries()].map(([_id, doc]) => Object.assign({ _id }, doc)).filter(match)
      if (orderByField) rows.sort((a, b) => (orderByDir === 'desc' ? -1 : 1) * (a[orderByField] > b[orderByField] ? 1 : a[orderByField] < b[orderByField] ? -1 : 0))
      return rows.slice(skipN, skipN + limitN)
    }
    api.where = (q) => { filter = q || null; return api }
    api.orderBy = (f, d) => { orderByField = f; orderByDir = d || 'asc'; return api }
    api.limit = (n) => { limitN = n; return api }
    api.skip = (n) => { skipN = n; return api }
    api.offset = (n) => { skipN = n; return api }
    api.get = async () => ({ data: matched() })
    api.count = async () => ({ total: matched().length })
    api.add = async (doc) => {
      const id = 'id_' + (++this._store.seq) + '_' + Math.random().toString(36).slice(2, 8)
      this._docs.set(id, JSON.parse(JSON.stringify(doc)))
      return { id }
    }
    api.update = async (patch) => {
      let updated = 0
      for (const [_id, doc] of this._docs) {
        if (match(Object.assign({ _id }, doc))) { Object.assign(doc, JSON.parse(JSON.stringify(patch))); updated++ }
      }
      return { updated }
    }
    api.remove = async () => {
      let removed = 0
      for (const [_id, doc] of this._docs) {
        if (match(Object.assign({ _id }, doc))) { this._docs.delete(_id); removed++ }
      }
      return { removed }
    }
    api.doc = (id) => ({
      get: async () => ({ data: this._docs.has(id) ? [Object.assign({ _id: id }, this._docs.get(id))] : [] }),
      update: async (patch) => { if (this._docs.has(id)) { Object.assign(this._docs.get(id), JSON.parse(JSON.stringify(patch))) } return { updated: 1 } },
      set: async (doc) => { this._docs.set(id, JSON.parse(JSON.stringify(doc))); return {} },
      remove: async () => { this._docs.delete(id); return {} }
    })
    return api
  }
  // 每次顶层调用返回独立链
  where(q) { return this._chain().where(q) }
  orderBy(f, d) { return this._chain().orderBy(f, d) }
  limit(n) { return this._chain().limit(n) }
  doc(id) { return this._chain().doc(id) }
  add(doc) { return this._chain().add(doc) }
  count() { return this._chain().count() }
}

function createRuntime() {
  const store = new Map(); store.seq = 0
  const db = {
    command: { neq: (v) => ({ __cmd: 'neq', val: v }) },
    collection: (name) => new MockCollection(store, name)
  }
  return {
    db, store,
    /** 调用云对象：ctx 含 getUniIdToken/getClientInfo，token 经 uni_id_token 语义传递；
     *  与阿里云真实运行时一致：uniCloud.database() 走全局变量，this 上仅暴露 getUniIdToken 等上下文方法 */
    async callObject(objName, method, params = {}, opts = {}) {
      if (method.startsWith('_')) throw new Error('私有方法不可外部调用')
      const mod = require(path.join(OBJ_DIR, objName, 'index.obj.js'))
      const fn = mod[method]
      if (typeof fn !== 'function') throw new Error(`method ${objName}.${method} not found`)
      const prevGlobal = global.uniCloud
      global.uniCloud = { database: () => db }
      try {
        // 模拟云对象 this：上下文属性 + 模块方法原型链（支持 this._internal 调用）
        const ctx = Object.create(mod)
        Object.assign(ctx, {
          getUniIdToken: () => opts.token || '',
          getClientInfo: () => ({ clientIP: '127.0.0.1' })
        })
        // 与云端 callFunction 语义一致：params 为参数数组时按 method(...params) 展开
        const args = Array.isArray(params) ? params : [params]
        return await fn.call(ctx, ...args)
      } finally {
        if (prevGlobal === undefined) delete global.uniCloud
        else global.uniCloud = prevGlobal
      }
    }
  }
}

module.exports = { createRuntime }

/** 固定时钟运行（确定性测试）：期间 Date.now() 返回 ts */
async function withFixedClock(ts, fn) {
  const real = Date.now
  Date.now = () => ts
  try { return await fn() } finally { Date.now = real }
}
module.exports.withFixedClock = withFixedClock
