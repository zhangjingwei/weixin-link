import { mkdir, writeFile, stat, readdir, statfs } from 'node:fs/promises'
import { join, basename } from 'node:path'
import { randomUUID, createHash, createDecipheriv } from 'node:crypto'

export const MAX_BYTES = 50 * 1024 * 1024
export const hasMedia = message => ['images', 'files', 'videos', 'voices'].some(k => message[k]?.length)

// Match the SDK's CDN AES key encodings, with a bounded streaming download.
export async function downloadMedia(item, fetcher = fetch, signal) {
  if (!item.media) throw new Error('附件缺少下载信息，请重新发送原文件')
  const media = item.media
  const url = media.full_url?.trim() || `https://novac2c.cdn.weixin.qq.com/c2c/download?encrypted_query_param=${encodeURIComponent(media.encrypt_query_param)}`
  if (new URL(url).protocol !== 'https:') throw new Error('附件下载地址必须是 HTTPS')
  const response = await fetcher(url, { signal: signal?AbortSignal.any([signal,AbortSignal.timeout(60_000)]):AbortSignal.timeout(60_000) })
  if (!response.ok) throw new Error(`附件下载失败（HTTP ${response.status}）`)
  const limit = MAX_BYTES + 32
  const reader = response.body.getReader()
  const chunks = []
  let size = 0
  try {
    if (Number(response.headers.get('content-length')) > limit) throw new Error('附件超过 50MB 限制')
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.length
      if (size > limit) throw new Error('附件超过 50MB 限制')
      chunks.push(Buffer.from(value))
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock() }
  const encoded = item.aeskey ?? media.aes_key
  if (!encoded) throw new Error('附件缺少解密信息')
  let key = /^[a-f\d]{32}$/i.test(encoded) ? Buffer.from(encoded, 'hex') : Buffer.from(encoded, 'base64')
  if (key.length === 32 && /^[a-f\d]{32}$/i.test(key.toString())) key = Buffer.from(key.toString(), 'hex')
  if (key.length !== 16) throw new Error('附件解密信息无效')
  const decipher = createDecipheriv('aes-128-ecb', key, null)
  const result = Buffer.concat([decipher.update(Buffer.concat(chunks)), decipher.final()])
  if (result.length > MAX_BYTES) throw new Error('附件超过 50MB 限制')
  return result
}

export function imageExtension(data) {
  if (data.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) return '.png'
  if (data[0] === 255 && data[1] === 216 && data[2] === 255) return '.jpg'
  if (data.subarray(0, 3).toString() === 'GIF') return '.gif'
  if (data.subarray(0, 4).toString() === 'RIFF' && data.subarray(8, 12).toString() === 'WEBP') return '.webp'
  return null
}

export async function prepareMedia(message, stateDir, download = downloadMedia, signal) {
  signal?.throwIfAborted()
  const entries = ['images', 'files', 'videos', 'voices'].flatMap(kind => (message[kind] ?? []).map(item => ({ kind, item })))
  if (entries.length > 10) throw new Error('单条消息最多支持 10 个附件')
  const owner = createHash('sha256').update(message.userId).digest('hex').slice(0, 24)
  const root = join(stateDir, 'attachments', owner)
  await mkdir(root, { recursive: true, mode: 0o700 })
  const disk = await statfs(root)
  if (disk.bavail * disk.bsize < 512 * 1024 * 1024) throw new Error('磁盘剩余空间不足 512MB，暂停接收附件')
  let stored = 0
  for (const entry of await readdir(root, { recursive: true, withFileTypes: true })) {
    if (entry.isFile()) stored += (await stat(join(entry.parentPath, entry.name))).size
  }
  if (stored > 1024 * 1024 * 1024 - MAX_BYTES) throw new Error('附件存储接近 1GB 上限，请先清理历史附件')
  const dir = join(root, randomUUID())
  await mkdir(dir, { mode: 0o700 })
  const attachments = []
  const errors = []
  let total = 0
  for (const { kind, item } of entries) {
    try {
      if (item.size > MAX_BYTES) throw new Error('附件超过 50MB 限制')
      signal?.throwIfAborted()
      const data = await download(item,undefined,signal)
      signal?.throwIfAborted()
      total += data.length
      if (data.length > MAX_BYTES || total > MAX_BYTES) throw new Error('单条消息附件总大小超过 50MB')
      const image = imageExtension(data)
      const fallback = kind === 'images' ? `image${image ?? '.bin'}` : kind === 'videos' ? 'video.mp4' : kind === 'voices' ? 'voice.silk' : 'file.bin'
      const name = basename((item.fileName || fallback).replaceAll('\\', '/')).replace(/[\x00-\x1f\x7f]/g, '_').slice(-160) || fallback
      const path = join(dir, `${attachments.length + 1}-${name}`)
      await writeFile(path, data, { mode: 0o600, flag: 'wx' })
      attachments.push({ path, name, kind, bytes: (await stat(path)).size, image: Boolean(image), transcript: item.text })
    } catch (error) { errors.push(`${kind}：${error.message.startsWith('附件') || error.message.startsWith('单条') ? error.message : '下载或解密失败，请重新发送'}`) }
  }
  const text = message.raw?.item_list?.filter(i => i.text_item?.text).map(i => i.text_item.text).join('\n') || (message.type === 'text' ? message.text : '')
  // Receipt only. Codex input is built once, after batching, by composeMediaInput.
  return {text,images:attachments.filter(a=>a.image).map(a=>a.path),attachments,errors}
}
