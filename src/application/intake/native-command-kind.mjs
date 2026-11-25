/** Classify native commands that need a durable ingress before cursor checkpoint. */
export function nativeCommandKind(intent){
 if(intent?.kind==='conversation'&&intent.value?.action==='personalResume')return 'mutation'
 return null
}
