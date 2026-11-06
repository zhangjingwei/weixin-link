import {fileURLToPath} from 'node:url'
import {existsSync} from 'node:fs'
export const ffmpegBinary=fileURLToPath(new URL(`./node_modules/@ffmpeg-installer/${process.platform}-${process.arch}/ffmpeg${process.platform==='win32'?'.exe':''}`,import.meta.url))
// Doctor reports absent optional binary; basic WeChat setup does not require media decoding.
export const hasFfmpeg=()=>existsSync(ffmpegBinary)
