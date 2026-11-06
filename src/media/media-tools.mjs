import {fileURLToPath} from 'node:url'
import {ffmpegBinary} from './media-binary.mjs'
// Usage: node media-tools.mjs pdf|video INPUT OUTPUT_DIRECTORY [START_PAGE_OR_SECONDS]
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createCanvas, DOMMatrix, ImageData, Path2D } from '@napi-rs/canvas'

const [kind, input, output, startArg, limitArg] = process.argv.slice(2)
if (!['pdf', 'video', 'audio'].includes(kind) || !input || !output) throw new Error('Usage: pdf|video INPUT OUTPUT_DIR [START_PAGE_OR_SECONDS]')
const dir = resolve(output)
await mkdir(dir, { recursive: true, mode: 0o700 })
const count=Math.min(kind==='pdf'?5:6,Math.max(1,Number(limitArg??(kind==='pdf'?5:6))))
if(!Number.isInteger(count))throw Error('Invalid output limit')
if (kind === 'pdf') {
  Object.assign(globalThis, { DOMMatrix, ImageData, Path2D })
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const { readFile } = await import('node:fs/promises')
  const pdf = await getDocument({ data: new Uint8Array(await readFile(resolve(input))), useSystemFonts: false, standardFontDataUrl: fileURLToPath(new URL('../../node_modules/pdfjs-dist/standard_fonts/', import.meta.url)), disableFontFace: true, isEvalSupported: false }).promise
  const start = Math.max(1, Number.parseInt(startArg ?? '1'))
  if (!Number.isFinite(start) || start > pdf.numPages) throw new Error('Invalid page number')
  const texts = []
  for (let n = start; n <= Math.min(pdf.numPages, start + count - 1); n++) {
    const page = await pdf.getPage(n)
    const text = (await page.getTextContent()).items.map(i => i.str ?? '').join(' ')
    texts.push(`Page ${n}\n${text}`)
    const base = page.getViewport({ scale: 1 })
    const viewport = page.getViewport({ scale: Math.min(1.5, 1600 / Math.max(base.width, base.height)) })
    const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height))
    await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise
    await writeFile(join(dir, `page-${n}.png`), canvas.toBuffer('image/png'), { mode: 0o600 })
    page.cleanup()
  }
  await writeFile(join(dir, 'text.txt'), texts.join('\n\n'), { mode: 0o600 })
  console.log(JSON.stringify({ pages: pdf.numPages, processedFrom: start, processedTo: Math.min(pdf.numPages, start + count - 1), output: dir }))
  await pdf.cleanup()
} else if(kind==='video') {
  const binary = ffmpegBinary
  const start = Number(startArg ?? '0')
  if (!Number.isFinite(start) || start < 0) throw new Error('Invalid seconds')
  await promisify(execFile)(binary, ['-nostdin', '-hide_banner', '-loglevel', 'error', '-threads', '1', '-ss', String(start), '-protocol_whitelist','file,pipe','-i', resolve(input), '-t', '60', '-vf', `select='isnan(prev_selected_t)+gte(t-prev_selected_t,${60/count})',scale=960:960:force_original_aspect_ratio=decrease`, '-vsync','vfr','-frames:v', String(count), '-threads', '1', '-y', join(dir, 'frame-%02d.jpg')], { timeout: 90_000, maxBuffer: 1024 * 1024 })
  console.log(JSON.stringify({ output: dir, sampledFromSeconds: start, sampledDurationAtMost: 60, intervalSeconds: 60/count, maxFrames: count, audioAnalyzed: false }))
}
 else {
  const {readFile,chmod}=await import('node:fs/promises'),binary=ffmpegBinary
  const data=await readFile(resolve(input));let source=resolve(input)
  if(data.subarray(0,16).includes(Buffer.from('#!SILK'))){const {getDuration}=await import('silk-wasm');if(data.length>2*1024*1024||getDuration(data)>120000)throw Error('SILK_DURATION_LIMIT');const {silkToWav}=await import('@wechatbot/wechatbot/media');const wav=await silkToWav(data);if(!wav)throw Error('SILK_DECODE_FAILED');source=join(dir,'decoded.wav');await writeFile(source,wav,{mode:0o600})}
  const path=join(dir,'audio.wav')
  await promisify(execFile)(binary,['-nostdin','-hide_banner','-loglevel','error','-threads','1','-protocol_whitelist','file,pipe','-i',source,'-t','120','-vn','-ac','1','-ar','16000','-c:a','pcm_s16le','-y',path],{timeout:60000,maxBuffer:65536})
  await chmod(path,0o600)
  console.log(JSON.stringify({audio:path,sampledFromSeconds:0,sampledDurationAtMost:120,originalDurationVerified:false}))
}
