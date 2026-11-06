// Stable command and import entry.
import {pathToFileURL} from 'node:url'
import {runNewsCli} from './src/integrations/news/news-job.mjs'
export * from './src/integrations/news/news-job.mjs'
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await runNewsCli()
