import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, stat, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createCipheriv, randomBytes } from 'node:crypto'
import { prepareMedia, downloadMedia, MAX_BYTES } from '../../src/infrastructure/media/media-input.mjs'

test('bounded encrypted CDN download and supported key encodings', async () => {
  const key = randomBytes(16)
  const cipher = createCipheriv('aes-128-ecb', key, null)
  const data = Buffer.concat([cipher.update(Buffer.from('test attachment')), cipher.final()])
  for (const aes_key of [key.toString('hex'), key.toString('base64'), Buffer.from(key.toString('hex')).toString('base64')]) {
    assert.equal((await downloadMedia({ media: { aes_key, full_url: 'https://novac2c.cdn.weixin.qq.com/file' } }, async () => new Response(data))).toString(), 'test attachment')
  }
  await assert.rejects(downloadMedia({ media: { full_url: 'https://novac2c.cdn.weixin.qq.com' } }, async () => new Response(data, { headers: { 'content-length': String(MAX_BYTES + 100) } })), /50MB/)
  await assert.rejects(downloadMedia({}), /下载信息/)
})

test('mixed attachments, safe filenames, image detection, partial failure, permissions', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'wechat-media-'))
  try {
    const image = Buffer.from('89504e470d0a1a0a', 'hex')
    const msg = { userId: '../../owner', type: 'image', raw: { item_list: [{ text_item: { text: '比较附件' } }] }, images: [{}], files: [{ fileName: '../../report.pdf' }, { fileName: 'bad', size: MAX_BYTES + 1 }], videos: [{}], voices: [{ text: '转写' }] }
    const result = await prepareMedia(msg, dir, async item => item.fileName ? Buffer.from('%PDF-test') : msg.images.includes(item) ? image : Buffer.from('media'))
    assert.equal(result.attachments.length, 4)
    assert.equal(result.images.length, 1)
    assert.equal(result.errors.length, 1)
    assert.ok(result.text.startsWith('比较附件'))
    assert.ok(result.attachments.every(a => a.path.startsWith(join(dir, 'attachments'))))
    assert.equal(result.attachments[1].name, 'report.pdf')
    assert.equal((await stat(result.attachments[1].path)).mode & 0o777, 0o600)
    assert.equal((await readFile(result.attachments[1].path)).toString(), '%PDF-test')
    await assert.rejects(prepareMedia({ userId: 'owner', files: Array(11).fill({}) }, dir), /10/)
  } finally { await rm(dir, { recursive: true, force: true }) }
})
