export function conversationCommand(text=''){
 const s=text.trim();let m;
 if((m=s.match(/^新建项目\s+([^|\r\n]{1,40})\s*\|\s*(.+)$/)))return {action:'new',name:m[1].trim(),workspace:m[2].trim()};
 if(/^(当前项目|当前目录)$/.test(s))return {action:'workspace'};
 if(/^(日常|日常助手|返回日常助手)$/.test(s))return {action:'daily'};
 if(/^(列表|项目列表|会话列表|查看会话|\/sessions)$/i.test(s))return {action:'list'};
 if((m=s.match(/^(?:新建(?:会话)?|\/new|\/reset)(?:\s+(.{1,40}))?$/i)))return {action:'new',name:m[1]};
 if((m=s.match(/^(?:切换(?:会话)?|\/resume)\s*([A-Za-z0-9-]+)$/i)))return {action:'switch',id:m[1]};
 if((m=s.match(/^(?:历史|\/history)(?:\s*([A-Za-z0-9-]+))?$/i)))return {action:'history',id:m[1]};
 if((m=s.match(/^命名\s+(.{1,40})$/)))return {action:'rename',name:m[1]};
 if((m=s.match(/^(归档|删除|还原)\s*(\d+)$/)))return {action:m[1]==='还原'?'unarchive':m[1]==='删除'?'delete':'archive',id:m[2]};
 if(/^(翻页|上一页|历史上一页)$/.test(s))return {action:'older'};
 if((m=s.match(/^(?:搜索|搜索历史)\s+(.{1,60})$/)))return {action:'search',q:m[1]};
 return null;
}

/** Parse transport text once, before conversation binding or intent routing. */
export function conversationInput(text=''){
 const questionCode=text?.trim().match(/^\/?(?:批准|拒绝|回答)\s+([a-f\d]{6})\b/i)?.[1]
 return {command:conversationCommand(text),questionCode}
}
