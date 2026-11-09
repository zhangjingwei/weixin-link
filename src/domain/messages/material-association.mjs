import {createHash} from 'node:crypto'

// IDs are scoped to the durable delivery; never infer association from clock or sequence.
export function currentMaterials(input, deliveryId) {
  if (!input || typeof input !== 'object') return []
  const attachments = input.attachments ?? [], seen = new Set(), rows = []
  for (const item of [...attachments, ...(input.images ?? []).map(path => ({path, kind: 'images'})), ...(input.audios ?? []).map(path => ({path, kind: 'voices'}))]) {
    if (!item?.path || seen.has(item.path)) continue
    seen.add(item.path)
    rows.push({id: createHash('sha256').update(deliveryId + '\0' + item.path).digest('hex').slice(0, 16), name: item.name ?? item.path.split('/').pop(), kind: item.kind ?? 'files'})
  }
  return rows
}

export function hasAttachments(input) {return typeof input === 'object' && Boolean(input?.attachments?.length || input?.images?.length || input?.audios?.length)}
