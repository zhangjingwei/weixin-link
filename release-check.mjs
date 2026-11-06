// Stable command and import entry.
import {pathToFileURL} from 'node:url'
import {runReleaseCheck} from './src/tools/release-check.mjs'
export * from './src/tools/release-check.mjs'
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await runReleaseCheck()
