/**
 * 成长相册：上传登记、列表、删除权限
 */
const test = require('node:test')
const assert = require('node:assert')
const { createRuntime } = require('../harness/unicloud-mock')

async function setup() {
  const rt = createRuntime()
  const reg = await rt.callObject('lucky-id', 'register', { username: 'albumMom', password: 'password123' })
  assert.equal(reg.errCode, 0, JSON.stringify(reg))
  const mk = await rt.callObject('lucky-journey', 'createJourney', {
    mode: 'pregnant', title: '相册旅程', lmpDate: '2026-01-01'
  }, { token: reg.token })
  assert.equal(mk.errCode, 0, JSON.stringify(mk))
  const del = await rt.callObject('lucky-journey', 'registerDelivery', {
    journeyId: mk.journeyId, deliveryDate: '2026-10-30', deliveryMode: 'vaginal',
    babies: [{ nickname: '小满', sex: 'female', weightG: 3200, lengthCm: 50 }]
  }, { token: reg.token })
  assert.equal(del.errCode, 0, JSON.stringify(del))
  return { rt, token: reg.token, jid: mk.journeyId, babyId: del.babyIds[0] }
}

test('相册：登记照片后可按宝宝列出，并标记 mine', async () => {
  const { rt, token, jid, babyId } = await setup()
  const add = await rt.callObject('lucky-baby', 'addPhoto', {
    journeyId: jid, babyId, fileId: 'cloud://test/album/a.jpg', caption: '第一次翻身'
  }, { token })
  assert.equal(add.errCode, 0, JSON.stringify(add))

  const list = await rt.callObject('lucky-baby', 'listPhotos', { journeyId: jid, babyId }, { token })
  assert.equal(list.errCode, 0, JSON.stringify(list))
  assert.equal(list.photos.length, 1, '应列出 1 张照片')
  assert.equal(list.photos[0].caption, '第一次翻身')
  assert.equal(list.photos[0].mine, true, '上传者应标记 mine')
})

test('相册：缺少图片的登记被拒绝', async () => {
  const { rt, token, jid, babyId } = await setup()
  const add = await rt.callObject('lucky-baby', 'addPhoto', { journeyId: jid, babyId }, { token })
  assert.equal(add.errCode, 'PARAM_ERROR')
})

test('相册：删除后列表为空，他人不可访问', async () => {
  const { rt, token, jid, babyId } = await setup()
  const add = await rt.callObject('lucky-baby', 'addPhoto', {
    journeyId: jid, babyId, fileId: 'cloud://test/album/b.jpg'
  }, { token })
  assert.equal(add.errCode, 0, JSON.stringify(add))
  const del = await rt.callObject('lucky-baby', 'removePhoto', { journeyId: jid, photoId: add.photoId }, { token })
  assert.equal(del.errCode, 0, JSON.stringify(del))
  const list = await rt.callObject('lucky-baby', 'listPhotos', { journeyId: jid, babyId }, { token })
  assert.equal(list.photos.length, 0, '删除后应为空')

  const other = await rt.callObject('lucky-id', 'register', { username: 'albumOther', password: 'password123' })
  const denied = await rt.callObject('lucky-baby', 'listPhotos', { journeyId: jid, babyId }, { token: other.token })
  assert.equal(denied.errCode, 'NOT_FOUND', '无关用户不得查看他人相册')
})
