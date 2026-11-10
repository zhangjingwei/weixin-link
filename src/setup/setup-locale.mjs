export function setupLanguage({explicit,env=process.env,systemLocale=Intl.DateTimeFormat().resolvedOptions().locale}={}){
 const parse=value=>typeof value==='string'?( /^zh(?:[-_.@]|$)/i.test(value)?'zh':/^en(?:[-_.@]|$)/i.test(value)?'en':null):null
 if(explicit!==undefined||env.WEIXIN_LINK_LANG!==undefined){const selected=parse(explicit??env.WEIXIN_LINK_LANG);if(!selected)throw Error('INVALID_SETUP_LANGUAGE');return selected}
 for(const value of [env.LC_ALL,env.LC_MESSAGES,env.LANG]){const selected=parse(value);if(selected)return selected;if(typeof value==='string'&&/^(?:C(?:\..*)?|POSIX)$/i.test(value))return 'zh'}
 const system=parse(systemLocale);if(system)return system
 return 'zh'
}

export function languageOption(args=[]){
 const rest=[];let explicit
 for(let i=0;i<args.length;i++){
  const value=args[i]
  if(value==='--lang'){if(explicit!==undefined||!args[i+1])throw Error('INVALID_SETUP_LANGUAGE');explicit=args[++i]}
  else if(value.startsWith('--lang=')){if(explicit!==undefined)throw Error('INVALID_SETUP_LANGUAGE');explicit=value.slice(7)}
  else rest.push(value)
 }
 return {language:setupLanguage({explicit}),args:rest}
}
