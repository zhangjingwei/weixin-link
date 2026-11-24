// Package the Git index, including staged additions and deletions, without a commit or push.
import {execFileSync} from 'node:child_process'
import {existsSync} from 'node:fs'
import {mkdir, mkdtemp, rm, writeFile} from 'node:fs/promises'
import {homedir, tmpdir} from 'node:os'
import {join, resolve, sep} from 'node:path'
import {fileURLToPath} from 'node:url'
import {localUpgradeMarker} from '../infrastructure/updates/local-upgrade-notice.mjs'
import {checkIndex} from './release-check.mjs'
import {createInterface} from 'node:readline/promises'
import {standardDeployment, upgradeInstallation} from '../setup/upgrade.mjs'

function installTarget() {
  const configured = process.env.WEIXIN_LINK_DIR || process.env.ZERO_LINK_DIR
  if (configured) return resolve(configured)
  const base = join(homedir(), '.local', 'share')
  const target = join(base, 'weixin-link', 'source')
  const legacy = join(base, 'zero-link', 'source')
  if (!existsSync(legacy)) return target
  if (existsSync(target)) throw Error('存在两个安装目录，请用 WEIXIN_LINK_DIR 指定要试用的实例。')
  return legacy
}

export async function previewLocal({root, target, checkOnly=false, details=false, upgrade=upgradeInstallation, inspect=standardDeployment, confirm, resume=resumePending}) {
  const git = args => execFileSync('git', args, {cwd:root, encoding:'utf8'}).trim()
  const tree = git(['write-tree'])
  const {issues} = checkIndex(root)
  if (issues.length) throw Error('暂存区未通过发布文件检查：'+issues[0].code+' '+issues[0].path)
  if (git(['write-tree']) !== tree) throw Error('暂存区已变更，请重试。')
  const temp = await mkdtemp(join(tmpdir(), 'weixin-link-local-'))
  try {
    const source = join(temp, 'source'), archive = join(temp, 'source.tar')
    await mkdir(source)
    git(['archive','--format=tar','--output='+archive,tree])
    execFileSync('tar',['-xf',archive,'-C',source])
    if (existsSync(join(source,'.weixin-link-release.json'))) throw Error('本地试用包不能包含正式发布标记。')
    if (checkOnly || details) console.log('快照编号：'+tree)
    const homePrefix=homedir()+sep
    console.log('安装位置：'+(target.startsWith(homePrefix)?'~/'+target.slice(homePrefix.length):target))
    let pending=false
    if (process.platform!=='win32' && existsSync(join(target,'.weixin-link-install-pending'))) {
      try { await inspect({target}) }
      catch (error) {
        if (error.message!=='UPGRADE_SERVICE_NOT_INSTALLED') throw error
        pending=true
      }
    }
    const action=pending?'先临时保留未完成的安装，用本地快照中的向导继续配置和扫码':'更新时，正在运行的微信助手会短暂重启。'
    console.log(action)
    if (!checkOnly && (!confirm || await confirm())) {
      if (pending) await resume(root,target,archive)
      else {
        await writeFile(join(source,localUpgradeMarker),JSON.stringify({version:1,tree})+'\n',{flag:'wx',mode:0o600})
        await upgrade({source,target,localUpdate:true})
      }
    }
    return tree
  } finally {
    await rm(temp,{recursive:true,force:true})
  }
}

function resumePending(root,target,archive) {
  const env={...process.env,WEIXIN_LINK_DIR:target,WEIXIN_LINK_RESUME_ONLY:'1',WEIXIN_LINK_LOCAL_ARCHIVE:archive,WEIXIN_LINK_EXPECTED_COMMIT:''}
  execFileSync('/bin/sh',[join(root,'install.sh')],{cwd:root,env,stdio:'inherit'})
}

async function confirmAction(){
  const terminal=createInterface({input:process.stdin,output:process.stdout})
  try{return /^(y|yes)$/i.test((await terminal.question('开始更新？[y/N] ')).trim())}
  finally{terminal.close()}
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args=process.argv.slice(2)
    if (args.some(arg=>!['--check','--confirm','--details'].includes(arg))) throw Error('用法：npm run upgrade:local [-- --check | --confirm] [--details]')
    await previewLocal({root:fileURLToPath(new URL('../../',import.meta.url)),target:installTarget(),checkOnly:args.includes('--check'),details:args.includes('--details'),confirm:args.includes('--confirm')?confirmAction:undefined})
  } catch (error) {
    console.error('本地试用未完成：'+(error.message==='UPGRADE_ACTIVE_LEGACY_ACCOUNT'?'旧版的额外微信服务仍在运行。请先停止该服务，再升级单人版本。':error.message))
    if (error.recovery) console.error('恢复记录：'+error.recovery)
    process.exitCode=1
  }
}
