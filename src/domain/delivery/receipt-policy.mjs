export function receiptPolicy({media, busy, waiting}) {
  if (!media) return 'suppress'
  if (waiting) return 'suppress'
  return busy ? 'defer' : 'suppress'
}
