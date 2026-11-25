import {fileURLToPath} from 'node:url'
export const ffmpegBinary=fileURLToPath(new URL(`../../../node_modules/@ffmpeg-installer/${process.platform}-${process.arch}/ffmpeg${process.platform==='win32'?'.exe':''}`,import.meta.url))
