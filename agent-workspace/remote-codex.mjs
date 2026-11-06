import {loadRemoteModule} from './remote-loader.mjs'
const {runRemoteCli}=await loadRemoteModule('remote-codex')
await runRemoteCli()
