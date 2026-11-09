import {createHash} from 'node:crypto'

function safeMaterialName(item) {
  const value = typeof item.name === 'string' && item.name ? item.name : item.path
  const name = String(value).replaceAll('\\', '/').split('/').pop().replace(/[\x00-\x1f\x7f]/g, '_').slice(-160)
  return name && name !== '.' && name !== '..' ? name : 'file'
}

// IDs are scoped to the durable delivery; never infer association from clock or sequence.
export function currentMaterials(input, deliveryId) {
  if (!input || typeof input !== 'object') return []
  const attachments = input.attachments ?? [], seen = new Set(), rows = []
  for (const item of [...attachments, ...(input.images ?? []).map(path => ({path, kind: 'images'})), ...(input.audios ?? []).map(path => ({path, kind: 'voices'}))]) {
    if (!item?.path || seen.has(item.path)) continue
    seen.add(item.path)
    rows.push({id: createHash('sha256').update(deliveryId + '\0' + item.path).digest('hex').slice(0, 16), name: safeMaterialName(item), kind: item.kind ?? 'files'})
  }
  return rows
}

export function hasAttachments(input) {return typeof input === 'object' && Boolean(input?.attachments?.length || input?.images?.length || input?.audios?.length)}
