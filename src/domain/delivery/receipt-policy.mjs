export function receiptPolicy({media, busy, waiting}) {
  if (!media) return 'send'
  if (waiting) return 'suppress'
  return busy ? 'defer' : 'send'
}
